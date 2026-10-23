'use strict';
const crypto = require('node:crypto');
const schema = require('../src/cloud/storage-schema.js');
const { ApiError, authorize, checkIdentity } = require('./access.cjs');
const { respond, fail, readBody } = require('./http.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const operationRE = /^[A-Za-z0-9_-]{16,100}$/;
const iso = value => value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value || null;
function wire(record) {
  return { ...record, createdAt: iso(record.createdAt), updatedAt: iso(record.updatedAt), importedAt: iso(record.importedAt) };
}
function validKey(key) { if (!schema.isKey(key)) throw new ApiError(400, 'unsupported-store'); return key; }
function validOp(id) { if (typeof id !== 'string' || !operationRE.test(id)) throw new ApiError(400, 'invalid-operation'); return id; }
function refs(db, uid, key, opId) {
  const user = db.doc('users/' + uid);
  return { user, record: user.collection('records').doc(hash(key)), receipt: user.collection('operations').doc(opId),
    payload: user.collection('payloads').doc(opId), activity: user.collection('activity').doc(opId) };
}
async function recheck(tx, db, decoded) {
  checkIdentity(decoded, (await tx.get(db.doc('_config/access'))).data());
}

async function readValue(db, uid, record) {
  if (record.deleted || record.attachment) return null;
  const parts = await db.collection('users/' + uid + '/payloads/' + record.payloadId + '/parts').orderBy('index').get();
  const value = parts.docs.map(doc => doc.data().text).join('');
  if (hash(value) !== record.digest) throw new ApiError(503, 'data-integrity-failed');
  return value;
}

async function stageChunk(services, actor, body) {
  const opId = validOp(body.opId);
  if (!Number.isInteger(body.index) || body.index < 0 || body.index >= 1400 || typeof body.data !== 'string' ||
      body.data.length > 270000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new ApiError(400, 'invalid-chunk');
  const bytes = Buffer.from(body.data, 'base64');
  if (!bytes.length || bytes.length > 192 * 1024 || bytes.toString('base64') !== body.data) throw new ApiError(400, 'invalid-chunk');
  const chunkRef = services.db.doc('users/' + actor.identity.uid + '/uploads/' + opId + '/chunks/' + body.index);
  const digest = hash(bytes);
  await services.db.runTransaction(async tx => {
    await recheck(tx, services.db, actor.decoded);
    const existing = await tx.get(chunkRef);
    if (existing.exists) {
      if (existing.data().digest !== digest) throw new ApiError(409, 'operation-reused');
      return;
    }
    tx.create(chunkRef, { index: body.index, data: body.data, digest, bytes: bytes.length, stagedAt: services.timestamp() });
  });
  return { ok: true, digest, index: body.index };
}

async function validateAttachment(services, uid, key, opId, attachment) {
  if (!attachment || attachment.uploadId !== opId || !Number.isInteger(attachment.count) || attachment.count < 1 || attachment.count > 1400 ||
      !Number.isInteger(attachment.bytes) || attachment.bytes > 250 * 1024 * 1024 || attachment.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(attachment.digest || '') || !schema.databases[attachment.database] ||
      typeof attachment.record !== 'object' || !attachment.record || !['string', 'number'].includes(typeof attachment.record.id) || attachment.record.blob ||
      schema.attachmentKey(attachment.database, attachment.record.id) !== key || Buffer.byteLength(JSON.stringify(attachment.record)) > 50000) {
    throw new ApiError(400, 'invalid-attachment');
  }
  const digest = crypto.createHash('sha256');
  let bytes = 0, index = 0;
  while (index < attachment.count) {
    const chunks = await services.db.collection('users/' + uid + '/uploads/' + opId + '/chunks').orderBy('index').startAfter(index - 1).limit(Math.min(50, attachment.count - index)).get();
    if (!chunks.size) throw new ApiError(400, 'incomplete-upload');
    for (const doc of chunks.docs) {
      const data = doc.data();
      if (data.index !== index++) throw new ApiError(400, 'incomplete-upload');
      const buffer = Buffer.from(data.data, 'base64'); digest.update(buffer); bytes += buffer.length;
    }
  }
  if (bytes !== attachment.bytes || digest.digest('hex') !== attachment.digest) throw new ApiError(400, 'data-integrity-failed');
  return attachment;
}

async function commit(services, actor, body) {
  const key = validKey(body.key), opId = validOp(body.opId), uid = actor.identity.uid;
  if (!Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0 || (typeof body.value !== 'string' && body.value !== null)) throw new ApiError(400, 'invalid-request');
  if (body.value !== null && Buffer.byteLength(body.value, 'utf8') > 4 * 1024 * 1024) throw new ApiError(413, 'store-too-large');
  if (body.kind && !['change', 'migration', 'restore'].includes(body.kind)) throw new ApiError(400, 'invalid-request');
  const r = refs(services.db, uid, key, opId);
  let attachment = null;
  if (schema.isAttachmentKey(key) && body.value !== null) {
    attachment = await validateAttachment(services, uid, key, opId, body.attachment);
    if (body.value !== JSON.stringify(attachment.record)) throw new ApiError(400, 'invalid-attachment');
  } else if (body.attachment) throw new ApiError(400, 'invalid-request');
  const digest = hash(body.value === null ? 'null' : body.value);
  const requestDigest = hash(JSON.stringify([key, body.value === null, body.baseVersion, digest, attachment, body.kind || 'change', body.migrationId || null]));
  let duplicate = false;
  await services.db.runTransaction(async tx => {
    await recheck(tx, services.db, actor.decoded);
    const [receipt, current, user] = await Promise.all([tx.get(r.receipt), tx.get(r.record), tx.get(r.user)]);
    if (receipt.exists) {
      if (receipt.data().requestDigest !== requestDigest) throw new ApiError(409, 'operation-reused');
      duplicate = true; return;
    }
    const previous = current.data();
    if ((previous?.version || 0) !== body.baseVersion) throw new ApiError(409, 'version-conflict');
    const sequence = (user.data()?.sequence || 0) + 1;
    const stamp = services.timestamp();
    const eventAt = body.kind === 'migration' ? null : (typeof body.occurredAt === 'string' && Number.isFinite(Date.parse(body.occurredAt)) ? new Date(body.occurredAt).toISOString() : null);
    const record = {
      id: hash(key), key, version: body.baseVersion + 1, schemaVersion: schema.version, sequence,
      createdAt: previous?.createdAt || stamp, updatedAt: stamp, deleted: body.value === null,
      digest, payloadId: opId, attachment, originalEventAt: eventAt,
      importedAt: body.kind === 'migration' ? stamp : previous?.importedAt || null
    };
    const parts = [];
    if (body.value !== null && !attachment) {
      for (let offset = 0; offset < body.value.length;) {
        let end = Math.min(offset + 75000, body.value.length);
        if (end < body.value.length && /[\uD800-\uDBFF]/.test(body.value[end - 1])) end--;
        parts.push(body.value.slice(offset, end)); offset = end;
      }
      if (!parts.length) parts.push('');
    }
    parts.forEach((text, index) => tx.create(r.payload.collection('parts').doc(String(index)), { index, text }));
    tx.create(r.payload, { key, digest, parts: parts.length, schemaVersion: 1, attachment, deleted: body.value === null, createdAt: stamp });
    tx.set(r.record, record);
    tx.set(r.user, { uid, profile: actor.identity, schemaVersion: 1, sequence, createdAt: user.data()?.createdAt || stamp, updatedAt: stamp }, { merge: true });
    tx.create(r.receipt, { key, version: record.version, sequence, requestDigest, createdAt: stamp });
    tx.create(r.activity, { id: opId, key, recordId: record.id, version: record.version, sequence, schemaVersion: 1,
      type: body.value === null ? 'delete' : body.kind || 'change', createdAt: stamp, originalEventAt: eventAt,
      migrationId: typeof body.migrationId === 'string' ? body.migrationId.slice(0, 100) : null, payloadId: opId });
  });
  // A receipt always reports its original accepted version, not a later edit.
  const receipt = (await r.receipt.get()).data();
  return { ok: true, duplicate, version: receipt.version, sequence: receipt.sequence, updatedAt: iso(receipt.createdAt), digest };
}

function createHandler(getServices) {
  return async function handler(event) {
    try {
      if (!['GET', 'POST'].includes(event.httpMethod)) throw new ApiError(405, 'method-not-allowed');
      const services = getServices();
      const actor = await authorize(event, services);
      const uid = actor.identity.uid, q = event.queryStringParameters || {};
      if (q.uid || q.path) throw new ApiError(400, 'invalid-request');
      if (event.httpMethod === 'POST') {
        const body = readBody(event);
        if (body.uid || body.path) throw new ApiError(400, 'invalid-request');
        if (body.action === 'stage') return respond(200, await stageChunk(services, actor, body));
        if (body.action !== 'commit') throw new ApiError(400, 'invalid-request');
        return respond(200, await commit(services, actor, body));
      }
      if (!q.action || q.action === 'state') {
        const user = (await services.db.doc('users/' + uid).get()).data();
        if (q.since !== undefined && Number(q.since) === (user?.sequence || 0)) return respond(200, { profile: actor.identity, sequence: user?.sequence || 0, unchanged: true });
        const records = await services.db.collection('users/' + uid + '/records').orderBy('sequence').get();
        return respond(200, { schemaVersion: 1, profile: actor.identity, sequence: user?.sequence || 0, records: schema.sortRecords(records.docs.map(doc => wire(doc.data()))) });
      }
      if (q.action === 'read' || q.action === 'chunk') {
        const key = validKey(q.key);
        const record = (await refs(services.db, uid, key, 'unused').record.get()).data();
        if (!record) throw new ApiError(404, 'not-found');
        if (q.action === 'chunk') {
          const index = Number(q.index);
          if (record.deleted || !record.attachment || record.attachment.uploadId !== q.uploadId || !Number.isInteger(index) || index < 0 || index >= record.attachment.count) throw new ApiError(404, 'not-found');
          const chunk = (await services.db.doc('users/' + uid + '/uploads/' + q.uploadId + '/chunks/' + index).get()).data();
          if (!chunk) throw new ApiError(503, 'data-integrity-failed');
          return respond(200, { data: chunk.data, digest: chunk.digest });
        }
        return respond(200, { record: wire(record), value: await readValue(services.db, uid, record) });
      }
      if (q.action === 'activity') {
        const after = Math.max(0, Number(q.after) || 0);
        const entries = await services.db.collection('users/' + uid + '/activity').orderBy('sequence').startAfter(after).limit(100).get();
        return respond(200, { events: entries.docs.map(doc => wire(doc.data())), hasMore: entries.size === 100 });
      }
      throw new ApiError(400, 'invalid-request');
    } catch (error) { return fail(error); }
  };
}
module.exports = { createHandler, commit, readValue, hash };
