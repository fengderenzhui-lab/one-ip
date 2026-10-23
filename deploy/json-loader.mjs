// Node module hook: the worker code uses bare JSON imports
// (`import data from "./x.json"`), which Cloudflare Workers accepts but
// plain Node ESM rejects without an import attribute. This loader
// bridges the gap so public/worker/* stays byte-identical to the
// Workers deployment.
import { readFile } from "node:fs/promises";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const content = await readFile(new URL(url), "utf8");
    return {
      format: "module",
      source: `export default JSON.parse(${JSON.stringify(content)});`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
