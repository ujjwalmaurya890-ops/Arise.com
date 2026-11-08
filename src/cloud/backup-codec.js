import { blobBytes, base64, unbase64 } from './sync-engine.js';
import { zip, unzip, strToU8, strFromU8 } from 'fflate';
export { fingerprint } from './sync-engine.js';

/* Backup operations report measured progress, never a synthetic timer:
   - `encode` counts values actually encoded (blobs included; empty containers
     count as one unit) against a counted total, so `done / total` is a real
     fraction of completed encoding units;
   - `read` counts bytes actually read from the file against `file.size`;
   - `compress` / `unpack` / `parse` carry no honest fraction, so they report
     `fraction: null` and the UI shows an indeterminate bar with a phase label.
   Cancellation is supported only where it is genuinely safe: while encoding the
   snapshot (nothing has been written yet) and while reading the file (nothing has
   been decoded or restored yet). Once a restore has started, aborting would be
   dishonest, so the signal is ignored past that point. */

const ABORT_MESSAGE = 'Backup cancelled before anything changed.';
const SKIP_KEYS = ['__proto__', 'constructor', 'prototype'];
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

function abortError() {
  const error = new Error(ABORT_MESSAGE);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError();
}

function report(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch (_) {
    // A progress observer must never break the backup itself.
  }
}

const isBlob = (value) => typeof Blob !== 'undefined' && value instanceof Blob;

/** Count of scalar/blob values and empty containers an encode pass will process. */
export function countBackupUnits(value) {
  let total = 0;
  const ancestors = new Set();
  (function walk(entry) {
    if (isBlob(entry)) {
      total += 1;
      return;
    }
    if (Array.isArray(entry)) {
      if (ancestors.has(entry)) throw new TypeError('Backup snapshot contains a circular reference.');
      if (entry.length === 0) total += 1;
      else {
        ancestors.add(entry);
        entry.forEach(walk);
        ancestors.delete(entry);
      }
      return;
    }
    if (entry && typeof entry === 'object') {
      if (ancestors.has(entry)) throw new TypeError('Backup snapshot contains a circular reference.');
      const keys = Object.keys(entry).filter(key => !SKIP_KEYS.includes(key));
      if (keys.length === 0) total += 1;
      else {
        ancestors.add(entry);
        for (const key of keys) walk(entry[key]);
        ancestors.delete(entry);
      }
      return;
    }
    total += 1;
  })(value);
  return total;
}

/**
 * Lossless JSON encoding of a snapshot.
 * @param {*} value snapshot
 * @param {{ onProgress?: (info: {phase: string, done?: number, total?: number, fraction: number|null}) => void,
 *           signal?: AbortSignal }} [options]
 */
export async function encodeBackup(value, options = {}) {
  const { onProgress, signal } = options;
  const total = Math.max(countBackupUnits(value), 1);
  let done = 0;
  const step = () => {
    throwIfAborted(signal);
    done += 1;
    if (done === total || done % 8 === 0) {
      report(onProgress, { phase: 'encode', done, total, fraction: Math.min(done / total, 1) });
    }
  };
  async function walk(entry) {
    throwIfAborted(signal);
    if (isBlob(entry)) {
      const data = base64(await blobBytes(entry));
      step();
      return { $ariseBlob: 1, type: entry.type, data };
    }
    if (Array.isArray(entry)) {
      const result = [];
      for (const item of entry) result.push(await walk(item));
      if (entry.length === 0) step();
      return result;
    }
    if (entry && typeof entry === 'object') {
      const result = {};
      let eligible = 0;
      for (const [key, child] of Object.entries(entry)) {
        if (SKIP_KEYS.includes(key)) continue;
        eligible += 1;
        result[key] = await walk(child);
      }
      if (eligible === 0) step();
      return result;
    }
    step();
    return entry;
  }
  const encoded = await walk(value);
  report(onProgress, { phase: 'encode', done: total, total, fraction: 1 });
  return encoded;
}

export function decodeBackup(value) {
  if (value && value.$ariseBlob === 1 && typeof value.data === 'string') return new Blob([unbase64(value.data)], { type: value.type || '' });
  if (Array.isArray(value)) return value.map(decodeBackup);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, entry]) => [key, decodeBackup(entry)]));
  return value;
}

export async function downloadBackup(snapshot, filename = 'arise-secure-backup', options = {}) {
  const data = await encodeBackup(snapshot, options);
  throwIfAborted(options.signal);
  // JSON.stringify is synchronous and has no measurable byte/step callback.
  report(options.onProgress, { phase: 'serialize', fraction: null });
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  report(options.onProgress, { phase: 'done', fraction: 1 });
}

// ZIP is a wrapper around the same lossless JSON, never a separate restore path.
// Read only backup.json: no archive paths are ever extracted into a filesystem.
export async function backupZip(snapshot, options = {}) {
  const { onProgress, signal } = options;
  const encoded = await encodeBackup(snapshot, { onProgress, signal });
  throwIfAborted(signal);
  // Stringification and UTF-8 conversion have no incremental progress API.
  report(onProgress, { phase: 'serialize', fraction: null });
  const data = strToU8(JSON.stringify(encoded));
  if (data.byteLength > MAX_BACKUP_BYTES) throw new Error('Backup JSON exceeds the 512 MiB archive limit. Export JSON or ask the owner to split the backed-up data safely.');
  // Compression has no honest percentage: report the phase, not a number.
  report(onProgress, { phase: 'compress', fraction: null });
  const bytes = await new Promise((resolve, reject) => zip({ 'backup.json': data }, { level: 6 }, (error, result) => error ? reject(error) : resolve(result)));
  throwIfAborted(signal);
  report(onProgress, { phase: 'done', fraction: 1 });
  return new Blob([bytes], { type: 'application/zip' });
}

async function readBytes(file, { onProgress, signal }) {
  if (file.size > 0 && typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    const chunks = [];
    let loaded = 0;
    const total = file.size;
    try {
      for (;;) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        report(onProgress, { phase: 'read', loaded, total, fraction: total ? Math.min(loaded / total, 1) : 0 });
      }
    } finally {
      try { await reader.cancel(); } catch (_) {}
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    report(onProgress, { phase: 'read', loaded, total, fraction: 1 });
    return bytes;
  }
  const buffer = await blobBytes(file);
  throwIfAborted(signal);
  const bytes = new Uint8Array(buffer);
  report(onProgress, { phase: 'read', loaded: bytes.byteLength, total: bytes.byteLength, fraction: 1 });
  return bytes;
}

export async function readBackupFile(file, options = {}) {
  const { onProgress, signal } = options;
  if (!file || file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 512 MiB import limit. Keep the file and ask the owner for a safe split; current data is unchanged.');
  throwIfAborted(signal);
  const bytes = await readBytes(file, { onProgress, signal });
  throwIfAborted(signal);
  let text;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    report(onProgress, { phase: 'unpack', fraction: null });
    const entries = await new Promise((resolve, reject) => unzip(bytes, { filter: entry => entry.name === 'backup.json' && entry.originalSize <= MAX_BACKUP_BYTES }, (error, result) => error ? reject(error) : resolve(result)));
    if (!entries['backup.json'] || entries['backup.json'].length > MAX_BACKUP_BYTES) throw new Error('ZIP must contain a backup.json no larger than 512 MiB. Nothing was restored.');
    text = strFromU8(entries['backup.json']);
  } else text = strFromU8(bytes);
  throwIfAborted(signal);
  report(onProgress, { phase: 'parse', fraction: null });
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  report(onProgress, { phase: 'done', fraction: 1 });
  return parsed;
}

export async function downloadZip(snapshot, options = {}) {
  const blob = await backupZip(snapshot, options), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'arise-account-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
