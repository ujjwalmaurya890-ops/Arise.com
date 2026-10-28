// Production-faithful static file server for Arise (Node built-ins only).
// Supports Brotli (`br`) + Gzip (`gzip`) compression caching, ETag `304` validation,
// HTTP Range requests for ambient audio, and immutable cache headers matching netlify.toml.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const root = path.join(process.cwd(), "dist");
const require = createRequire(import.meta.url);
const { API_SECURITY_HEADERS, DEPLOYMENT_SECURITY_HEADERS, cacheControlFor, mergeHeaders } = require("../server/http-policy.cjs");
const functions = new Set(["public-config", "cloud", "sync", "ai-ask", "leetcode", "codechef", "gfg"]);
const port = Number(process.argv[2] || process.env.PORT || 8123);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2"
};

const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".cjs", ".css", ".json", ".webmanifest", ".svg"]);
const cache = new Map();

createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url || "/", "http://arise.local");
    if (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/.netlify/functions/")) {
      const functionName = parsed.pathname.replace(/^\/(?:api|\.netlify\/functions)\//, "").split("/")[0];
      if (!functions.has(functionName)) {
        res.writeHead(404, mergeHeaders(API_SECURITY_HEADERS, { "Content-Type": "application/json; charset=utf-8" })).end('{"error":"not-found"}');
        return;
      }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 5 * 1024 * 1024) {
          res.writeHead(413, mergeHeaders(API_SECURITY_HEADERS, { "Content-Type": "application/json; charset=utf-8" })).end('{"error":"request-too-large"}');
          return;
        }
        chunks.push(chunk);
      }
      const fn = require(path.join(process.cwd(), "netlify/functions", functionName + ".js"));
      const result = await fn.handler({ httpMethod: req.method, headers: req.headers, path: parsed.pathname,
        queryStringParameters: Object.fromEntries(parsed.searchParams), body: Buffer.concat(chunks).toString("utf8"), isBase64Encoded: false });
      res.writeHead(result.statusCode, mergeHeaders(API_SECURITY_HEADERS, result.headers || {})).end(result.body || ""); return;
    }
    let rawUrl;
    try {
      rawUrl = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      res.writeHead(400, mergeHeaders(DEPLOYMENT_SECURITY_HEADERS, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" })).end("Bad request.");
      return;
    }
    const relPath = rawUrl === "/" ? "/index.html" : rawUrl;
    let file = path.resolve(root, "." + relPath);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403, mergeHeaders(DEPLOYMENT_SECURITY_HEADERS, { "Cache-Control": "no-store" })).end();
      return;
    }
    let st = await stat(file).catch(() => null);
    let effectiveRel = relPath;
    if (!st || st.isDirectory()) {
      file = path.join(root, "index.html");
      effectiveRel = "/index.html";
      st = await stat(file);
    }

    const ext = path.extname(file).toLowerCase();
    const contentType = TYPES[ext] || "application/octet-stream";
    const etag = `W/"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    const cc = cacheControlFor(effectiveRel);

    if (req.headers["if-none-match"] === etag && !req.headers.range) {
      res.writeHead(304, mergeHeaders(DEPLOYMENT_SECURITY_HEADERS, { ETag: etag, "Cache-Control": cc })).end();
      return;
    }

    let entry = cache.get(file);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      const raw = await readFile(file);
      let br = null, gz = null;
      if (COMPRESSIBLE.has(ext) && raw.length >= 256) {
        br = brotliCompressSync(raw, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 }
        });
        gz = gzipSync(raw, { level: 6 });
      }
      entry = { mtimeMs: st.mtimeMs, size: st.size, raw, br, gz };
      cache.set(file, entry);
    }

    // Support HTTP Range requests for streaming audio files
    if (req.headers.range && entry.raw) {
      const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), entry.raw.length - 1) : entry.raw.length - 1;
        const slice = entry.raw.subarray(start, end + 1);
        res.writeHead(206, mergeHeaders(DEPLOYMENT_SECURITY_HEADERS, {
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${entry.raw.length}`,
          "Content-Length": slice.length,
          "Cache-Control": cc,
          ETag: etag
        })).end(slice);
        return;
      }
    }

    const ae = String(req.headers["accept-encoding"] || "");
    const headers = mergeHeaders(DEPLOYMENT_SECURITY_HEADERS, {
      "Content-Type": contentType,
      "Cache-Control": cc,
      ETag: etag,
      Vary: "Accept-Encoding"
    });

    if (entry.br && /\bbr\b/.test(ae)) {
      headers["Content-Encoding"] = "br";
      headers["Content-Length"] = entry.br.length;
      res.writeHead(200, headers).end(entry.br);
      return;
    }
    if (entry.gz && /\bgzip\b/.test(ae)) {
      headers["Content-Encoding"] = "gzip";
      headers["Content-Length"] = entry.gz.length;
      res.writeHead(200, headers).end(entry.gz);
      return;
    }

    headers["Content-Length"] = entry.raw.length;
    res.writeHead(200, headers).end(entry.raw);
  } catch (error) {
    console.error("[serve] request failed:", error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(500, mergeHeaders(DEPLOYMENT_SECURITY_HEADERS, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    })).end("Internal server error.");
  }
}).listen(port, "0.0.0.0", () => console.log("serving " + root + " on http://0.0.0.0:" + port));
