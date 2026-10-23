'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory } = require('fake-indexeddb');
const { buildSync } = require('esbuild');
const { fixture, commitBody } = require('./helpers.cjs');
const root = path.resolve(__dirname, '../..');
const controllerCode = buildSync({ entryPoints: [path.join(root, 'src/cloud/auth-controller.js')], bundle: true, platform: 'browser', format: 'iife', globalName: 'ControllerUnderTest', write: false }).outputFiles[0].text;
function browser(f, { legacy = {}, indexedDB = new IDBFactory() } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, native = w.localStorage;
  for (const [key, value] of Object.entries(legacy)) native.setItem(key, value);
  Object.defineProperty(w, 'crypto', { value: crypto }); w.TextEncoder = TextEncoder; w.Blob = Blob; w.AbortSignal = AbortSignal; w.indexedDB = indexedDB;
  w.navigator.locks = { request: async (name, options, callback) => callback({ name }) };
  w.confirm = () => true; let user = null, watcher, signins = 0, signouts = 0, reloads = 0;
  w.eval(fs.readFileSync(path.join(root, 'src/cloud/storage-schema.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'src/cloud/storage-bridge.js'), 'utf8'));
  w.eval(controllerCode);
  const fetcher = async (url, options = {}) => {
    const parsed = new URL(url, 'https://example.test');
    const result = await f.handler({ httpMethod: options.method || 'GET', headers: Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value])),
      queryStringParameters: Object.fromEntries(parsed.searchParams), body: options.body || '' });
    return { ok: result.statusCode < 400, status: result.statusCode, json: async () => JSON.parse(result.body) };
  };
  const adapter = { user: () => user, signIn: async () => { signins++; }, signOut: async () => { signouts++; user = null; await watcher?.(null); }, watch: next => { watcher = next; } };
  const api = w.ControllerUnderTest.createController(adapter, { fetcher, reload: () => { reloads++; } });
  return { dom, w, api, native, indexedDB, get reloads() { return reloads; }, get signouts() { return signouts; },
    login: async (index = 1) => { user = { uid: 'uid-' + index, getIdToken: async () => 'token-' + index }; return watcher(user); },
    emitNull: async () => { user = null; await watcher(null); },
    close: () => { api.sync?.stop(); w.close(); } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function waitFor(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await tick(); } throw new Error('Condition timed out.'); }
function clickText(w, text) { const button = [...w.document.querySelectorAll('#cloud-actions button')].find(button => button.textContent.includes(text)); assert.ok(button, text); button.click(); }

test('protected shell stays hidden until verified account restore; all five mocked Google sessions work', async () => {
  const f = fixture();
  for (let account = 1; account <= 5; account++) {
    const b = browser(f);
    assert.notEqual(b.w.document.documentElement.dataset.cloudAuth, 'ready');
    assert.equal(b.w.localStorage.getItem('notes'), null);
    await b.login(account); assert.equal(b.w.document.documentElement.dataset.cloudAuth, 'ready');
    assert.equal(b.w.document.getElementById('cloud-account-email').textContent, 'approved' + account + '@example.test · verified');
    assert.equal(b.api.snapshot().isAuthenticated, true); await b.api.sync.flush(); b.close();
  }
});

test('sixth identity is denied without reading anonymous data or unlocking the app; logout enforces the gate', async () => {
  const f = fixture(), denied = browser(f, { legacy: { notes: '["private legacy"]' } });
  await denied.login(6); assert.notEqual(denied.w.document.documentElement.dataset.cloudAuth, 'ready');
  assert.match(denied.w.document.getElementById('cloud-message').textContent, /not approved/); assert.equal(denied.w.localStorage.getItem('notes'), null);
  assert.equal(denied.native.getItem('notes'), '["private legacy"]'); assert.ok(denied.signouts > 0); denied.close();
  const approved = browser(f); await approved.login(1); await approved.api.sync.flush();
  await approved.api.logout(); assert.notEqual(approved.w.document.documentElement.dataset.cloudAuth, 'ready'); assert.equal(approved.w.localStorage.getItem('appSettings'), null); assert.equal(approved.api.snapshot().isAuthenticated, false); approved.close();
});

test('missing/invalid policy and revoked session fail closed in the real controller', async () => {
  for (const invalid of [undefined, { enabled: true, approvedEmails: ['only1@example.test'] }]) {
    const f = fixture(); if (!invalid) f.db.data.delete('_config/access'); else f.db.data.set('_config/access', invalid);
    const b = browser(f); await b.login(); assert.notEqual(b.w.document.documentElement.dataset.cloudAuth, 'ready'); assert.match(b.w.document.getElementById('cloud-message').textContent, /temporarily unavailable/); b.close();
  }
  const f = fixture(), b = browser(f); await b.login(); await b.api.sync.flush(); f.revoked.add('token-1');
  await b.api.sync.poll(); await waitFor(() => b.w.document.documentElement.dataset.cloudAuth !== 'ready');
  assert.equal(b.api.sync.active, false); assert.equal(b.w.localStorage.getItem('notes'), null); b.close();
});

test('legacy import has a durable pre-migration backup and explicit ownership confirmation; refusal never uploads it', async () => {
  const f = fixture(), b = browser(f, { legacy: { notes: '[{"id":"old","createdAt":"2020-01-01"}]', 'backupCenter:gistToken': 'NEVER_EXPORT', 'backupCenter:blobSyncCode': 'LEGACY_CODE' } });
  const signingIn = b.login(); await waitFor(() => b.w.document.getElementById('cloud-title').textContent === 'Keep your existing progress');
  assert.equal((await f.request()('?action=state')).records.length, 0);
  const before = await b.w.AriseStorage.load('legacy:backup:v1'); assert.ok(before); assert.equal(before.localStorage.notes, b.native.getItem('notes'));
  assert.equal(before.localStorage['backupCenter:gistToken'], undefined);
  clickText(b.w, 'Not mine'); await signingIn; await b.api.sync.flush();
  assert.equal((await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' })).statusCode, 404);
  assert.equal(b.native.getItem('notes'), '[{"id":"old","createdAt":"2020-01-01"}]'); b.close();
});

test('confirmed migration verifies original IDs/times/order, retains source and refuses cross-owner restore', async () => {
  const f = fixture(), raw = '[{"id":"b","createdAt":null},{"id":"a","createdAt":"2019-01-01"}]';
  const b = browser(f, { legacy: { notes: raw } });
  const signingIn = b.login(); await waitFor(() => b.w.document.getElementById('cloud-title').textContent === 'Keep your existing progress');
  clickText(b.w, 'This is mine'); await signingIn; await b.api.sync.flush();
  assert.equal((await f.request()('?action=read&key=notes')).value, raw); assert.equal(b.native.getItem('notes'), raw);
  assert.equal((await b.w.AriseStorage.load('legacy:assignment:v1')).status, 'complete');
  await assert.rejects(b.api.importBackup({ meta: { ownerUid: 'uid-2' }, localStorage: { notes: '[]' }, indexedDB: [] }), /different account/);
  b.close();
});

test('refresh/device B restores existing cloud state before mounting; does not create a fresh empty profile', async () => {
  const f = fixture(); await f.call('token-1', 'POST', commitBody('notes', '[{"id":"persisted","createdAt":"2020-01-01"}]'));
  const a = browser(f); await a.login(); await a.api.sync.flush(); assert.match(a.w.localStorage.getItem('notes'), /persisted/); a.close();
  const b = browser(f); await b.login(); assert.equal(b.w.document.documentElement.dataset.cloudAuth, 'ready'); assert.match(b.w.localStorage.getItem('notes'), /persisted/);
  assert.equal(b.api.snapshot().displayName, 'User 1'); await b.api.sync.flush(); b.close();
});

test('storage facade isolates caches/clear by UID and excludes Firebase storage, unknown keys and credentials from backups', async () => {
  const f = fixture(), b = browser(f, { legacy: { notes: '["anonymous"]', 'firebase:authUser:example': 'PROVIDER_SESSION', unknownPersonalStore: 'UNSUPPORTED', 'backupCenter:gistToken': 'SECRET' } });
  const storage = b.w.AriseStorage;
  assert.equal(b.w.localStorage.getItem('notes'), null); assert.throws(() => b.w.localStorage.setItem('notes', '[]'));
  storage.activate('uid-1'); b.w.localStorage.setItem('notes', '["A"]'); storage.lock(); storage.activate('uid-2');
  assert.equal(b.w.localStorage.getItem('notes'), null); b.w.localStorage.setItem('notes', '["B"]');
  const backup = await storage.snapshot(false); assert.equal(backup.localStorage.notes, '["B"]'); assert.ok(!JSON.stringify(backup).includes('PROVIDER_SESSION')); assert.ok(!JSON.stringify(backup).includes('SECRET'));
  b.w.localStorage.clear(); storage.activate('uid-1'); assert.equal(b.w.localStorage.getItem('notes'), '["A"]');
  assert.equal(b.native.getItem('notes'), '["anonymous"]'); assert.equal(b.native.getItem('firebase:authUser:example'), 'PROVIDER_SESSION');
  const legacy = await storage.snapshot(true); assert.deepEqual([...legacy.unknownKeys], ['unknownPersonalStore']); assert.equal(legacy.localStorage.notes, '["anonymous"]'); b.close();
});

test('lossless backup codec includes actual file bytes and stable owner metadata', async () => {
  const f = fixture(), b = browser(f), code = buildSync({ entryPoints: [path.join(root, 'src/cloud/backup-codec.js')], bundle: true, format: 'iife', globalName: 'CodecTest', write: false }).outputFiles[0].text;
  b.w.eval(code);
  const original = { meta: { ownerUid: 'uid-1' }, localStorage: { notes: '[1]' }, indexedDB: [{ stores: { files: { records: [{ key: 'f1', value: { id: 'f1', blob: new Blob(['exact bytes'], { type: 'text/plain' }) } }] } } }] };
  const encoded = await b.w.CodecTest.encodeBackup(original); const restored = b.w.CodecTest.decodeBackup(JSON.parse(JSON.stringify(encoded)));
  assert.equal(await restored.indexedDB[0].stores.files.records[0].value.blob.text(), 'exact bytes'); assert.equal(restored.meta.ownerUid, 'uid-1'); b.close();
});


test('synchronous write-ahead journal recovers a mutation before its async queue has been persisted', async () => {
  const f = fixture(), b = browser(f);
  b.w.AriseStorage.activate('uid-1');
  b.w.localStorage.setItem('notes', '[{"id":"last-keystroke","body":"survives immediate close"}]');
  assert.equal((await b.w.AriseStorage.load('queue:uid-1')), undefined);
  const marker = b.w.AriseStorage.recoverJournal()[0]; assert.ok(marker.opId);
  await b.login(); await b.api.sync.flush();
  assert.match((await f.request()('?action=read&key=notes')).value, /last-keystroke/);
  assert.equal(b.w.AriseStorage.recoverJournal().length, 0); b.close();
});

test('stale recovery journals cannot overwrite newer cloud data; both conflict choices clean/rebase journals safely', async () => {
  for (const keepLocal of [false, true]) {
    const f = fixture(); await f.call('token-1', 'POST', commitBody('notes', '["baseline"]'));
    const b = browser(f); b.w.AriseStorage.activate('uid-1'); b.w.AriseStorage.setVersion('notes', 1);
    b.w.localStorage.setItem('notes', '["offline local"]');
    await f.call('token-1', 'POST', commitBody('notes', '["newer cloud"]', 1));
    await b.login(); assert.equal(b.api.sync.blocked, true);
    assert.equal((await f.request()('?action=read&key=notes')).value, '["newer cloud"]');
    await b.api.sync.resolveConflict(keepLocal);
    assert.equal(b.w.AriseStorage.recoverJournal().length, 0);
    assert.equal((await f.request()('?action=read&key=notes')).value, keepLocal ? '["offline local"]' : '["newer cloud"]'); b.close();
  }
});

test('JSON and ZIP backups share a lossless ownership-checked format, including unsupported legacy records', async () => {
  const { zipSync, strToU8 } = require('fflate');
  const f = fixture(), b = browser(f);
  const code = buildSync({ entryPoints: [path.join(root, 'src/cloud/backup-codec.js')], bundle: true, platform: 'browser', format: 'iife', globalName: 'CodecZip', write: false }).outputFiles[0].text;
  b.w.eval(code);
  const original = { meta: { ownerUid: 'uid-1' }, localStorage: { notes: '["archive"]' }, indexedDB: [
    { name: 'arise-local-files-db-v1', stores: { files: { records: [{ key: 'f1', value: { id: 'f1', uploadedAt: '2020-01-01', blob: new Blob(['exact ZIP bytes']) } }] } } },
    { name: 'unknown-legacy-db', stores: { extra: { records: [{ key: 'kept', value: { old: 'retained, not uploaded' } }] } } }
  ] };
  const archive = await b.w.CodecZip.backupZip(original);
  const raw = await b.w.CodecZip.readBackupFile(archive), decoded = b.w.CodecZip.decodeBackup(raw);
  assert.equal(await decoded.indexedDB[0].stores.files.records[0].value.blob.text(), 'exact ZIP bytes');
  assert.equal(await b.w.CodecZip.fingerprint(original), await b.w.CodecZip.fingerprint(decoded));
  await b.login(); await b.api.sync.flush(); await b.api.importBackup(raw);
  assert.equal((await f.request()('?action=read&key=notes')).value, '["archive"]');
  assert.equal((await f.request()('?action=state')).records.filter(record => record.key.startsWith('idb:')).length, 1);
  const json = await b.w.CodecZip.readBackupFile(new Blob(['\uFEFF' + JSON.stringify(raw)])); assert.equal(json.meta.ownerUid, 'uid-1');
  await assert.rejects(b.w.CodecZip.readBackupFile(new Blob([zipSync({ 'wrong.json': strToU8('{}') })])), /backup.json/);
  await assert.rejects(b.w.CodecZip.readBackupFile({ size: 512 * 1024 * 1024 + 1 }), /512 MiB/);
  b.close();
});

test('invalid legacy attachment backups are rejected before any progress is changed', async () => {
  const f = fixture(), b = browser(f); await b.login(); await b.api.sync.flush();
  for (const bad of [{}, null, undefined]) {
    const snapshot = { localStorage: { notes: '["must not upload"]' }, indexedDB: [{ name: 'arise-local-files-db-v1', stores: { files: { records: [{ value: { id: 'broken', blob: bad } }] } } }] };
    await assert.rejects(b.api.importBackup(snapshot), /valid attachment bytes/);
  }
  assert.equal((await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' })).statusCode, 404);
  assert.equal(b.w.localStorage.getItem('notes'), null); b.close();
});

test('a stale migration consent cannot upload anonymous progress after the account/session changes', async () => {
  const f = fixture(), b = browser(f, { legacy: { notes: '["belongs only to the first person"]' } });
  const firstLogin = b.login(); await waitFor(() => b.w.document.getElementById('cloud-title').textContent === 'Keep your existing progress');
  const detachedConsent = [...b.w.document.querySelectorAll('#cloud-actions button')].find(button => button.textContent.includes('This is mine'));
  await b.emitNull(); await b.login(2); detachedConsent.click(); await firstLogin;
  assert.equal(b.reloads, 1, 'account changes require a clean runtime even during the first migration');
  for (const token of ['token-1', 'token-2']) assert.equal((await f.call(token, 'GET', undefined, { action: 'read', key: 'notes' })).statusCode, 404);
  assert.equal(await b.w.AriseStorage.load('legacy:assignment:v1'), undefined);
  assert.equal(b.native.getItem('notes'), '["belongs only to the first person"]'); b.close();
});
