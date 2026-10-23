// Production-faithful static file server for Arise (Node built-ins only).
// Supports Brotli (`br`) + Gzip (`gzip`) compression caching, ETag `304` validation,
// HTTP Range requests for ambient audio, and immutable cache headers matching netlify.toml.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const root = process.cwd();
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

function cacheControlFor(urlPath) {
  if (urlPath === "/" || urlPath === "/index.html" || urlPath === "/service-worker.js") {
    return "no-cache, no-store, must-revalidate";
  }
  if (urlPath.startsWith("/assets/chunks/") || urlPath.startsWith("/assets/fonts/") || urlPath.startsWith("/sounds/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=31536000, stale-while-revalidate=86400";
}

createServer(async (req, res) => {
  try {
    const rawUrl = decodeURIComponent((req.url || "/").split("?")[0]);
    const relPath = rawUrl === "/" ? "/index.html" : rawUrl;
    let file = path.resolve(root, "." + relPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
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
      res.writeHead(304, { ETag: etag, "Cache-Control": cc }).end();
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
        res.writeHead(206, {
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${entry.raw.length}`,
          "Content-Length": slice.length,
          "Cache-Control": cc,
          ETag: etag
        }).end(slice);
        return;
      }
    }

    const ae = String(req.headers["accept-encoding"] || "");
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": cc,
      ETag: etag,
      Vary: "Accept-Encoding"
    };

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
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "0.0.0.0", () => console.log("serving " + root + " on http://0.0.0.0:" + port));
