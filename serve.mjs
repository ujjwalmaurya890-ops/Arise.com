#!/usr/bin/env node
// Fast static server for Arise workspace (0.0.0.0 binding + Gzip compression +
// Netlify-compatible MIME & cache headers).
// Usage: node serve.mjs [port]   (default 8123)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const port = Number(process.argv[2]) || Number(process.env.PORT) || 8123;

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

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg"]);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    let file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403).end("forbidden");
      return;
    }

    let body;
    let ext = path.extname(file).toLowerCase();
    try {
      body = await readFile(file);
    } catch (err) {
      if (!ext) {
        pathname = "/index.html";
        file = path.join(root, "index.html");
        ext = ".html";
        body = await readFile(file);
      } else {
        throw err;
      }
    }

    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Vary": "Accept-Encoding"
    };

    if (pathname === "/index.html" || pathname === "/service-worker.js") {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else if (pathname.startsWith("/assets/chunks/") || pathname.startsWith("/sounds/")) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else if (ext === ".js" || ext === ".css") {
      headers["Cache-Control"] = "public, max-age=60, must-revalidate";
    }

    const acceptEncoding = String(req.headers["accept-encoding"] || "");
    if (COMPRESSIBLE.has(ext) && body.length > 512 && /\bgzip\b/.test(acceptEncoding)) {
      const zipped = gzipSync(body);
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = String(zipped.length);
      res.writeHead(200, headers).end(zipped);
      return;
    }

    headers["Content-Length"] = String(body.length);
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Arise SaaS Workspace serving at http://0.0.0.0:${port}`);
});
