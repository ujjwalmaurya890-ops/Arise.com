'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, loadEngine, memoryStorage, schema, commitBody } = require('./helpers.cjs');
const { CloudSync } = loadEngine();
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
async function device(f, options = {}) {
  const statuses = [], storage = options.storage || memoryStorage(options.uid || 'uid-1');
  const engine = new CloudSync({ storage, schema, request: options.request || f.request(options.token || 'token-1'), onStatus: info => statuses.push(info), wait: async () => {}, ...options });
  await engine.initialize(); return { engine, storage, statuses };
}
const samples = {
  tasks: [{ id: 'task-1', title: 'Practice', createdAt: '2024-01-01T00:00:00Z', completed: true, completedAt: '2024-01-02T04:00:00Z' }],
  'arise-daily-learning-tasks-v1': { tasks: [{ id: 'daily-1', status: 'done', order: 4 }] },
  studySessions: [{ id: 's-3', date: '2024-04-03', minutes: 45 }, { id: 's-1', date: '2023-02-01', minutes: 30 }],
  dsaQuestions: [{ id: 'q1', solved: true, dateSolved: '2020-06-01' }], devTasks: [{ id: 'dev1', completed: true }],
  'arise-cp-tracker-v1': { history: [{ id: 'contest-7', at: 1600000000000, rank: 20 }] },
  'arise-aptitude-log-v1': { sessions: [{ id: 'a1', at: 1700000000000, correct: 10 }], settings: { targetAcc: 80 } },
  arise_placement_tracker_v1: { applications: [{ id: 'p1', status: 'offer' }] },
  arise_exam_tracker_v1: { exams: [{ id: 'exam-1', date: '2026-11-01', topics: [{ id: 'topic-1', done: true }] }] },
  'cse-syllabus-progress-v1': { semester1: { subject1: true } }, revisionSystemProgress: { topic1: { history: [1, 2, 3] } },
  'arise-expenses-v1': [{ id: 'e1', amount: 100, date: '2024-04-05' }], 'arise-expenses-networth-history-v1': [{ date: '2024-04-05', value: 5000 }],
  notes: [{ id: 'n1', body: 'Old progress', createdAt: null }], 'arise-notes-app-v1': { notes: [{ id: 'note-1', body: '<p>Notes</p>' }], folders: [{ id: 'folder1' }] },
  'arise-personal-wiki-v1': { pages: [{ id: 'wiki1', text: 'Wiki' }] }, achievements: [{ id: 'achievement-1', unlocked: true }],
  'cdn_streak_checkins_v1': { '2024-01-01': { goals: ['DSA'], createdAt: '2024-01-01T00:00:00Z' } },
  hackathonTrackerV1: [{ id: 'hack1', rank: 3 }], projects: [{ id: 'project-1', progress: 80 }],
  'arise-attendance-tracker-v1': { subjects: [{ id: 'sub1', attended: 40 }] }, 'arise-cgpa-tracker-v1': { semesters: [{ id: 'sem1', grade: 9.0 }] },
  arise_certificates_v1: { certificates: [{ id: 'cert1', title: 'CSE', createdAt: '2021-01-01' }] },
  'arise-skills-timeline-v1': { entries: [{ id: 'skill1', level: 3 }] },
  'arise-water-reminder-log-v1': { '2026-10-22': 2000 }, 'arise-social-media-v1': { github: 'user' },
  appSettings: { userName: 'Student', sidebarCollapsed: false }, 'arise-dashboard-custom-themes': [{ id: 'custom', colors: ['#fff'] }]
};

test('automatic debounced saving and second-device restore preserve every representative feature byte-for-byte', async () => {
  const f = fixture(), a = await device(f);
  for (const [key, value] of Object.entries(samples)) { const raw = JSON.stringify(value); a.storage.apply(key, raw); a.engine.enqueue(key, raw); }
  a.storage.apply('arise-dashboard-theme', 'white'); a.engine.enqueue('arise-dashboard-theme', 'white');
  assert.equal(a.statuses.at(-1).status, 'saving');
  await tick(450); await a.engine.flush();
  assert.equal(a.statuses.at(-1).status, 'saved'); assert.equal(a.engine.queue.length, 0);
  const b = await device(f);
  for (const [key, value] of Object.entries(samples)) assert.deepEqual(JSON.parse(b.storage.local.get(key)), value, key);
  assert.equal(b.storage.local.get('arise-dashboard-theme'), 'white');
  assert.deepEqual(JSON.parse(b.storage.local.get('studySessions')).map(r => r.id), ['s-3', 's-1']);
  const c = await device(f, { token: 'token-2', uid: 'uid-2' }); assert.equal(c.storage.local.size, 0);
  a.engine.stop(); b.engine.stop(); c.engine.stop();
});

test('all audited local storage keys are supported without changing legacy strings', async () => {
  const f = fixture(), a = await device(f);
  for (const key of schema.keys) a.engine.enqueue(key, JSON.stringify({ existingFormat: key, order: [3, 1, 2] }));
  assert.equal(await a.engine.flush(), true);
  const b = await device(f); assert.equal(b.storage.local.size, schema.keys.length);
  for (const key of schema.keys) assert.equal(JSON.parse(b.storage.local.get(key)).existingFormat, key);
  a.engine.stop(); b.engine.stop();
});

test('database acknowledgment, not optimistic UI or network dispatch, controls Saved status', async () => {
  const f = fixture(); let release;
  const request = f.request(), a = await device(f, { request: async (q, body) => {
    if (body) await new Promise(resolve => { release = resolve; }); return request(q, body);
  } });
  a.engine.enqueue('xp', '1'); const saving = a.engine.flush(); await tick(10);
  assert.equal(a.statuses.at(-1).status, 'saving'); assert.equal(a.engine.queue.length, 1); release(); await saving;
  assert.equal(a.statuses.at(-1).status, 'saved'); a.engine.stop();
});

test('bounded exponential retry, lost-response idempotency, and offline queue survive refresh without cross-account replay', async () => {
  const f = fixture(), request = f.request(), waits = []; let lost = true, online = true;
  const vault = new Map(), a = await device(f, { storage: memoryStorage('uid-1', vault), online: () => online, wait: async ms => waits.push(ms), request: async (q, body) => {
    const result = await request(q, body); if (body && lost) { lost = false; throw new Error('Response lost after commit.'); } return result;
  } });
  a.engine.enqueue('xp', '5'); assert.equal(await a.engine.flush(), true); assert.deepEqual(waits, [1000]);
  assert.equal((await request('?action=activity')).events.length, 1);
  online = false; a.engine.enqueue('notes', '["offline"]'); assert.equal(await a.engine.flush(), false); await a.engine.persist();
  assert.equal(a.statuses.at(-1).status, 'offline'); a.engine.stop();
  const other = await device(f, { storage: memoryStorage('uid-2', vault), token: 'token-2' }); assert.equal(other.engine.queue.length, 0); assert.equal(other.storage.local.size, 0);
  const resumed = await device(f, { storage: memoryStorage('uid-1', vault) }); assert.equal(resumed.engine.queue.length, 0); assert.equal(resumed.storage.local.get('notes'), '["offline"]');
  resumed.engine.stop(); other.engine.stop();
});

test('persistent failures stop after five attempts, retain queue, and reconnect/retry succeeds', async () => {
  const f = fixture(), request = f.request(), waits = []; let broken = false, writes = 0;
  const a = await device(f, { request: async (q, body) => { if (body) { writes++; if (broken) throw Object.assign(new Error(), { status: 503 }); } return request(q, body); }, wait: async ms => waits.push(ms) });
  broken = true; a.engine.enqueue('notes', '["kept"]'); assert.equal(await a.engine.flush(), false);
  assert.equal(writes, 5); assert.deepEqual(waits, [1000, 2000, 4000, 8000]); assert.equal(a.engine.queue.length, 1); assert.equal(a.statuses.at(-1).status, 'failed');
  broken = false; assert.equal(await a.engine.flush(), true); assert.equal(a.statuses.at(-1).status, 'saved'); a.engine.stop();
});

test('same-store simultaneous edits never silently overwrite: explicit cloud or local resolution retains recovery copies', async () => {
  const f = fixture(), a = await device(f), b = await device(f);
  a.engine.enqueue('notes', '["A"]'); b.engine.enqueue('notes', '["B"]');
  a.storage.apply('notes', '["A"]'); b.storage.apply('notes', '["B"]');
  await a.engine.flush(); assert.equal(await b.engine.flush(), false); assert.equal(b.statuses.at(-1).status, 'conflict');
  assert.equal((await f.request()('?action=read&key=notes')).value, '["A"]'); assert.equal(b.storage.local.get('notes'), '["B"]');
  await b.engine.resolveConflict(false); assert.equal(b.storage.local.get('notes'), '["A"]'); assert.ok([...b.storage.vault.keys()].some(key => key.startsWith('conflict:uid-1:')));
  // Another race, now explicitly retain this device's version after reviewing.
  a.engine.enqueue('notes', '["A2"]'); b.engine.enqueue('notes', '["B2"]'); await a.engine.flush(); await b.engine.flush();
  assert.equal(await b.engine.resolveConflict(true), true); assert.equal((await f.request()('?action=read&key=notes')).value, '["B2"]');
  assert.equal((await f.request()('?action=activity')).events.length, 3);
  a.engine.stop(); b.engine.stop();
});

test('unrelated keys from two devices are retained; polling explicitly ordered metadata refreshes the other device', async () => {
  const f = fixture(), a = await device(f), b = await device(f);
  a.engine.enqueue('tasks', '[1]'); b.engine.enqueue('notes', '[2]'); await Promise.all([a.engine.flush(), b.engine.flush()]);
  await a.engine.poll(); await b.engine.poll();
  assert.equal(a.storage.local.get('notes'), '[2]'); assert.equal(b.storage.local.get('tasks'), '[1]');
  a.engine.stop(); b.engine.stop();
});

test('migration is consent-independent at engine layer but UID-bound, backed by caller, idempotent, verified, and preserves unknown history', async () => {
  const f = fixture(), a = await device(f), snapshot = { meta: { ownerUid: null }, localStorage: { notes: JSON.stringify(samples.notes), studySessions: JSON.stringify(samples.studySessions), 'backupCenter:gistToken': 'NEVER_UPLOAD' }, indexedDB: [] };
  const report = await a.engine.importSnapshot(snapshot, { migrationId: 'stable-backup-fingerprint' });
  assert.equal(report.verified, 2); assert.equal(report.featureCounts.notes.entries, samples.notes.length); assert.equal(report.featureCounts.studySessions.entries, samples.studySessions.length); assert.deepEqual(report.skipped, ['backupCenter:gistToken']);
  assert.equal((await f.request()('?action=activity')).events.length, 2);
  await a.engine.importSnapshot(snapshot, { migrationId: 'stable-backup-fingerprint' }); assert.equal((await f.request()('?action=activity')).events.length, 2);
  const cloud = await f.request()('?action=read&key=notes'); assert.equal(cloud.record.originalEventAt, null); assert.equal(JSON.parse(cloud.value)[0].createdAt, null);
  await assert.rejects(a.engine.importSnapshot({ ...snapshot, meta: { ownerUid: 'uid-2' } }, { migrationId: 'wrong-owner' }), /different account/);
  assert.ok([...a.storage.vault.keys()].some(key => key.startsWith('migration-report:uid-1:'))); a.engine.stop();
});

test('interrupted migration resumes pending operations without duplicate records or activity', async () => {
  const f = fixture(), request = f.request(), vault = new Map(); let broken = true;
  const a = await device(f, { storage: memoryStorage('uid-1', vault), request: async (q, body) => {
    if (body && broken) throw new Error('Network interrupted.'); return request(q, body);
  } });
  const snapshot = { meta: {}, localStorage: { notes: '[{"id":"old","at":1234}]', xp: '250' }, indexedDB: [] };
  await assert.rejects(a.engine.importSnapshot(snapshot, { migrationId: 'interrupted-backup' }), /paused/); assert.equal(a.engine.queue.length, 2); a.engine.stop();
  broken = false; const b = await device(f, { storage: memoryStorage('uid-1', vault) });
  await b.engine.importSnapshot(snapshot, { migrationId: 'interrupted-backup' });
  assert.equal((await request('?action=activity')).events.length, 2); assert.equal(JSON.parse(b.storage.local.get('notes'))[0].id, 'old'); b.engine.stop();
});

test('cloud-first restore cannot be overwritten by stale account cache; matching migration conflicts are explicitly skipped', async () => {
  const f = fixture(); await f.call('token-1', 'POST', commitBody('notes', '["newer cloud"]'));
  const storage = memoryStorage(); storage.local.set('notes', '["stale cache"]');
  const a = await device(f, { storage }); assert.equal(storage.local.get('notes'), '["newer cloud"]');
  const report = await a.engine.importSnapshot({ meta: {}, localStorage: { notes: '["legacy"]' }, indexedDB: [] }, { migrationId: 'old-backup', replace: false });
  assert.deepEqual(report.skipped, ['notes']); assert.equal((await f.request()('?action=read&key=notes')).value, '["newer cloud"]');
  assert.equal((await storage.load((await storage.load('recovery-index:uid-1')).at(-1).key)).localStorage.notes, '["stale cache"]'); a.engine.stop();
});

test('binary attachments in BOTH audited databases restore exact IDs, timestamps, bytes and deletions', async () => {
  const f = fixture(), a = await device(f), bytes = new Uint8Array(420000).map((_, i) => i % 251);
  for (const database of Object.keys(schema.databases)) {
    const record = { id: database.includes('certificates') ? 'certfile_1' : 'lf_1', name: 'proof.pdf', type: 'application/pdf', size: bytes.length, uploadedAt: '2021-02-03T04:05:06.000Z', blob: new Blob([bytes]) };
    await a.storage.putFile(database, record);
  }
  await a.engine.scanAttachments(); assert.equal(a.engine.queue.length, 2); assert.equal(await a.engine.flush(), true);
  const b = await device(f);
  for (const database of Object.keys(schema.databases)) {
    const [record] = await b.storage.files(database); assert.equal(record.uploadedAt, '2021-02-03T04:05:06.000Z'); assert.equal(record.name, 'proof.pdf');
    assert.deepEqual(new Uint8Array(await record.blob.arrayBuffer()), bytes);
  }
  const database = Object.keys(schema.databases)[0]; await a.storage.putFile(database, null, 'lf_1'); await a.engine.scanAttachments(); await a.engine.flush(); await b.engine.poll();
  assert.equal((await b.storage.files(database)).length, 0); a.engine.stop(); b.engine.stop();
});

test('revoked access or unavailable/invalid server configuration stops saving and never reports success', async () => {
  for (const reason of ['revoked', 'policy', 'credentials']) {
    const f = fixture(), request = f.request(), fatal = []; let configurationBroken = false;
    const a = await device(f, { onFatal: error => fatal.push(error), request: (q, body) => {
      if (configurationBroken) throw Object.assign(new Error(), { status: 503, code: 'configuration-unavailable' });
      return request(q, body);
    } });
    if (reason === 'revoked') f.revoked.add('token-1');
    if (reason === 'policy') f.db.data.delete('_config/access');
    if (reason === 'credentials') configurationBroken = true;
    a.engine.enqueue('xp', '99'); assert.equal(await a.engine.flush(), false);
    assert.equal(fatal[0].status, reason === 'revoked' ? 401 : 503); assert.equal(a.engine.active, false); assert.equal(a.engine.queue.length, 1);
    assert.notEqual(a.statuses.at(-1).status, 'saved');
  }
});


test('lost-response recovery pulls a newer cloud edit instead of leaving stale optimistic cache', async () => {
  const f = fixture(), vault = new Map(), body = commitBody('notes', '["accepted before crash"]');
  await f.call('token-1', 'POST', body);
  await f.call('token-1', 'POST', commitBody('notes', '["newer second-device edit"]', 1));
  vault.set('queue:uid-1', [{ ...body }]);
  const a = await device(f, { storage: memoryStorage('uid-1', vault) });
  assert.equal(a.storage.local.get('notes'), '["newer second-device edit"]');
  assert.equal(a.engine.records.get('notes').version, 2);
  assert.equal((await f.request()('?action=activity')).events.length, 2); a.engine.stop();
});

test('attachment IDs cannot collide and fallback order is independent of the browser locale', () => {
  const database = 'arise-local-files-db-v1';
  const ids = ['a b', 'a_20b', 'a%20b', 'a/b', 'a_2Fb', 'नोट', 1, '1'];
  const keys = ids.map(id => schema.attachmentKey(database, id));
  assert.equal(new Set(keys).size, ids.length); assert.ok(keys.every(key => schema.isAttachmentKey(key)));
  assert.deepEqual(schema.sortRecords([{ id: 'a' }, { id: 'Z' }, { id: 'A' }]).map(item => item.id), ['A', 'Z', 'a']);
});

test('startup/manual recovery archives retain distinct snapshots and deduplicate identical content, rather than overwrite prior copies', async () => {
  const f = fixture(), a = await device(f);
  const first = { meta: { ownerUid: 'uid-1', exportedAt: '2020-01-01' }, localStorage: { notes: '["original"]' }, indexedDB: [] };
  const second = { ...first, localStorage: { notes: '["later"]' } };
  const firstKey = await a.engine.archiveRecovery(first, 'before-cloud-restore');
  const secondKey = await a.engine.archiveRecovery(second, 'before-manual-restore');
  assert.notEqual(firstKey, secondKey);
  assert.equal((await a.storage.load(firstKey)).localStorage.notes, '["original"]');
  assert.equal((await a.storage.load(secondKey)).localStorage.notes, '["later"]');
  assert.equal(await a.engine.archiveRecovery({ ...first, meta: { ...first.meta, exportedAt: '2026-10-23' } }, 'before-manual-restore'), firstKey);
  const index = await a.storage.load('recovery-index:uid-1'); assert.equal(index.length, 2);
  assert.equal(index.at(-1).capturedAt, '2020-01-01'); assert.deepEqual(index.at(-1).reasons, ['before-cloud-restore', 'before-manual-restore']);
  a.engine.stop(); await assert.rejects(a.engine.archiveRecovery(second, 'stopped'), /session changed/);
});
