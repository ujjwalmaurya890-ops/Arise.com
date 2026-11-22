/* Purge legacy plaintext secrets (CSP: external file, script-src 'self').
   The retired Gist/Netlify-Blobs sync (netlify/functions/sync.js returns 410)
   stored a GitHub PAT in localStorage as backupCenter:gistToken. That token
   must be rotated by its owner and must never be stored again: this runs
   before any widget loads, deletes any existing copy, and blocks re-writes
   for the rest of the page lifetime. Secure sync is Firestore-only now. */
(function () {
  var PURGED = ["backupCenter:gistToken", "backupCenter:gistId", "backupCenter:blobSyncCode"];
  function purge() {
    try {
      PURGED.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch (_) {}
  }
  purge();
  try {
    var originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (PURGED.indexOf(String(key)) !== -1) return;
      return originalSetItem.call(this, key, value);
    };
  } catch (_) {}
  window.__ariseLegacySecretsPurged = true;
})();
