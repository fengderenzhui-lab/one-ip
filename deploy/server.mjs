// NALIDE one-ip: Node adapter that runs the Cloudflare Worker code
// (public/worker/index.js) on a plain Node server, for self-hosting
// ip.nalide.com on our own server instead of Cloudflare Workers.
//
// What it shims (the only Cloudflare couplings the worker has):
//   - env.ASSETS            -> static files served from dist/ below
//   - env.*_LIMITER         -> in-memory fixed-window rate limiters,
//                              same limits as wrangler.toml (per visitor IP)
//   - request.cf            -> rebuilt from CF-Connecting-IP / CF-IPCountry
//                              headers; /api/me is enriched via ipwho.is
//                              (same upstream geo.js uses for lookups).
//                              botManagement/TLS fields are NOT fabricated:
//                              the TLS fingerprint card honestly reports null.
//   - caches.default        -> small in-memory cache honouring max-age
//   - env secrets           -> read from process.env (TURNSTILE_* etc.)
import http from "node:http";
import { register } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Workers accepts bare JSON imports; Node ESM requires import attributes.
// Register the bridge loader first, then load the worker code untouched.
register("./json-loader.mjs", import.meta.url);
const { default: worker } = await import("../public/worker/index.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT || 3000);

/* ---------------- rate limiters (mirror wrangler.toml) ---------------- */
class FixedWindowLimiter {
  constructor(limit, periodSeconds) {
    this.max = limit;
    this.period = periodSeconds * 1000;
    this.buckets = new Map();
  }
  async limit({ key }) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.period) {
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > 5000) {
      for (const [k, b] of this.buckets)
        if (now - b.start >= this.period) this.buckets.delete(k);
    }
    return { success: bucket.count <= this.max };
  }
}

/* ---------------- caches.default shim ---------------- */
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const key = typeof request === "string" ? request : request.url;
      const entry = cacheStore.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expires) {
        cacheStore.delete(key);
        return undefined;
      }
      return new Response(entry.body, {
        status: entry.status,
        headers: entry.headers,
      });
    },
    async put(request, response) {
      const key = typeof request === "string" ? request : request.url;
      const cc = response.headers.get("Cache-Control") || "";
      const match = /max-age=(\d+)/.exec(cc);
      const ttl = match ? Number(match[1]) : 0;
      if (!ttl) return;
      if (cacheStore.size > 1000) cacheStore.delete(cacheStore.keys().next().value);
      cacheStore.set(key, {
        body: await response.arrayBuffer(),
        status: response.status,
        headers: [...response.headers.entries()],
        expires: Date.now() + ttl * 1000,
      });
    },
    async delete(request) {
      const key = typeof request === "string" ? request : request.url;
      return cacheStore.delete(key);
    },
  },
};

/* ---------------- worker env ---------------- */
const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  API_LIMITER: new FixedWindowLimiter(180, 60),
  ACTION_LIMITER: new FixedWindowLimiter(5, 60),
  ICON_LIMITER: new FixedWindowLimiter(180, 60),
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || "",
  TURNSTILE_SECRET: process.env.TURNSTILE_SECRET || "",
  TURNSTILE_HOSTNAMES: process.env.TURNSTILE_HOSTNAMES || "",
  TIANDITU_TOKEN: process.env.TIANDITU_TOKEN || "",
};

/* ---------------- request.cf synthesis ---------------- */
const geoCache = new Map();
async function enrichCf(ip) {
  const hit = geoCache.get(ip);
  if (hit && Date.now() - hit.at < 300_000) return hit.cf;
  let cf = {};
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data?.success) {
      cf = {
        country: data.country_code,
        region: data.region,
        city: data.city,
        asOrganization: data.connection?.isp,
        asn: data.connection?.asn,
        latitude: data.latitude != null ? String(data.latitude) : undefined,
        longitude: data.longitude != null ? String(data.longitude) : undefined,
        timezone: data.timezone?.id,
      };
    }
  } catch {
    // enrichment is best-effort; country from CF header still applies
  }
  geoCache.set(ip, { at: Date.now(), cf });
  return cf;
}

async function toWorkerRequest(req) {
  const host = req.headers.host || "ip.nalide.com";
  const url = `https://${host}${req.url}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }
  const request = new Request(url, init);
  const cf = {};
  const country = req.headers["cf-ipcountry"];
  if (typeof country === "string" && country) cf.country = country;
  const pathname = new URL(url).pathname;
  if (pathname === "/api/me") {
    const ip = req.headers["cf-connecting-ip"];
    if (typeof ip === "string" && ip) Object.assign(cf, await enrichCf(ip));
  }
  try {
    request.cf = cf;
  } catch {
    Object.defineProperty(request, "cf", { value: cf });
  }
  return request;
}

/* ---------------- static assets (ex-ASSETS binding) ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const safe = normalize(join(DIST, decoded));
  if (!safe.startsWith(DIST)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  const tryFile = async (path) => {
    try {
      const info = await stat(path);
      if (!info.isFile()) return false;
      const body = req.method === "HEAD" ? null : await readFile(path);
      const type = MIME[extname(path).toLowerCase()] || "application/octet-stream";
      const cacheControl = path.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : path.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=3600";
      res.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
      });
      res.end(body ?? undefined);
      return true;
    } catch {
      return false;
    }
  };
  if (await tryFile(safe)) return;
  if (extname(decoded)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  // SPA fallback, mirroring assets not_found_handling = single-page-application
  await tryFile(join(DIST, "index.html"));
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "https://placeholder.invalid").pathname;
    if (pathname.startsWith("/api/") || pathname === "/worker" || pathname.startsWith("/worker/")) {
      const request = await toWorkerRequest(req);
      const response = await worker.fetch(request, env);
      const headers = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("Method not allowed");
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (error) {
    console.error(JSON.stringify({ event: "adapter_error", type: error?.name ?? "Error" }));
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`one-ip node adapter listening on :${PORT}`);
});
