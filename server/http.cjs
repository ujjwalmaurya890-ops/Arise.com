'use strict';
const { ApiError } = require('./access.cjs');
function respond(statusCode, data) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff', Vary: 'Authorization', 'Referrer-Policy': 'no-referrer' }, body: JSON.stringify(data) };
}
function fail(error) { return respond(error instanceof ApiError ? error.status : 503, { error: error instanceof ApiError ? error.code : 'service-unavailable' }); }
function readBody(event) {
  if (!String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json-required');
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  if (Buffer.byteLength(raw, 'utf8') > 5 * 1024 * 1024) throw new ApiError(413, 'request-too-large');
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiError(400, 'invalid-request'); }
}
module.exports = { respond, fail, readBody };
