/* Installed synchronously before the legacy app can read any user data. */
(function () {
  'use strict';
  if (window.AriseStorage) return;
  var schema = window.AriseSyncSchema;
  var native = window.localStorage;
  var nativeOpen = window.indexedDB && window.indexedDB.open.bind(window.indexedDB);
  var uid = null, prefix = null, quiet = 0, quietIDB = 0, internalTransactions = new WeakSet();
  var listeners = [];
  var deviceKey = function (key) { return /^(firebase:|__sak|arise-perf-mode$|arise-chunks$)/.test(key); };
  var physical = function (key) { return prefix + encodeURIComponent(key); };
  function emit(key, value, journal) { listeners.forEach(function (listener) { listener(key, value, journal); }); }
  function journalKey(key, file) { return 'arise:' + (file ? 'file-journal:' : 'journal:') + encodeURIComponent(uid) + ':' + encodeURIComponent(key); }
  function versionKey(key) { return 'arise:version:' + encodeURIComponent(uid) + ':' + encodeURIComponent(key); }
  function getVersion(key) { var value = Number(native.getItem(versionKey(key))); return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
  function markDirty(key, file, extra) {
    var entry = Object.assign({ key: key, opId: crypto.randomUUID().replace(/-/g, ''), baseVersion: getVersion(key), occurredAt: new Date().toISOString(), journalKind: file ? 'file' : 'local' }, extra || {});
    native.setItem(journalKey(key, file), JSON.stringify(entry)); return entry;
  }
  // A journal entry is the local record of a mutation that has not reached the
  // server yet, so it is the one piece of data we cannot afford to lose - but a
  // partially written, older-format or tampered entry must never be able to
  // stop the whole sync. Previously one unparsable value threw out of
  // recover(), which aborted initialize() and left the account permanently
  // un-synced with no way for the user to see why.
  var quarantined = [];
  function quarantine(key, reason) {
    quarantined.push({ key: key, reason: reason });
    if (quarantined.length > 20) quarantined.shift();
    try { native.setItem('arise:journal-corrupt:' + encodeURIComponent(uid) + ':' + Date.now(), key); } catch (_) {}
  }
  function parseJournal(raw, file) {
    if (typeof raw !== 'string' || !raw) return null;
    var entry;
    try { entry = JSON.parse(raw); } catch (_) { return null; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (typeof entry.key !== 'string' || !schema.isKey(entry.key)) return null;
    if (typeof entry.opId !== 'string' || !/^[a-z0-9]{8,80}$/i.test(entry.opId)) return null;
    if (typeof entry.occurredAt !== 'string' || !Number.isFinite(Date.parse(entry.occurredAt))) return null;
    var base = Number(entry.baseVersion);
    if (!Number.isSafeInteger(base) || base < 0) entry.baseVersion = 0; else entry.baseVersion = base;
    if (file) {
      if (typeof entry.database !== 'string' || !entry.database) return null;
      if (typeof entry.id !== 'string' || !entry.id) return null;
    }
    return entry;
  }
  function recover(file) {
    var result = [], start = 'arise:' + (file ? 'file-journal:' : 'journal:') + encodeURIComponent(uid) + ':';
    for (var i = 0; i < native.length; i++) {
      var key = native.key(i);
      if (!key || !key.startsWith(start)) continue;
      var entry = parseJournal(native.getItem(key), file);
      if (entry) result.push(entry);
      else quarantine(key, 'unreadable journal entry');
    }
    return result.sort(function (a, b) { return a.occurredAt.localeCompare(b.occurredAt) || a.opId.localeCompare(b.opId); });
  }
  var cachedKeys = null, cachedNativeLen = -1;
  function invalidateKeys() { cachedKeys = null; cachedNativeLen = -1; }
  function accountKeys() {
    if (!prefix) return [];
    if (cachedKeys && cachedNativeLen === native.length) return cachedKeys;
    var result = [];
    for (var i = 0; i < native.length; i++) {
      var key = native.key(i);
      if (key && key.indexOf(prefix) === 0) result.push(decodeURIComponent(key.slice(prefix.length)));
    }
    cachedKeys = result.sort();
    cachedNativeLen = native.length;
    return cachedKeys;
  }
  var facade = {
    getItem: function (key) { key = String(key); return deviceKey(key) ? native.getItem(key) : uid ? native.getItem(physical(key)) : null; },
    setItem: function (key, value) {
      key = String(key); value = String(value);
      if (deviceKey(key)) { invalidateKeys(); return native.setItem(key, value); }
      if (!uid) throw new DOMException('Sign in before changing progress.', 'SecurityError');
      var phys = physical(key);
      var old = native.getItem(phys);
      if (old === value) return;
      var previousMarker = !quiet && schema.isLocalKey(key) ? native.getItem(journalKey(key, false)) : null;
      var marker = !quiet && schema.isLocalKey(key) ? markDirty(key, false) : null;
      try { native.setItem(phys, value); if (old === null) invalidateKeys(); }
      catch (error) {
        if (marker) { if (previousMarker) native.setItem(journalKey(key, false), previousMarker); else native.removeItem(journalKey(key, false)); }
        try {
          if (error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22)) {
            window.dispatchEvent(new CustomEvent('arise:storage-quota', { detail: { key: key } }));
          }
        } catch (notifyError) {}
        throw error;
      }
      if (!quiet) emit(key, value, marker);
    },
    removeItem: function (key) {
      key = String(key);
      if (deviceKey(key)) { invalidateKeys(); return native.removeItem(key); }
      if (!uid) return;
      var phys = physical(key);
      var old = native.getItem(phys);
      var marker = !quiet && old !== null && schema.isLocalKey(key) ? markDirty(key, false) : null;
      native.removeItem(phys);
      if (old !== null) invalidateKeys();
      if (!quiet && old !== null) emit(key, null, marker);
    },
    clear: function () { accountKeys().slice().forEach(function (key) { facade.removeItem(key); }); },
    key: function (index) { return accountKeys()[index] || null; }
  };
  Object.defineProperty(facade, 'length', { get: function () { return accountKeys().length; } });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: facade });

  // The two feature-owned attachment databases are isolated by immutable UID.
  // Other databases (including Firebase's own session persistence) are untouched.
  function databaseName(name) { return 'arise-account-' + encodeURIComponent(uid) + '--' + name; }
  if (nativeOpen) {
    window.indexedDB.open = function (name, version) {
      if (schema.databases[name]) {
        if (!uid) throw new DOMException('Sign in to access attachments.', 'SecurityError');
        name = databaseName(name);
      }
      return version === undefined ? nativeOpen(name) : nativeOpen(name, version);
    };
    if (window.IDBDatabase) {
      var transact = window.IDBDatabase.prototype.transaction;
      window.IDBDatabase.prototype.transaction = function () {
        var transaction = transact.apply(this, arguments);
        var currentName = this.name || '';
        var base = Object.keys(schema.databases).find(function (name) { return currentName.endsWith('--' + name); });
        if (arguments[1] === 'readwrite' && schema.databases[base] && !quietIDB) {
          transaction.addEventListener('complete', function () {
            window.dispatchEvent(new CustomEvent('arise:attachment-change', { detail: { database: base } }));
          });
        }
        return transaction;
      };
    }
  }

  if (window.IDBObjectStore) {
    // Aborted ancestors matter when two pending transactions touch the same ID.
    // Retain only aborted marker ancestry; ordinary successful writes add none.
    var abortedMarkers = new Map();
    function markFile(tx, database, id) {
      if (typeof id !== 'string' && typeof id !== 'number') return;
      var key = schema.attachmentKey(database, id), physicalMarker = journalKey(key, true);
      var before = native.getItem(physicalMarker);
      var entry = markDirty(key, true, { database: database, id: id });
      tx.addEventListener('abort', function () {
        abortedMarkers.set(entry.opId, before);
        var current = native.getItem(physicalMarker);
        if (current && JSON.parse(current).opId === entry.opId) {
          var restore = before;
          while (restore && abortedMarkers.has(JSON.parse(restore).opId)) restore = abortedMarkers.get(JSON.parse(restore).opId);
          if (restore) native.setItem(physicalMarker, restore); else native.removeItem(physicalMarker);
        }
      });
    }
    ['add', 'put', 'delete', 'clear'].forEach(function (method) {
      var original = window.IDBObjectStore.prototype[method];
      window.IDBObjectStore.prototype[method] = function (value) {
        var tx = this.transaction, currentName = tx.db.name || '', owner = uid;
        var database = Object.keys(schema.databases).find(function (name) { return currentName === databaseName(name); });
        if (!owner || !database || internalTransactions.has(tx)) return original.apply(this, arguments);
        var bulk = method === 'clear' || method === 'delete' && typeof value !== 'string' && typeof value !== 'number';
        // Queue the inventory read BEFORE the native clear/range-delete. The
        // mutation's actual IDBRequest and native transaction API are preserved.
        var inventory = bulk ? (method === 'clear' ? this.getAllKeys() : this.getAllKeys(value)) : null;
        var request = original.apply(this, arguments); // DataClone/DataError must not leave a marker.
        function mark(ids) {
          try {
            if (uid !== owner) throw new Error('The account changed before the file operation completed.');
            ids.forEach(function (id) { markFile(tx, database, id); });
          } catch (error) {
            try { tx.abort(); } catch (ignore) {}
            window.dispatchEvent(new CustomEvent('arise:attachment-error'));
            throw error;
          }
        }
        if (inventory) inventory.addEventListener('success', function () {
          try { mark(inventory.result); } catch (error) { /* Abort cancels the operation; caller receives native AbortError. */ }
        });
        else mark([method === 'delete' ? value : value && value.id]);
        return request;
      };
    });
  }

  // Not a security/authorization boundary: just prevents accidental cross-account
  // mixing in the legacy UI. Actual authorization is exclusively server-enforced.
  function openDB(name, legacy) {
    if (!nativeOpen) return Promise.reject(new Error('Browser storage is unavailable.'));
    return new Promise(function (resolve, reject) {
      var request = nativeOpen(legacy ? name : databaseName(name), 1);
      request.onupgradeneeded = function () {
        var db = request.result, store = schema.databases[name];
        if (!db.objectStoreNames.contains(store)) {
          var data = db.createObjectStore(store, { keyPath: 'id' });
          if (store === 'files') data.createIndex('byOwner', ['ownerType', 'ownerId'], { unique: false });
          if (store === 'certFiles') data.createIndex('byCertificate', 'certificateId', { unique: false });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
      request.onblocked = function () { reject(new Error('Close other Arise tabs and retry.')); };
    });
  }
  async function files(database, legacy) {
    var db = await openDB(database, legacy);
    try {
      return await new Promise(function (resolve, reject) {
        var request = db.transaction(schema.databases[database], 'readonly').objectStore(schema.databases[database]).getAll();
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    } finally { db.close(); }
  }
  async function putFile(database, record, removeId) {
    var db = await openDB(database, false);
    try {
      await new Promise(function (resolve, reject) {
        // Suppress only this synchronous transaction creation/enqueue, never a
        // concurrent user transaction while awaiting this one's completion.
        quietIDB++;
        try {
          var tx = db.transaction(schema.databases[database], 'readwrite');
          internalTransactions.add(tx);
          var store = tx.objectStore(schema.databases[database]);
          if (removeId !== undefined) store.delete(removeId); else store.put(record);
          tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Attachment storage failed.')); };
        } catch (error) { reject(error); }
        finally { quietIDB--; }
      });
    } finally { db.close(); }
  }

  var vault;
  function vaultDB() {
    if (!vault) vault = new Promise(function (resolve, reject) {
      if (!nativeOpen) { reject(new Error('IndexedDB is required for safe recovery and sync.')); return; }
      var request = nativeOpen('arise-secure-sync-v1', 1);
      request.onupgradeneeded = function () { request.result.createObjectStore('state'); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return vault;
  }
  async function vaultAction(mode, key, value) {
    var db = await vaultDB();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('state', mode), store = tx.objectStore('state');
      var request = mode === 'readonly' ? store.get(key) : value === undefined ? store.delete(key) : store.put(value, key);
      tx.oncomplete = function () { resolve(request.result); };
      tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Recovery storage failed.')); };
    });
  }
  function localSnapshot() {
    var result = {};
    accountKeys().forEach(function (key) { if (schema.isLocalKey(key)) result[key] = facade.getItem(key); });
    return result;
  }
  async function snapshot(legacy) {
    var local = {}, unknown = [], retained = {};
    if (legacy) {
      for (var i = 0; i < native.length; i++) {
        var key = native.key(i);
        if (schema.isLocalKey(key)) local[key] = native.getItem(key);
        else if (key && !/^(arise:|firebase:|__|backupCenter:|userSession$|cloudSyncState$|arise-account-|arise-perf-mode$|arise-chunks$)/.test(key)) {
          unknown.push(key);
          if (!/(token|password|secret|credential|api.?key|sync.?code)/i.test(key)) retained[key] = native.getItem(key);
        }
      }
    } else {
      local = localSnapshot();
      accountKeys().forEach(function (key) {
        if (!schema.isLocalKey(key) && !schema.isLocalOnly(key) && !/(token|password|secret|credential|api.?key|sync.?code)/i.test(key)) { unknown.push(key); retained[key] = facade.getItem(key); }
      });
    }
    var databases = [];
    for (var name of Object.keys(schema.databases)) {
      var entries = await files(name, legacy);
      if (entries.length) databases.push({ name: name, version: 1, stores: { [schema.databases[name]]: { keyPath: 'id', records: entries.map(function (value) { return { key: value.id, value: value }; }) } } });
    }
    return { meta: { app: 'Arise Dashboard', formatVersion: 2, schemaVersion: 1, ownerUid: legacy ? null : uid,
      exportedAt: new Date().toISOString(), originalEventTimes: 'Preserved only where present; export time is not historical event time.' }, localStorage: local, indexedDB: databases, unknownKeys: unknown, unsupportedLocalStorage: retained };
  }

  var resolveBoot;
  window.AriseBoot = { ready: new Promise(function (resolve) { resolveBoot = resolve; }), start: function () { resolveBoot(); } };
  window.AriseStorage = {
    get uid() { return uid; },
    acquire: function () {
      if (!navigator.locks) return Promise.reject(new Error('Use an up-to-date browser with Web Locks support for safe local recovery.'));
      var owner = uid;
      return new Promise(function (resolve, reject) {
        navigator.locks.request('arise-sync:' + owner, { ifAvailable: true }, function (lock) {
          if (!lock) { reject(new Error('This account is already open in another tab. Close it and retry.')); return; }
          return new Promise(function (release) { resolve(release); });
        }).catch(reject);
      });
    },
    activate: function (owner) { if (!owner || owner.includes('/')) throw new Error('Invalid owner.'); uid = owner; prefix = 'arise:account:' + encodeURIComponent(uid) + ':'; invalidateKeys(); },
    lock: function () { uid = prefix = null; invalidateKeys(); },
    onChange: function (listener) { listeners.push(listener); return function () { listeners = listeners.filter(function (entry) { return entry !== listener; }); }; },
    apply: function (key, value) {
      quiet++;
      try { value === null ? facade.removeItem(key) : facade.setItem(key, value); }
      finally { quiet--; }
      var event = new Event('storage');
      Object.defineProperties(event, { key: { value: key }, newValue: { value: value }, __ariseRemote: { value: true } });
      window.dispatchEvent(event);
    },
    localSnapshot: localSnapshot, snapshot: snapshot, files: files, putFile: putFile,
    getVersion: getVersion,
    setVersion: function (key, value) { native.setItem(versionKey(key), String(value)); },
    recoverJournal: function () { return recover(false).map(function (entry) { return Object.assign({}, entry, { value: facade.getItem(entry.key) }); }); },
    recoverFileJournal: function () { return recover(true); },
    cleanJournal: function (key, opId, kind) {
      var name = journalKey(key, kind === 'file'), raw = native.getItem(name);
      if (!raw) return false;
      // Only remove the marker we were asked to clear. If it is unreadable it
      // can never match an opId, so it would otherwise be retried on every
      // launch forever - quarantine it instead of parsing it blindly.
      var entry = parseJournal(raw, kind === 'file');
      if (!entry) { quarantine(name, 'unreadable journal marker'); return false; }
      if (entry.opId !== opId) return false;
      native.removeItem(name);
      return true;
    },
    journalHealth: function () { return { quarantined: quarantined.slice(), count: quarantined.length }; },
    save: function (key, value) { return vaultAction('readwrite', key, value); },
    load: function (key) { return vaultAction('readonly', key); },
    drop: function (key) { return vaultAction('readwrite', key); }
  };
})();
