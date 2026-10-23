'use strict';
// Retired insecure, code-addressed Netlify Blobs endpoint. Never read, expose or
// delete the legacy blobs here. Owners can archive them using trusted Netlify tools.
exports.handler = async function () {
  return { statusCode: 410, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: 'legacy-sync-retired', message: 'Sign in with Google to use secure cloud sync. Existing local data has not been removed.' }) };
};
