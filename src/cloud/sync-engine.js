// The engine is transport-independent so tests can exercise real queue and
// concurrency behavior with mocked identities, without production bypasses.
export async function digest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
}
export function recordCounts(raw) {
  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value)) return { entries: value.length };
    if (value && typeof value === 'object') return { fields: Object.keys(value).length, arrays: Object.fromEntries(Object.entries(value).filter(([, entries]) => Array.isArray(entries)).map(([name, entries]) => [name, entries.length])) };
    return { scalar: 1 };
  } catch { return { rawCharacters: raw.length }; }
}
export function operationId() { return crypto.randomUUID().replace(/-/g, ''); }
const blobBytes = blob => blob.arrayBuffer ? blob.arrayBuffer() : new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
});
function base64(buffer) {
  let text = ''; const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function unbase64(text) { return Uint8Array.from(atob(text), char => char.charCodeAt(0)); }

const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export async function fingerprint(snapshot) {
  const files = [];
  for (const database of snapshot.indexedDB || []) {
    for (const [store, contents] of Object.entries(database.stores || {})) {
      for (const entry of contents.records || []) {
        const file = entry.value?.blob instanceof Blob;
        files.push([database.name, store, entry.key, file ? await digest(await blobBytes(entry.value.blob)) : null, file ? { ...entry.value, blob: null } : entry.value]);
      }
    }
  }
  const local = Object.entries(snapshot.localStorage || {}).sort(([a], [b]) => lexical(a, b));
  const unsupported = Object.entries(snapshot.unsupportedLocalStorage || {}).sort(([a], [b]) => lexical(a, b));
  files.sort((a, b) => lexical(JSON.stringify(a.slice(0, 3)), JSON.stringify(b.slice(0, 3))));
  return digest(JSON.stringify([local, unsupported, files]));
}

export class CloudSync {
  constructor({ storage, schema, request, onStatus = () => {}, onFatal = () => {}, onRemote = async () => true, online = () => navigator.onLine !== false, wait = ms => new Promise(r => setTimeout(r, ms)), id = operationId }) {
    Object.assign(this, { storage, schema, request, onStatus, onFatal, onRemote, online, wait, id });
    this.uid = storage.uid; this.queue = []; this.records = new Map(); this.sequence = -1;
    this.persistence = Promise.resolve(); this.active = true; this.blocked = false; this.initialized = false;
    this.unsupportedKeys = new Set(); this.attachmentWork = Promise.resolve(); this.observedFiles = new Map();
  }
  status(status, extra = {}) {
    if (status === 'saved' && this.unsupportedKeys.size) { status = 'unsupported'; extra = { ...extra, message: 'Supported stores are saved. Additional local-only data remains in the account backup, but has not been uploaded.' }; }
    this.lastStatus = { status, pending: this.queue.length, ...extra }; this.onStatus(this.lastStatus); }
  persist() {
    // Capture immediately: a later mutation must not change what this write means.
    const snapshot = this.queue.slice();
    this.persistence = this.persistence.then(() => this.storage.save('queue:' + this.uid, snapshot));
    this.persistence.catch(() => { this.blocked = true; this.status('failed', { message: 'Recovery storage is full or unavailable. Export a backup before closing this page.' }); });
    return this.persistence;
  }
  assertOwner() {
    if (!this.active || this.storage.uid !== this.uid) throw Object.assign(new Error('The account session changed. Pending data is retained.'), { status: 401 });
  }
  async initialize(initialState) {
    this.assertOwner();
    this.queue = await this.storage.load('queue:' + this.uid) || [];
    this.assertOwner();
    if (!Array.isArray(this.queue) || this.queue.some(op => !this.schema.isKey(op.key))) throw new Error('Recovery queue needs attention.');
    const state = initialState || await this.request('?action=state');
    this.profile = state.profile; this.sequence = state.sequence;
    state.records.forEach(record => this.records.set(record.key, record));
    // A tiny synchronous journal protects the last local mutation even when a
    // tab closes before its async IndexedDB queue transaction can complete.
    const recovered = this.storage.recoverJournal?.() || [];
    for (const entry of this.storage.recoverFileJournal?.() || []) {
      const file = (await this.storage.files(entry.database, false)).find(record => record.id === entry.id);
      const metadata = file ? { ...file } : null; if (metadata) delete metadata.blob;
      recovered.push({ ...entry, value: file ? JSON.stringify(metadata) : null, fileRecord: file, database: entry.database });
    }
    for (const entry of recovered) {
      if (!this.queue.some(op => op.opId === entry.opId)) {
        const previous = this.queue.filter(op => op.key === entry.key).at(-1);
        this.queue.push({ ...entry, kind: 'change', baseVersion: previous ? previous.baseVersion + 1 : entry.baseVersion });
      }
    }
    if (recovered.length) await this.persist();
    // Save an account-scoped recovery copy before replacing stale browser cache.
    await this.archiveRecovery(await this.storage.snapshot(false), 'before-cloud-restore');
    this.assertOwner();
    const pendingKeys = new Set(this.queue.map(op => op.key));
    for (const key of Object.keys(this.storage.localSnapshot())) {
      if (!pendingKeys.has(key) && !this.records.has(key)) this.storage.apply(key, null);
    }
    for (const record of this.schema.sortRecords(state.records)) {
      if (!pendingKeys.has(record.key)) await this.applyRemote(record);
    }
    for (const op of this.queue) {
      if (this.schema.isLocalKey(op.key)) this.storage.apply(op.key, op.value);
      else if (op.fileRecord) await this.storage.putFile(op.database, op.fileRecord);
    }
    this.initialized = true;
    if (this.queue.length) {
      await this.flush();
      if (this.active && !this.blocked && !this.queue.length) {
        const latest = await this.request('?action=state');
        for (const record of this.schema.sortRecords(latest.records)) {
          if (pendingKeys.has(record.key) || this.records.get(record.key)?.version !== record.version) await this.applyRemote(record);
          this.records.set(record.key, record);
        }
        this.sequence = latest.sequence;
      }
    } else this.status('saved');
    return state;
  }
  async archiveRecovery(snapshot, reason) {
    this.assertOwner();
    if (!Object.keys(snapshot.localStorage || {}).length && !(snapshot.indexedDB || []).some(db => Object.values(db.stores || {}).some(store => store.records?.length)) && !Object.keys(snapshot.unsupportedLocalStorage || {}).length) return null;
    const checksum = await fingerprint(snapshot), key = 'recovery:' + this.uid + ':' + checksum;
    this.assertOwner();
    if (!await this.storage.load(key)) await this.storage.save(key, snapshot);
    const indexKey = 'recovery-index:' + this.uid, index = await this.storage.load(indexKey) || [];
    const previous = index.find(entry => entry.key === key);
    await this.storage.save(indexKey, [...index.filter(entry => entry.key !== key), { key, capturedAt: previous?.capturedAt || snapshot.meta?.exportedAt || new Date().toISOString(), localKeys: Object.keys(snapshot.localStorage || {}).length, reasons: [...new Set([...(previous?.reasons || []), reason])] }]);
    return key;
  }
  enqueue(key, value, options = {}) {
    if (!this.active || !this.schema.isKey(key)) {
      if (this.active && !this.schema.isLocalOnly?.(key)) { this.unsupportedKeys.add(key); this.status('unsupported', { message: 'A new local-only setting is not in the sync inventory. It remains on this device; export a backup.' }); }
      return;
    }
    const previous = this.queue.filter(op => op.key === key).at(-1);
    const baseVersion = previous ? previous.baseVersion + 1 : this.records.get(key)?.version || 0;
    const op = { key, value, baseVersion, opId: options.opId || this.id(), occurredAt: options.kind === 'migration' ? null : new Date().toISOString(), kind: options.kind || 'change', ...options };
    if (this.queue.some(item => item.opId === op.opId)) return;
    this.queue.push(op); this.persist();
    this.status(this.online() ? 'saving' : 'offline');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }
  async prepareAttachment(op) {
    if (!op.fileRecord || op.value === null) return;
    const blob = op.fileRecord.blob;
    if (!blob || blob.size > 250 * 1024 * 1024) throw Object.assign(new Error('An attachment is larger than the supported 250 MiB limit. Keep the recovery backup.'), { status: 413 });
    const count = Math.ceil(blob.size / (192 * 1024));
    const metadata = { ...op.fileRecord }; delete metadata.blob;
    // Sequential chunks bound memory and allow durable, idempotent retry.
    for (let index = 0; index < count; index++) {
      const data = base64(await blobBytes(blob.slice(index * 192 * 1024, (index + 1) * 192 * 1024)));
      await this.request('', { action: 'stage', opId: op.opId, index, data });
      this.status('saving', { attachmentProgress: Math.round((index + 1) / count * 100) });
    }
    const bytes = await blobBytes(blob);
    op.attachment = { uploadId: op.opId, database: op.database, record: metadata, count, bytes: blob.size, digest: await digest(bytes) };
    op.value = JSON.stringify(metadata);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.inflight) return this.inflight;
    if (!this.active || this.blocked) return false;
    this.inflight = this.runQueue().catch(error => {
      this.status('failed', { message: 'Sync failed. Your pending changes are retained on this device.' });
      return false;
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }
  async runQueue() {
    await this.attachmentWork; await this.persistence;
    while (this.active && this.queue.length) {
      if (!this.online()) { this.status('offline'); return false; }
      const op = this.queue[0]; let accepted;
      for (let attempt = 0; attempt < 5 && this.active; attempt++) {
        try {
          this.status('saving');
          await this.prepareAttachment(op);
          const body = { action: 'commit', opId: op.opId, key: op.key, value: op.value, baseVersion: op.baseVersion,
            occurredAt: op.occurredAt, kind: op.kind, migrationId: op.migrationId || null };
          if (op.attachment) body.attachment = op.attachment;
          accepted = await this.request('', body);
          break;
        } catch (error) {
          if ([401, 403].includes(error.status) || ['access-unavailable', 'configuration-unavailable'].includes(error.code)) { this.stop(); this.onFatal(error); return false; }
          if (error.status === 409) { this.blocked = true; this.conflict = op; this.status('conflict', { key: op.key }); return false; }
          if (!this.online()) { this.status('offline'); return false; }
          if (attempt === 4 || error.status && error.status < 500 && error.status !== 429) {
            this.status('failed', { message: error.status === 413 ? 'This store is too large to sync. Export a backup and reduce its size.' : 'Sync failed. Pending changes are retained. Retry when connected.' }); return false;
          }
          this.status('retrying', { attempt: attempt + 1 });
          await this.wait(Math.min(16000, 1000 * 2 ** attempt));
        }
      }
      if (!accepted || !this.active) return false;
      const current = this.records.get(op.key);
      if (!current || current.version <= accepted.version) this.records.set(op.key, { ...current, key: op.key, id: current?.id || op.key,
        version: accepted.version, sequence: accepted.sequence, updatedAt: accepted.updatedAt, deleted: op.value === null, digest: accepted.digest, attachment: op.attachment || null });
      this.storage.setVersion?.(op.key, Math.max(accepted.version, this.records.get(op.key)?.version || 0));
      this.queue.shift(); await this.persist();
      this.storage.cleanJournal?.(op.key, op.journalId || op.opId, op.journalKind);
    }
    if (this.active && !this.queue.length) this.status('saved', { confirmedAt: new Date().toISOString() });
    return this.queue.length === 0;
  }
  async applyRemote(record) {
    this.assertOwner();
    this.storage.setVersion?.(record.key, record.version);
    if (this.schema.isLocalKey(record.key)) {
      const data = record.deleted ? { value: null } : await this.request('?action=read&key=' + encodeURIComponent(record.key));
      if (data.record && data.record.version !== record.version) throw new Error('Cloud changed during restore. Retry safely.');
      this.assertOwner();
      this.storage.apply(record.key, data.value);
    } else if (record.deleted) {
      // A deletion keeps its attachment identity in older immutable payloads;
      // the local key is resolved from the account's cached file inventory.
      for (const database of Object.keys(this.schema.databases)) {
        for (const value of await this.storage.files(database, false)) {
          if (this.schema.attachmentKey(database, value.id) === record.key) { this.assertOwner(); await this.storage.putFile(database, null, value.id); }
        }
      }
    } else if (record.attachment) {
      const a = record.attachment;
      const parts = [];
      for (let index = 0; index < a.count; index++) {
        const chunk = await this.request('?action=chunk&key=' + encodeURIComponent(record.key) + '&uploadId=' + a.uploadId + '&index=' + index);
        const bytes = unbase64(chunk.data);
        if (await digest(bytes) !== chunk.digest) throw new Error('Attachment integrity check failed.');
        parts.push(bytes);
      }
      const blob = new Blob(parts, { type: a.record.type || 'application/octet-stream' });
      if (blob.size !== a.bytes || await digest(await blobBytes(blob)) !== a.digest) throw new Error('Attachment integrity check failed.');
      this.assertOwner();
      await this.storage.putFile(a.database, { ...a.record, blob });
      this.observedFiles.set(record.key, a.digest + ':' + JSON.stringify(a.record));
    }
  }
  async poll() {
    if (!this.active || this.inflight || this.queue.length || !this.online()) return;
    try {
      const state = await this.request('?action=state&since=' + this.sequence);
      if (state.unchanged) return;
      const changed = state.records.filter(record => record.version !== this.records.get(record.key)?.version);
      if (changed.length && !await this.onRemote(changed)) { this.status('remote'); return; }
      for (const record of this.schema.sortRecords(changed)) await this.applyRemote(record);
      state.records.forEach(record => this.records.set(record.key, record)); this.sequence = state.sequence;
      this.status('saved');
    } catch (error) {
      if ([401, 403].includes(error.status) || ['access-unavailable', 'configuration-unavailable'].includes(error.code)) { this.stop(); this.onFatal(error); }
      else this.status(this.online() ? 'failed' : 'offline');
    }
  }
  async resolveConflict(keepLocal) {
    if (!this.conflict) return;
    const key = this.conflict.key;
    await this.storage.save('conflict:' + this.uid + ':' + this.id(), { archivedAt: new Date().toISOString(), operations: this.queue.filter(op => op.key === key) });
    const cloud = await this.request('?action=read&key=' + encodeURIComponent(key));
    this.records.set(key, cloud.record);
    if (keepLocal) {
      let version = cloud.record.version;
      this.queue.filter(op => op.key === key).forEach(op => { op.baseVersion = version++; op.journalId = op.journalId || op.opId; op.opId = this.id(); delete op.attachment; });
    } else {
      this.queue.filter(op => op.key === key).forEach(op => this.storage.cleanJournal?.(key, op.journalId || op.opId, op.journalKind));
      this.queue = this.queue.filter(op => op.key !== key);
      await this.applyRemote(cloud.record);
    }
    this.blocked = false; this.conflict = null; await this.persist();
    return this.flush();
  }
  async scanAttachments() {
    // Serialized with other scans; no hashing of the entire inventory on each keystroke.
    this.attachmentWork = this.attachmentWork.catch(() => {}).then(async () => {
      const journals = new Map((this.storage.recoverFileJournal?.() || []).map(entry => [entry.key, entry]));
      const journalOptions = key => { const entry = journals.get(key); return entry ? { opId: entry.opId, occurredAt: entry.occurredAt, journalKind: 'file' } : {}; };
      for (const database of Object.keys(this.schema.databases)) {
        const seen = new Set();
        for (const record of await this.storage.files(database, false)) {
          const key = this.schema.attachmentKey(database, record.id), metadata = { ...record }; delete metadata.blob;
          const checksum = await digest(await blobBytes(record.blob)) + ':' + JSON.stringify(metadata); seen.add(key);
          if (this.observedFiles.get(key) !== checksum) {
            const cloud = this.records.get(key)?.attachment;
            if (!cloud || cloud.digest + ':' + JSON.stringify(cloud.record) !== checksum) this.enqueue(key, JSON.stringify(metadata), { database, fileRecord: record, ...journalOptions(key) });
            this.observedFiles.set(key, checksum);
          }
        }
        for (const key of this.observedFiles.keys()) {
          if (key.startsWith('idb:' + database + ':') && !seen.has(key)) { this.enqueue(key, null, journalOptions(key)); this.observedFiles.delete(key); }
        }
      }
    });
    return this.attachmentWork;
  }
  async importSnapshot(snapshot, { migrationId, replace = false, kind = 'migration' } = {}) {
    this.assertOwner();
    if (snapshot.meta?.ownerUid && snapshot.meta.ownerUid !== this.uid) throw new Error('This backup belongs to a different account.');
    const expected = [], skipped = Object.keys(snapshot.unsupportedLocalStorage || {});
    for (const [key, value] of Object.entries(snapshot.localStorage || {})) {
      if (!this.schema.isLocalKey(key) || typeof value !== 'string') { skipped.push(key); continue; }
      const checksum = await digest(value), cloud = this.records.get(key);
      if (cloud?.digest === checksum && !cloud.deleted) { expected.push({ key, digest: checksum, counts: recordCounts(value) }); continue; }
      if (cloud && !cloud.deleted && !replace) { skipped.push(key); continue; }
      expected.push({ key, digest: checksum, counts: recordCounts(value) });
      const opId = 'm_' + (await digest(this.uid + '|' + migrationId + '|' + key)).slice(0, 48);
      this.assertOwner();
      this.storage.apply(key, value);
      this.enqueue(key, value, { opId, kind, migrationId });
    }
    for (const db of snapshot.indexedDB || []) {
      const store = this.schema.databases[db.name];
      if (!store) { skipped.push(db.name); continue; }
      for (const entry of db.stores?.[store]?.records || []) {
        const file = entry.value, key = this.schema.attachmentKey(db.name, file.id), metadata = { ...file }; delete metadata.blob;
        const checksum = await digest(await blobBytes(file.blob));
        const cloud = this.records.get(key);
        if (cloud && !cloud.deleted && !replace && cloud.attachment?.digest !== checksum) { skipped.push(key); continue; }
        expected.push({ key, attachmentDigest: checksum, digest: await digest(JSON.stringify(metadata)) });
        if (cloud?.attachment?.digest === checksum && cloud.digest === await digest(JSON.stringify(metadata))) continue;
        this.assertOwner();
        await this.storage.putFile(db.name, file);
        this.enqueue(key, JSON.stringify(metadata), { opId: 'm_' + (await digest(this.uid + '|' + migrationId + '|' + key)).slice(0, 48), kind, migrationId, database: db.name, fileRecord: file });
      }
    }
    await this.persist();
    if (!await this.flush()) throw new Error('Import paused. Pending writes are retained. Reconnect and retry; do not clear browser data.');
    for (const item of expected) {
      const saved = await this.request('?action=read&key=' + encodeURIComponent(item.key));
      if (item.counts && JSON.stringify(recordCounts(saved.value)) !== JSON.stringify(item.counts)) throw new Error('Import record-count verification failed. Original backup is retained.');
      if (saved.record.deleted || saved.record.digest !== item.digest || item.attachmentDigest && saved.record.attachment?.digest !== item.attachmentDigest) throw new Error('Import verification failed. The source and recovery backup are retained.');
    }
    const report = { featureCounts: Object.fromEntries(expected.filter(item => item.counts).map(item => [item.key, item.counts])), migrationId, verifiedAt: new Date().toISOString(), verified: expected.length, skipped, localKeys: Object.keys(snapshot.localStorage || {}).length, attachmentRecords: (snapshot.indexedDB || []).reduce((n, db) => n + (db.stores?.[this.schema.databases[db.name]]?.records?.length || 0), 0) };
    await this.storage.save('migration-report:' + this.uid + ':' + migrationId, report);
    this.status('saved', { migration: report }); return report;
  }
  stop() { this.active = false; clearTimeout(this.timer); }
}
export { blobBytes, base64, unbase64 };
