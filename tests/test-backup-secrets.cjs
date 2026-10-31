'use strict';
// Regression for the replacement Backup Center: never revive code/Gist sync,
// bypass the approved-account adapter, or expose browser credentials in exports.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const dom = new JSDOM('<!doctype html><div id="backup"></div>', { url: 'https://example.test/', runScripts: 'outside-only' });
  const w = dom.window, native = w.localStorage; w.indexedDB = new IDBFactory();
  native.setItem('backupCenter:gistToken', 'SECRET_GIST_TOKEN'); native.setItem('backupCenter:blobSyncCode', 'SECRET_CODE'); native.setItem('firebase:authUser:demo', 'PROVIDER_TOKEN');
  for (const file of ['src/cloud/storage-schema.js', 'src/cloud/storage-bridge.js', 'src/backup-center-widget.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  assert.equal(w.AriseCloudSync, undefined, 'backup widget does not install the retired pairing-code adapter');
  w.AriseStorage.activate('uid-approved'); w.localStorage.setItem('notes', '["local"]');
  let exported, finishExport;
  const exportFinished = new Promise(resolve => { finishExport = resolve; });
  w.AriseAuth = { snapshot: () => ({ isAuthenticated: true }), exportBackup: async () => {
    exported = await w.AriseStorage.snapshot(false);
    finishExport();
  } };
  w.__mountBackupCenter(w.document.getElementById('backup'));
  const button = [...w.document.querySelectorAll('button')].find(button => button.textContent.includes('Export Backup'));
  button.click();
  let deadline;
  try {
    await Promise.race([exportFinished, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Backup export did not complete')), 5000);
    })]);
    // Let the button's async finally handler run; do not guess IDB duration.
    await new Promise(resolve => setImmediate(resolve));
  } finally { clearTimeout(deadline); }
  assert.equal(exported.localStorage.notes, '["local"]');
  for (const secret of ['SECRET_GIST_TOKEN', 'SECRET_CODE', 'PROVIDER_TOKEN']) assert.ok(!JSON.stringify(exported).includes(secret));
  assert.equal(native.getItem('backupCenter:gistToken'), 'SECRET_GIST_TOKEN', 'legacy credentials are not silently deleted');
  assert.equal(native.getItem('backupCenter:blobSyncCode'), 'SECRET_CODE');
  w.AriseAuth.snapshot = () => ({ isAuthenticated: false }); exported = null; button.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(exported, null); assert.match(w.document.getElementById('backup').textContent, /Sign in with an approved Google account/);
  assert.ok(!w.document.querySelector('[data-field="gist-token"]')); assert.ok(!w.document.querySelector('[data-field="blob-code"]'));
  dom.window.close(); console.log('Secure backup: 12 assertions passed, 0 failed');
})().catch(error => { console.error(error); process.exitCode = 1; });
