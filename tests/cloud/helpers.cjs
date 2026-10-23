'use strict';
const { createHandler } = require('../../server/cloud.cjs');
const schema = require('../../src/cloud/storage-schema.js');
const { buildSync } = require('esbuild');
const path = require('node:path');
const Module = require('node:module');

const copy = value => value === undefined ? undefined : structuredClone(value);
class FakeFirestore {
  constructor() { this.data = new Map(); this.chain = Promise.resolve(); this.clock = Date.parse('2026-10-23T10:00:00.000Z'); }
  doc(path) { return new Ref(this, path); }
  collection(path) { return new Query(this, path); }
  async runTransaction(callback) {
    const task = this.chain.then(async () => {
      const writes = []; let wrote = false;
      const tx = {
        get: async ref => { if (wrote) throw new Error('Firestore reads must precede writes.'); return ref.get(); },
        create: (ref, value) => { wrote = true; writes.push(['create', ref, value]); },
        set: (ref, value, options) => { wrote = true; writes.push(['set', ref, value, options]); }
      };
      const result = await callback(tx), stamp = new Date(this.clock++).toISOString();
      function resolve(value) {
        if (value?.__serverTimestamp) return stamp;
        if (Array.isArray(value)) return value.map(resolve);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
        return value;
      }
      for (const [type, ref] of writes) if (type === 'create' && this.data.has(ref.path)) throw new Error('Already exists.');
      for (const [type, ref, value, options] of writes) this.data.set(ref.path, resolve(options?.merge ? { ...this.data.get(ref.path), ...copy(value) } : copy(value)));
      return result;
    });
    this.chain = task.catch(() => {}); return task;
  }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1); }
  collection(name) { return new Query(this.db, this.path + '/' + name); }
  async get() { const value = copy(this.db.data.get(this.path)); return { exists: value !== undefined, id: this.id, data: () => value }; }
  async set(value, options) { return this.db.runTransaction(async tx => { tx.set(this, value, options); }); }
}
class Query {
  constructor(db, path, field, after, limit) { Object.assign(this, { db, path, field, after, max: limit }); }
  doc(id) { return new Ref(this.db, this.path + '/' + id); }
  orderBy(field) { return new Query(this.db, this.path, field, this.after, this.max); }
  startAfter(after) { return new Query(this.db, this.path, this.field, after, this.max); }
  limit(max) { return new Query(this.db, this.path, this.field, this.after, max); }
  async get() {
    let rows = [...this.db.data].filter(([key]) => key.startsWith(this.path + '/') && key.split('/').length === this.path.split('/').length + 1).map(([key, value]) => ({ id: key.split('/').at(-1), value: copy(value) }));
    if (this.field) rows.sort((a, b) => a.value[this.field] < b.value[this.field] ? -1 : a.value[this.field] > b.value[this.field] ? 1 : a.id.localeCompare(b.id));
    if (this.after !== undefined) rows = rows.filter(row => row.value[this.field] > this.after);
    if (this.max !== undefined) rows = rows.slice(0, this.max);
    return { size: rows.length, docs: rows.map(row => ({ id: row.id, data: () => row.value })) };
  }
}
function fixture() {
  const db = new FakeFirestore(), calls = [], revoked = new Set();
  const emails = [1, 2, 3, 4, 5].map(i => 'approved' + i + '@example.test');
  db.data.set('_config/access', { enabled: true, approvedEmails: emails });
  const identities = Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => ['token-' + i, { uid: 'uid-' + i, email: i === 6 ? 'sixth@example.test' : emails[i - 1], email_verified: true,
    name: 'User ' + i, picture: 'https://example.test/avatar.png', firebase: { sign_in_provider: 'google.com' } }]));
  const services = { db, timestamp: () => ({ __serverTimestamp: true }), auth: { verifyIdToken: async (token, checkRevoked) => {
    calls.push({ token, checkRevoked }); if (!identities[token] || revoked.has(token)) throw new Error('Private token diagnostics must not escape.'); return identities[token];
  } } };
  const handler = createHandler(() => services);
  async function call(token = 'token-1', method = 'GET', body, query = {}, headers = {}) {
    const response = await handler({ httpMethod: method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers },
      queryStringParameters: query, body: body === undefined ? '' : JSON.stringify(body) });
    return { ...response, json: JSON.parse(response.body) };
  }
  function request(token = 'token-1') {
    return async (query = '', body) => {
      const result = await call(token, body ? 'POST' : 'GET', body, Object.fromEntries(new URLSearchParams(query.replace(/^\?/, ''))));
      if (result.statusCode >= 400) throw Object.assign(new Error('Mock API failed.'), { status: result.statusCode, code: result.json.error });
      return result.json;
    };
  }
  return { db, calls, revoked, emails, identities, services, handler, call, request };
}
const engineFile = path.resolve(__dirname, '../../src/cloud/sync-engine.js');
function loadEngine() {
  const result = buildSync({ entryPoints: [engineFile], bundle: true, platform: 'node', format: 'cjs', write: false });
  const mod = new Module(engineFile); mod.filename = engineFile; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, engineFile); return mod.exports;
}
function memoryStorage(uid = 'uid-1', vault = new Map()) {
  const local = new Map(), databases = new Map(Object.keys(schema.databases).map(name => [name, new Map()]));
  const storage = { uid, vault, local, databases,
    load: async key => copy(vault.get(key)), save: async (key, value) => { vault.set(key, copy(value)); },
    localSnapshot: () => Object.fromEntries(local), apply: (key, value) => { if (value === null) local.delete(key); else local.set(key, value); },
    snapshot: async () => ({ meta: { ownerUid: storage.uid, formatVersion: 2 }, localStorage: Object.fromEntries(local), indexedDB: [...databases].filter(([, files]) => files.size).map(([name, files]) => ({ name, stores: { [schema.databases[name]]: { keyPath: 'id', records: [...files].map(([key, value]) => ({ key, value })) } } })) }),
    files: async name => [...databases.get(name).values()].map(copy),
    putFile: async (name, record, removeId) => { if (removeId !== undefined) databases.get(name).delete(removeId); else databases.get(name).set(record.id, copy(record)); }
  };
  return storage;
}
function commitBody(key, value, baseVersion = 0, opId = crypto.randomUUID().replace(/-/g, '')) {
  return { action: 'commit', key, value, baseVersion, opId, kind: 'change', occurredAt: '2026-10-20T11:12:13.000Z' };
}
module.exports = { FakeFirestore, fixture, loadEngine, memoryStorage, commitBody, schema };
