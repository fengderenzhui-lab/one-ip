#!/usr/bin/env bash
# NOTE (2026-10-23): production ip.nalide.com runs on Cloudflare Workers.
# The same-evening self-hosting trial was rolled back at the owner's
# request (the small server nearly fell over under the build load).
# This script is kept only for an optional future self-host attempt.
#
# Rebuild and restart the self-hosted one-ip container on this server.
# Run from the server clone (e.g. /opt/one-ip-src):  bash deploy/rebuild.sh
# Secrets live in /opt/one-ip.env (600): TURNSTILE_SITE_KEY / TURNSTILE_SECRET /
# TURNSTILE_HOSTNAMES (and TIANDITU_TOKEN when available).
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker build -f deploy/Dockerfile \
  --build-arg VITE_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t one-ip-node:latest .
docker rm -f one-ip 2>/dev/null || true
docker run -d --name one-ip --restart unless-stopped \
  -p 127.0.0.1:3002:3000 \
  --env-file /opt/one-ip.env \
  one-ip-node:latest
docker ps --filter name=one-ip
