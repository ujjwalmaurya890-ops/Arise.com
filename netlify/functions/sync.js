// Netlify Function: cross-device sync backend, backed by Netlify Blobs.
//
// This is the "lightweight sync backend" the dashboard needed so progress
// isn't trapped in one browser's localStorage. No external database, no API
// keys to manage — Netlify Blobs is provisioned automatically for every
// Netlify site, so this works as soon as it's deployed.
//
// How it works: the user picks (or is given) a short "sync code" in the
// Backup Center UI. That code is the key for a blob containing their full
// localStorage/IndexedDB snapshot (the same shape Backup Center already
// exports as JSON). Every device that enters the same code reads/writes the
// same blob, which is how data crosses devices.
//
// This is intentionally simple — anyone who has the code can read/write
// that snapshot, the same trust model as a "share link". It is NOT a
// per-user auth system. For a single person syncing their own two or three
// devices this is a reasonable trade-off; treat the sync code like a
// password and don't share it.
//
// Endpoints (all under /api/sync, see _redirects / netlify.toml):
//   GET    /api/sync?code=XXXX        -> { ok, updatedAt, snapshot } | 404
//   POST   /api/sync?code=XXXX  body: { snapshot, clientUpdatedAt } -> { ok, updatedAt }
//   DELETE /api/sync?code=XXXX        -> { ok }
//
// Optimistic concurrency: the client sends the `updatedAt` it last pulled as
// `ifMatch`. If the stored value has moved on since then, the server refuses
// the push with 409 so the client can pull-then-merge instead of silently
// clobbering another device's newer data.

const { getStore } = require("@netlify/blobs");

const STORE_NAME = "dashboard-sync";
const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024; // 6MB safety cap
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

exports.handler = async function (event) {
  const cors = corsHeaders();
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const code = ((event.queryStringParameters && event.queryStringParameters.code) || "").trim();
  if (!CODE_RE.test(code)) {
    return respond(400, { error: "Missing or invalid ?code= (4-64 letters/numbers/-/_ )." }, cors);
  }

  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return respond(500, {
      error: "Blob store unavailable. This usually means the site isn't fully deployed on Netlify yet: " + err.message
    }, cors);
  }

  const key = "snap:" + code;

  try {
    if (event.httpMethod === "GET") {
      const entry = await store.getWithMetadata(key, { type: "json" });
      if (!entry || entry.data == null) {
        return respond(404, { error: "No sync data for this code yet." }, cors);
      }
      const updatedAt = (entry.metadata && entry.metadata.updatedAt) || null;
      return respond(200, { ok: true, updatedAt: updatedAt, snapshot: entry.data }, cors);
    }

    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return respond(400, { error: "Invalid JSON body." }, cors);
      }
      if (!body || typeof body !== "object" || !body.snapshot) {
        return respond(400, { error: "Missing snapshot in request body." }, cors);
      }
      const raw = JSON.stringify(body.snapshot);
      if (raw.length > MAX_SNAPSHOT_BYTES) {
        return respond(413, { error: "Snapshot too large (" + Math.round(raw.length / 1024 / 1024) + "MB). Max is 6MB." }, cors);
      }

      // Optimistic concurrency check: if the caller tells us what it last
      // saw (ifMatch) and the current stored value has a newer updatedAt,
      // reject so the caller can pull and reconcile instead of overwriting.
      if (body.ifMatch) {
        const existing = await store.getWithMetadata(key, { type: "json" }).catch(function () { return null; });
        const currentUpdatedAt = existing && existing.metadata && existing.metadata.updatedAt;
        if (currentUpdatedAt && currentUpdatedAt !== body.ifMatch) {
          return respond(409, {
            error: "Cloud data changed since your last pull. Pull the latest before pushing.",
            updatedAt: currentUpdatedAt
          }, cors);
        }
      }

      const updatedAt = new Date().toISOString();
      const deviceLabel = typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 80) : "";
      await store.setJSON(key, body.snapshot, { metadata: { updatedAt: updatedAt, deviceLabel: deviceLabel } });
      return respond(200, { ok: true, updatedAt: updatedAt }, cors);
    }

    if (event.httpMethod === "DELETE") {
      await store.delete(key);
      return respond(200, { ok: true }, cors);
    }

    return respond(405, { error: "Method not allowed." }, cors);
  } catch (err) {
    return respond(502, { error: "Sync backend error: " + err.message }, cors);
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function respond(statusCode, bodyObj, extraHeaders) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ "content-type": "application/json" }, extraHeaders || {}),
    body: JSON.stringify(bodyObj)
  };
}
