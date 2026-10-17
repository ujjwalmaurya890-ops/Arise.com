#!/usr/bin/env node
// Minimal zero-dependency static server for local verification of the
// dashboard (MIME types + no-cache rules roughly matching Netlify's).
// Usage: node serve.mjs [port]   (default 8123)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const port = Number(process.argv[2]) || 8123;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".map": "application/json"
};

// v238 perf: mirrors the [[headers]] blocks in netlify.toml (and ./_headers) so the
// policy can be checked in devtools locally. Netlify's own globs are single-segment,
// hence the explicit subdirectory branches here rather than one recursive pattern.
// Only used for local verification — Netlify applies netlify.toml/_headers in prod.
function cacheControlFor(pathname) {
  if (pathname === "/index.html" || pathname === "/service-worker.js") {
    return "no-cache, no-store, must-revalidate";
  }
  if (/^\/assets\/chunks\/[^/]+$/.test(pathname)) return "public, max-age=31536000, immutable";
  if (/^\/sounds\/[^/]+$/.test(pathname)) return "public, max-age=31536000, immutable";
  if (/^\/assets\/(manifest\.webmanifest)$/.test(pathname)) return "public, max-age=0, must-revalidate";
  if (/^\/[^/]+\.(?:png|svg|ico|webp|jpg|jpeg)$/.test(pathname) || /^\/assets\/[^/]+\.(?:png|svg|ico|webp|jpg|jpeg)$/.test(pathname)) {
    return "public, max-age=604800, must-revalidate";
  }
  if (/^\/(?:assets\/|features\/[^/]+\/)?[^/]+\.(?:js|mjs|css|json)$/.test(pathname)) {
    return "public, max-age=60, must-revalidate";
  }
  if (pathname === "/manifest.webmanifest") return "public, max-age=0, must-revalidate";
  return "public, max-age=60, must-revalidate";
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    headers["Cache-Control"] = cacheControlFor(pathname);
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "0.0.0.0", () => console.log(`Arise dashboard serving at http://localhost:${port}  (0.0.0.0)`));
