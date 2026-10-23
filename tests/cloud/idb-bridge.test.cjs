'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBDatabase, IDBObjectStore, IDBKeyRange } = require('fake-indexeddb');

test('IndexedDB journal preserves native put/add/delete/range/clear/abort and quota-failure semantics in both actual file stores', async () => {
  const root = path.resolve(__dirname, '../..');
  const dom = new JSDOM('<!doctype html>', { url: 'https://example.test', runScripts: 'outside-only' });
  const w = dom.window, native = w.localStorage;
  w.indexedDB = new IDBFactory(); w.IDBDatabase = IDBDatabase; w.IDBObjectStore = IDBObjectStore; w.IDBKeyRange = IDBKeyRange;
  Object.defineProperty(w, 'crypto', { value: crypto }); w.TextEncoder = TextEncoder; w.Blob = Blob;
  for (const file of ['src/cloud/storage-schema.js', 'src/cloud/storage-bridge.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const storage = w.AriseStorage; storage.activate('uid-1');
  const clean = () => { for (const entry of storage.recoverFileJournal()) storage.cleanJournal(entry.key, entry.opId, 'file'); };
  const done = tx => new Promise(resolve => { tx.addEventListener('complete', () => resolve('complete')); tx.addEventListener('abort', () => resolve('abort')); });
  const file = (id, name = 'original.txt') => ({ id, name, uploadedAt: '2020-01-01', blob: new Blob(['original bytes']) });
  try {
    for (const [database, storeName] of Object.entries(w.AriseSyncSchema.databases)) {
      await storage.putFile(database, file('a')); await storage.putFile(database, file('b')); await storage.putFile(database, file('c'));
      const db = await new Promise((resolve, reject) => { const r = w.indexedDB.open(database, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      let tx = db.transaction(storeName, 'readwrite'), completed = done(tx), store = tx.objectStore(storeName);
      store.put(file('a', 'aborted-1')); store.put(file('a', 'aborted-2')); tx.abort();
      assert.equal(await completed, 'abort'); assert.equal(storage.recoverFileJournal().length, 0, 'two abort callbacks must not resurrect an aborted ancestor');
      assert.equal((await storage.files(database, false)).find(r => r.id === 'a').name, 'original.txt');

      const first = db.transaction(storeName, 'readwrite'), second = db.transaction(storeName, 'readwrite');
      const both = Promise.all([done(first), done(second)]);
      first.objectStore(storeName).put(file('a', 'first pending')); second.objectStore(storeName).put(file('a', 'second pending'));
      first.abort(); second.abort(); await both;
      assert.equal(storage.recoverFileJournal().length, 0, 'overlapping aborted transactions cannot leave a replay marker');

      tx = db.transaction(storeName, 'readwrite'); completed = done(tx); store = tx.objectStore(storeName);
      assert.throws(() => store.put({ id: 'a', blob: () => 'not cloneable' }), /clone|cloned/i);
      assert.equal(await completed, 'complete'); assert.equal(storage.recoverFileJournal().length, 0, 'a synchronous native exception never creates a marker');

      tx = db.transaction(storeName, 'readwrite'); completed = done(tx); store = tx.objectStore(storeName);
      store.put(file('a', 'committed pending')); await completed;
      const originalMarker = storage.recoverFileJournal().find(entry => entry.id === 'a').opId;
      tx = db.transaction(storeName, 'readwrite'); completed = done(tx); store = tx.objectStore(storeName);
      store.put(file('a', 'aborted later')); store.put(file('a', 'also aborted')); tx.abort(); await completed;
      assert.equal(storage.recoverFileJournal().find(entry => entry.id === 'a').opId, originalMarker, 'abort retains an earlier committed-but-unsent marker'); clean();

      tx = db.transaction(storeName, 'readwrite'); completed = done(tx);
      const request = tx.objectStore(storeName).delete(IDBKeyRange.bound('a', 'b'));
      assert.equal(request.source.name, storeName); assert.equal(await completed, 'complete');
      assert.deepEqual(Array.from(storage.recoverFileJournal(), entry => entry.id).sort(), ['a', 'b']);
      assert.deepEqual((await storage.files(database, false)).map(entry => entry.id), ['c']); clean();
      tx = db.transaction(storeName, 'readwrite'); completed = done(tx); tx.objectStore(storeName).clear(); await completed;
      assert.deepEqual(Array.from(storage.recoverFileJournal(), entry => entry.id), ['c']); assert.equal((await storage.files(database, false)).length, 0); clean();

      await storage.putFile(database, file('a')); await storage.putFile(database, file('b'));
      const prototype = Object.getPrototypeOf(native), originalSet = prototype.setItem;
      prototype.setItem = function (key, value) { if (key.startsWith('arise:file-journal:')) throw new w.DOMException('Full', 'QuotaExceededError'); return originalSet.call(this, key, value); };
      try {
        tx = db.transaction(storeName, 'readwrite'); completed = done(tx);
        assert.throws(() => tx.objectStore(storeName).put(file('a', 'must not commit')), /Full/);
        assert.equal(await completed, 'abort');
        tx = db.transaction(storeName, 'readwrite'); completed = done(tx); tx.objectStore(storeName).clear();
        assert.equal(await completed, 'abort', 'bulk clear aborts if its recovery marker cannot be stored');
      } finally { prototype.setItem = originalSet; }
      assert.equal((await storage.files(database, false)).find(entry => entry.id === 'a').name, 'original.txt');
      assert.equal((await storage.files(database, false)).length, 2); assert.equal(storage.recoverFileJournal().length, 0);
      const originalTransaction = w.IDBDatabase.prototype.transaction;
      let scheduled = false, finishOverlap;
      const overlappingUserWrite = new Promise(resolve => { finishOverlap = resolve; });
      w.IDBDatabase.prototype.transaction = function () {
        const transaction = originalTransaction.apply(this, arguments);
        if (!scheduled && arguments[1] === 'readwrite') {
          scheduled = true;
          queueMicrotask(() => {
            const user = db.transaction(storeName, 'readwrite');
            done(user).then(finishOverlap); user.objectStore(storeName).put(file('user-overlap'));
          });
        }
        return transaction;
      };
      try { await Promise.all([storage.putFile(database, file('internal-restore')), overlappingUserWrite]); }
      finally { w.IDBDatabase.prototype.transaction = originalTransaction; }
      assert.deepEqual(Array.from(storage.recoverFileJournal(), entry => entry.id), ['user-overlap'], 'a concurrent real user write must not be silenced by an internal restore transaction'); clean();
      db.close();
    }
  } finally { dom.window.close(); }
});
