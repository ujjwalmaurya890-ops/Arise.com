'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, commitBody, schema } = require('./helpers.cjs');
const { hash } = require('../../server/cloud.cjs');
const { validateAllowlist } = require('../../server/access.cjs');

test('all five approved verified Google identities are accepted; sixth never reads/writes/deletes', async () => {
  const f = fixture();
  for (let i = 1; i <= 5; i++) {
    const result = await f.call('token-' + i);
    assert.equal(result.statusCode, 200); assert.equal(result.json.profile.uid, 'uid-' + i); assert.equal(result.json.profile.emailVerified, true);
  }
  assert.equal((await f.call('token-6')).statusCode, 403);
  assert.equal((await f.call('token-6', 'POST', commitBody('notes', '["forbidden"]'))).statusCode, 403);
  assert.equal((await f.call('token-6', 'DELETE')).statusCode, 405);
  assert.equal([...f.db.data.keys()].filter(key => key.startsWith('users/')).length, 0);
  assert.ok(f.calls.every(call => call.checkRevoked === true));
});

test('exactly five distinct real normalized emails; missing, invalid, placeholder and unavailable allowlists fail closed', async () => {
  const f = fixture();
  for (const config of [undefined, {}, { enabled: false, approvedEmails: f.emails }, { enabled: true, approvedEmails: f.emails.slice(1) },
    { enabled: true, approvedEmails: [...f.emails, 'six@example.test'] }, { enabled: true, approvedEmails: [f.emails[0], ...f.emails.slice(0, 4)] },
    { enabled: true, approvedEmails: ['missing', ...f.emails.slice(1)] }, { enabled: true, approvedEmails: ['first@example.invalid', ...f.emails.slice(1)] }]) {
    if (config === undefined) f.db.data.delete('_config/access'); else f.db.data.set('_config/access', config);
    assert.equal((await f.call()).statusCode, 503); assert.equal((await f.call('token-1', 'POST', commitBody('xp', '1'))).statusCode, 503);
  }
  for (const invalid of ['a..b@example.test', '.a@example.test', 'a@example..test', 'a@-example.test', 'a@example-.test', 'a@exa_mple.test', 'a@localhost', 'a@example.t', 'a'.repeat(65) + '@example.test', 'a<bad>@example.test']) {
    f.db.data.set('_config/access', { enabled: true, approvedEmails: [invalid, ...f.emails.slice(1)] });
    assert.equal((await f.call()).statusCode, 503, invalid);
  }
  assert.deepEqual(validateAllowlist({ enabled: true, approvedEmails: f.emails.map(email => ' ' + email.toUpperCase() + ' ') }), f.emails);
  f.db.doc = () => ({ get: async () => { throw new Error('DB down private internal hostname'); } });
  const unavailable = await f.call(); assert.equal(unavailable.statusCode, 503); assert.ok(!unavailable.body.includes('hostname'));
});

test('rejects missing/unverified email, non-Google provider, malformed UID, invalid/revoked token; live revocation', async () => {
  const f = fixture(), original = structuredClone(f.identities['token-1']);
  for (const patch of [{ email: null }, { email_verified: false }, { firebase: { sign_in_provider: 'password' } }, { uid: '../uid-2' }]) {
    f.identities['token-1'] = { ...original, ...patch }; assert.equal((await f.call()).statusCode, 403);
  }
  f.identities['token-1'] = { ...original, email: ' APPROVED1@EXAMPLE.TEST ' };
  assert.equal((await f.call()).statusCode, 200);
  assert.equal((await f.call('invalid')).statusCode, 401);
  f.revoked.add('token-1'); assert.equal((await f.call()).statusCode, 401);
  f.revoked.clear(); f.db.data.set('_config/access', { enabled: true, approvedEmails: ['replacement@example.test', ...f.emails.slice(1)] });
  assert.equal((await f.call()).statusCode, 403);
  const unauth = await f.handler({ httpMethod: 'GET', headers: {} }); assert.equal(unauth.statusCode, 401);
});

test('UID isolation, authenticated read/write/deletion, no arbitrary paths or self-granted permissions', async () => {
  const f = fixture();
  assert.equal((await f.call('token-1', 'POST', commitBody('notes', '[{"id":"original","body":"private"}]'))).statusCode, 200);
  assert.equal((await f.call('token-2')).json.records.length, 0);
  assert.equal((await f.call('token-2', 'GET', undefined, { action: 'read', key: 'notes' })).statusCode, 404);
  assert.equal((await f.call('token-2', 'GET', undefined, { action: 'read', key: 'notes', uid: 'uid-1' })).statusCode, 400);
  assert.equal((await f.call('token-2', 'POST', { ...commitBody('notes', '[]'), uid: 'uid-1' })).statusCode, 400);
  for (const key of ['../uid-1/notes', '_config/access', 'approvedEmails', 'backupCenter:gistToken', 'userSession', 'firebase:authUser']) {
    assert.equal((await f.call('token-2', 'POST', commitBody(key, '[]'))).statusCode, 400);
  }
  assert.equal((await f.call('token-2', 'POST', commitBody('notes', '[]'))).statusCode, 200);
  const own = await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' }); assert.ok(own.json.value.includes('private'));
  await f.call('token-2', 'POST', commitBody('notes', null, 1));
  assert.ok((await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' })).json.value.includes('private'));
});

test('Firestore transaction compare-and-set: concurrent stale edit is rejected, unrelated stores merge', async () => {
  const f = fixture();
  const result = await Promise.all([f.call('token-1', 'POST', commitBody('tasks', '[1]')), f.call('token-1', 'POST', commitBody('tasks', '[2]'))]);
  assert.deepEqual(result.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await f.call('token-1', 'POST', commitBody('notes', '[3]'))).statusCode, 200);
  const state = (await f.call()).json; assert.equal(state.sequence, 2); assert.equal(state.records.length, 2);
});

test('immutable receipts and activity deduplicate retries; preserve IDs/timestamps/order and deletion tombstones', async () => {
  const f = fixture(), records = [{ id: 'n-2', createdAt: '2020-01-01T00:00:00Z', completedAt: '2020-02-03T01:00:00Z' }, { id: 'n-1', createdAt: null }];
  const body = commitBody('notes', JSON.stringify(records));
  const a = await f.call('token-1', 'POST', body), retry = await f.call('token-1', 'POST', body);
  assert.equal(a.statusCode, 200); assert.equal(retry.json.duplicate, true); assert.equal(retry.json.version, 1);
  assert.equal((await f.call('token-1', 'POST', { ...body, value: '[]' })).statusCode, 409);
  const first = (await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' })).json;
  assert.deepEqual(JSON.parse(first.value), records);
  await f.call('token-1', 'POST', commitBody('notes', '[]', 1));
  const updated = (await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' })).json;
  assert.equal(updated.record.id, first.record.id); assert.equal(updated.record.createdAt, first.record.createdAt); assert.notEqual(updated.record.updatedAt, first.record.updatedAt);
  await f.call('token-1', 'POST', commitBody('notes', null, 2));
  const deleted = (await f.call()).json.records[0]; assert.equal(deleted.deleted, true); assert.equal(deleted.version, 3);
  const history = (await f.call('token-1', 'GET', undefined, { action: 'activity' })).json.events;
  assert.deepEqual(history.map(event => event.sequence), [1, 2, 3]); assert.deepEqual(history.map(event => event.type), ['change', 'change', 'delete']);
  assert.equal(history[0].originalEventAt, body.occurredAt);
  assert.ok([...f.db.data.keys()].includes('users/uid-1/payloads/' + body.opId + '/parts/0'));
  assert.deepEqual(schema.sortRecords([{ id: 'b', sequence: 1 }, { id: 'a', sequence: 1 }]).map(r => r.id), ['a', 'b']);
});

test('migration records distinguish capture/import time from missing original event time', async () => {
  const f = fixture();
  const body = { ...commitBody('xp', '900'), kind: 'migration', migrationId: 'backup-fingerprint', occurredAt: null };
  await f.call('token-1', 'POST', body);
  const read = (await f.call('token-1', 'GET', undefined, { action: 'read', key: 'xp' })).json.record;
  assert.equal(read.originalEventAt, null); assert.ok(read.importedAt); assert.equal(read.schemaVersion, 1);
  assert.equal((await f.call('token-1', 'GET', undefined, { action: 'activity' })).json.events[0].originalEventAt, null);
});

test('large Unicode payload sharding is byte-preserving; validation limits and errors are safe', async () => {
  const f = fixture(), value = JSON.stringify(['x'.repeat(74998) + '😀', 'नमस्ते'.repeat(60000)]);
  assert.equal((await f.call('token-1', 'POST', commitBody('notes', value))).statusCode, 200);
  assert.equal((await f.call('token-1', 'GET', undefined, { action: 'read', key: 'notes' })).json.value, value);
  assert.equal((await f.call('token-1', 'POST', commitBody('xp', 'x'.repeat(4 * 1024 * 1024 + 1)))).statusCode, 413);
  assert.equal((await f.call('token-1', 'POST', commitBody('xp', '1'), {}, { 'content-type': 'text/plain' })).statusCode, 415);
  assert.equal((await f.call('token-1', 'POST', { ...commitBody('xp', '1'), baseVersion: -1 })).statusCode, 400);
  assert.equal((await f.call()).headers['Cache-Control'], 'no-store, private');
});

test('staged binary chunks are UID-scoped, immutable and integrity checked before manifest publication', async () => {
  const f = fixture(), bytes = Buffer.from('exact attachment bytes'), opId = 'attachment_operation_12345';
  const stage = { action: 'stage', opId, index: 0, data: bytes.toString('base64') };
  assert.equal((await f.call('token-1', 'POST', stage)).statusCode, 200);
  assert.equal((await f.call('token-1', 'POST', stage)).statusCode, 200);
  assert.equal((await f.call('token-1', 'POST', { ...stage, data: Buffer.from('other').toString('base64') })).statusCode, 409);
  const record = { id: 'file_id', name: 'proof.pdf', size: bytes.length, type: 'application/pdf', uploadedAt: '2020-03-04T05:06:07Z' }, database = 'arise-local-files-db-v1', key = schema.attachmentKey(database, record.id);
  const attachment = { uploadId: opId, database, record, count: 1, bytes: bytes.length, digest: hash(bytes) };
  const body = { ...commitBody(key, JSON.stringify(record), 0, opId), attachment };
  assert.equal((await f.call('token-1', 'POST', { ...body, attachment: { ...attachment, digest: '0'.repeat(64) } })).statusCode, 400);
  assert.equal((await f.call('token-1', 'POST', body)).statusCode, 200);
  const chunk = await f.call('token-1', 'GET', undefined, { action: 'chunk', key, uploadId: opId, index: '0' });
  assert.equal(Buffer.from(chunk.json.data, 'base64').toString(), bytes.toString());
  assert.equal((await f.call('token-2', 'GET', undefined, { action: 'chunk', key, uploadId: opId, index: '0' })).statusCode, 404);
  assert.equal((await f.call('token-2', 'POST', body)).statusCode, 400);
});

test('legacy code endpoint is permanently closed for all methods; missing or invalid server configuration locks access', async () => {
  const legacy = require('../../netlify/functions/sync.js');
  for (const httpMethod of ['GET', 'POST', 'DELETE', 'OPTIONS']) assert.equal((await legacy.handler({ httpMethod, queryStringParameters: { code: 'ANYCODE' } })).statusCode, 410);
  const config = require('../../netlify/functions/public-config.js');
  assert.equal((await config.handler({ httpMethod: 'GET' })).statusCode, 503);
  const production = require('../../netlify/functions/cloud.js');
  assert.equal((await production.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer fake' } })).statusCode, 503);
  const { getServices } = require('../../server/firebase.cjs');
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  assert.throws(getServices, /configuration-unavailable/); delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
});
