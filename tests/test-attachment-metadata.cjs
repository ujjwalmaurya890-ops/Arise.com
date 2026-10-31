'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const load = (w, file) => w.eval(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'));
(async () => {
  const dom = new JSDOM('<div id="files"></div><div id="certificates"></div>', { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange;
  const id = 'imported" onpointerenter="bad()';
  try {
    await new Promise((resolve, reject) => {
      const request = w.indexedDB.open('arise-local-files-db-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' }).createIndex('byOwner', ['ownerType', 'ownerId']);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ id, name: 'report.<img src=x onerror="bad()">', ownerType: 'project', ownerId: 'audit', type: 'text/plain', size: 1, uploadedAt: '2026-10-30' });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
    load(w, 'src/local-files-widget.js');
    w.__mountLocalFiles(w.document.getElementById('files'), 'project', 'audit');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('File list did not finish loading')), 2000);
      const observer = new w.MutationObserver(() => { if (w.document.querySelector('.lf-file-row')) { clearTimeout(timer); observer.disconnect(); resolve(); } });
      observer.observe(w.document.getElementById('files'), { childList: true, subtree: true });
    });
    assert.equal(w.document.querySelectorAll('#files [onpointerenter], #files [onerror], #files img').length, 0, 'file IDs and extensions are text, never active HTML');
    assert.equal(w.document.querySelector('.lf-file-row').dataset.fileId, id, 'escaped ID still addresses the original stored file');
    load(w, 'src/features/certificates/certificates-storage.js');
    load(w, 'src/features/certificates/certificates-widget.js');
    w.AriseCertificatesStorage.upsert({ id, title: 'Imported certificate', issuer: 'Audit' });
    w.__mountCertificates(w.document.getElementById('certificates'));
    assert.equal(w.document.querySelectorAll('#certificates [onpointerenter]').length, 0, 'certificate IDs cannot add HTML attributes');
    assert.equal(w.document.querySelector('.crt-tile').dataset.certId, id);
    console.log('Attachment metadata: imported IDs and filename extensions are escaped without changing stored identity.');
  } finally { w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
