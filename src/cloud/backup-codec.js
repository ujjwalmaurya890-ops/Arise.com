import { blobBytes, base64, unbase64 } from './sync-engine.js';
import { zip, unzip, strToU8, strFromU8 } from 'fflate';
export { fingerprint } from './sync-engine.js';
export async function encodeBackup(value) {
  if (value instanceof Blob) return { $ariseBlob: 1, type: value.type, data: base64(await blobBytes(value)) };
  if (Array.isArray(value)) return Promise.all(value.map(encodeBackup));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!['__proto__', 'constructor', 'prototype'].includes(key)) result[key] = await encodeBackup(entry);
    }
    return result;
  }
  return value;
}
export function decodeBackup(value) {
  if (value && value.$ariseBlob === 1 && typeof value.data === 'string') return new Blob([unbase64(value.data)], { type: value.type || '' });
  if (Array.isArray(value)) return value.map(decodeBackup);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, entry]) => [key, decodeBackup(entry)]));
  return value;
}
export async function downloadBackup(snapshot, filename = 'arise-secure-backup') {
  const data = await encodeBackup(snapshot);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename + '-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ZIP is a wrapper around the same lossless JSON, never a separate restore path.
// Read only backup.json: no archive paths are ever extracted into a filesystem.
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
export async function backupZip(snapshot) {
  const data = strToU8(JSON.stringify(await encodeBackup(snapshot)));
  if (data.byteLength > MAX_BACKUP_BYTES) throw new Error('Backup JSON exceeds the 512 MiB archive limit. Export JSON or ask the owner to split the backed-up data safely.');
  const bytes = await new Promise((resolve, reject) => zip({ 'backup.json': data }, { level: 6 }, (error, result) => error ? reject(error) : resolve(result)));
  return new Blob([bytes], { type: 'application/zip' });
}
export async function readBackupFile(file) {
  if (!file || file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 512 MiB import limit. Keep the file and ask the owner for a safe split; current data is unchanged.');
  const bytes = new Uint8Array(await blobBytes(file));
  let text;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = await new Promise((resolve, reject) => unzip(bytes, { filter: entry => entry.name === 'backup.json' && entry.originalSize <= MAX_BACKUP_BYTES }, (error, result) => error ? reject(error) : resolve(result)));
    if (!entries['backup.json'] || entries['backup.json'].length > MAX_BACKUP_BYTES) throw new Error('ZIP must contain a backup.json no larger than 512 MiB. Nothing was restored.');
    text = strFromU8(entries['backup.json']);
  } else text = strFromU8(bytes);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}
export async function downloadZip(snapshot) {
  const blob = await backupZip(snapshot), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'arise-account-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
