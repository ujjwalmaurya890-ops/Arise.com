'use strict';
// Regression test: credentials (GitHub Gist token, cross-device sync code) must never be
// written into a backup/sync snapshot, and an imported/pulled snapshot must never overwrite them.
// Usage: node test-backup-secrets.cjs   (BACKUP_FILE=<path> to test another copy of the widget)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.error('FAIL: ' + m); } }

const FILE = process.env.BACKUP_FILE || path.join(__dirname, 'backup-center-widget.js');
const TOKEN = 'ghp_TESTTOKEN_do_not_leak', CODE = 'SYNCCODE1234';

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', runScripts: 'dangerously' });
  const w = dom.window;
  w.__ARISE_MUTATION_BUS__ = { subscribe() {} };
  w.confirm = () => true;
  w.localStorage.setItem('backupCenter:gistToken', TOKEN);
  w.localStorage.setItem('backupCenter:blobSyncCode', CODE);
  w.localStorage.setItem('notes', '["local"]');
  w.eval(fs.readFileSync(FILE, 'utf8'));
  return w;
}
const tick = (ms) => new Promise(r => setTimeout(r, ms));

(async function () {
  // 1) PUSH: snapshot sent to /api/sync
  let w = boot(), sent = null;
  w.fetch = (url, opts) => { if (opts && opts.method === 'POST') sent = opts.body; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, updatedAt: 'T1' }) }); };
  assert(w.AriseCloudSync && typeof w.AriseCloudSync.push === 'function', 'AriseCloudSync.push is exposed');
  await w.AriseCloudSync.push(true);
  assert(sent !== null, 'push sent a request');
  const snap = JSON.parse(sent).snapshot.localStorage;
  assert(snap.notes === '["local"]', 'normal keys are still included in the snapshot');
  assert(!('backupCenter:gistToken' in snap), 'gist token key is NOT in the pushed snapshot');
  assert(!('backupCenter:blobSyncCode' in snap), 'sync code key is NOT in the pushed snapshot');
  assert(sent.indexOf(TOKEN) === -1, 'token value appears nowhere in the request body');
  assert(w.localStorage.getItem('backupCenter:gistToken') === TOKEN, 'local gist token is untouched by push');
  assert(w.localStorage.getItem('backupCenter:blobSyncCode') === CODE, 'local sync code is untouched by push');

  // 2) PULL/RESTORE: hostile snapshot tries to replace credentials
  w = boot();
  const hostile = { meta: { app: 'Arise Dashboard', formatVersion: 1 }, indexedDB: [],
    localStorage: { notes: '["from-remote"]', 'backupCenter:gistToken': 'ATTACKER_TOKEN', 'backupCenter:blobSyncCode': 'ATTACKERCODE' } };
  w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, updatedAt: 'T2', snapshot: hostile }) });
  await w.AriseCloudSync.pull().catch(() => {});
  await tick(300);
  assert(w.localStorage.getItem('notes') === '["from-remote"]', 'normal keys are still restored from a pulled snapshot');
  assert(w.localStorage.getItem('backupCenter:gistToken') === TOKEN, 'pulled snapshot cannot overwrite the gist token');
  assert(w.localStorage.getItem('backupCenter:blobSyncCode') === CODE, 'pulled snapshot cannot overwrite the sync code');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
