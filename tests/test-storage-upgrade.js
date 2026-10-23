'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}

function freshDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', runScripts: 'dangerously' });
  const window = dom.window;
  window.__ARISE_MUTATION_BUS__ = { subscribe: function () {} };
  return dom;
}

function loadScript(window, file) {
  const code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), file), 'utf8');
  window.eval(code);
}

function fireDomReady(window) {
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
}

function mockThrowingStorage(window, errorFactory) {
  const store = {};
  const mock = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { throw errorFactory(); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { for (const k in store) delete store[k]; }
  };
  Object.defineProperty(window, 'localStorage', { value: mock, configurable: true, enumerable: true });
  return mock;
}

// ---------------------------------------------------------------------
// 1. src/widget-shared-utils.js: safeSet() basic write + quota handling
// ---------------------------------------------------------------------
(function testSafeSetBasic() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  const ok = utils.safeSet('some-key', { a: 1 });
  assert(ok === true, 'safeSet returns true on a normal write');
  assert(window.localStorage.getItem('some-key') === '{"a":1}', 'safeSet actually wrote JSON');

  const okStr = utils.safeSet('str-key', 'raw-string');
  assert(okStr === true, 'safeSet handles a plain string value without double-encoding');
  assert(window.localStorage.getItem('str-key') === 'raw-string', 'string value stored verbatim');
})();

(function testSafeSetQuotaError() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  const original = window.localStorage.setItem.bind(window.localStorage);
  mockThrowingStorage(window, function () {
    const e = new Error('quota');
    e.name = 'QuotaExceededError';
    return e;
  });

  const ok = utils.safeSet('boomKey', { big: 'data' }, { quotaMessage: 'CUSTOM QUOTA MSG' });
  assert(ok === false, 'safeSet returns false when localStorage throws QuotaExceededError');

  const toastEl = window.document.getElementById('arise-shared-toast');
  assert(!!toastEl, 'a toast element was created on quota failure');
  assert(toastEl.textContent === 'CUSTOM QUOTA MSG', 'toast shows the caller-supplied quota message');
  assert(toastEl.className.indexOf('arise-shared-toast-visible') !== -1, 'toast is marked visible');
  assert(toastEl.className.indexOf('arise-shared-toast-danger') !== -1, 'toast carries the danger tone');
})();

(function testSafeSetNonQuotaError() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  mockThrowingStorage(window, function () { return new Error('some other failure'); });
  const ok = utils.safeSet('safeKey', { x: 1 }, { errorMessage: 'GENERIC FAIL' });
  assert(ok === false, 'safeSet returns false on a non-quota error too');
  const toastEl = window.document.getElementById('arise-shared-toast');
  assert(toastEl && toastEl.textContent === 'GENERIC FAIL', 'non-quota error shows the generic error message');
})();

(function testSafeSetSuppressErrors() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  mockThrowingStorage(window, function () { return new Error('nope'); });
  utils.safeSet('safeKey', { x: 1 }, { showErrors: false });
  const toastEl = window.document.getElementById('arise-shared-toast');
  assert(!toastEl, 'showErrors:false suppresses the toast for non-quota failures');
})();

(function testSafeSetUnserializable() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  const circular = {};
  circular.self = circular;
  const ok = utils.safeSet('circularKey', circular);
  assert(ok === false, 'safeSet returns false for a value that cannot be JSON-serialized');
  const toastEl = window.document.getElementById('arise-shared-toast');
  assert(!toastEl, 'unserializable value does not fire a toast (not a quota problem)');
})();

// ---------------------------------------------------------------------
// 2. src/widget-shared-utils.js: readVersioned()
// ---------------------------------------------------------------------
(function testReadVersionedFreshInstall() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  const result = utils.readVersioned('missing-key', { version: 1, fallback: { entries: {} } });
  assert(result.value.entries && Object.keys(result.value.entries).length === 0, 'fresh install returns the fallback');
  assert(result.migrated === false, 'fresh install is not reported as migrated');
})();

(function testReadVersionedLegacyMigration() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  // Legacy flat map, no __schemaVersion field at all.
  window.localStorage.setItem('legacy-key', JSON.stringify({ t1: { stack: ['react'], quality: 'guided' } }));

  const result = utils.readVersioned('legacy-key', {
    version: 1,
    fallback: { entries: {} },
    migrations: {
      0: function (v) {
        const entries = (v && typeof v === 'object') ? v : {};
        delete entries.__schemaVersion;
        return { entries: entries };
      }
    }
  });

  assert(result.version === 1, 'legacy data migrated up to version 1');
  assert(result.migrated === true, 'migration flag reported true');
  assert(result.value.entries.t1.stack[0] === 'react', 'wrapped entry data preserved exactly');
  assert(result.value.__schemaVersion === 1, 'returned value is stamped with the new version');
})();

(function testReadVersionedAlreadyCurrent() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  window.localStorage.setItem('current-key', JSON.stringify({ __schemaVersion: 1, entries: { a: 1 } }));
  const result = utils.readVersioned('current-key', {
    version: 1,
    fallback: { entries: {} },
    migrations: { 0: function (v) { return { entries: {} }; } } // should NOT run
  });
  assert(result.migrated === false, 'already-current data is not re-migrated');
  assert(result.value.entries.a === 1, 'already-current data passes through untouched');
})();

(function testReadVersionedNoMigrationPathStopsShort() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-shared-utils.js');
  const utils = window.__ARISE_WIDGET_UTILS__;

  window.localStorage.setItem('gap-key', JSON.stringify({ __schemaVersion: 0, a: 1 }));
  const result = utils.readVersioned('gap-key', { version: 3, fallback: null, migrations: {} });
  assert(result.version === 0, 'stops at the version it started at when no migration fn exists for that step');
  assert(result.migrated === false, 'no-op migration is not reported as migrated');
})();

// ---------------------------------------------------------------------
// 3. src/storage-keys.js manifest
// ---------------------------------------------------------------------
(function testStorageKeysManifest() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/storage-keys.js');
  const registry = window.__ARISE_STORAGE_KEYS__;

  assert(!!registry, 'src/storage-keys.js installs window.__ARISE_STORAGE_KEYS__');
  assert(Array.isArray(registry.all) && registry.all.length > 40, 'manifest has a substantial number of entries');

  const gist = registry.find('backupCenter:gistToken');
  assert(gist && gist.sensitive === true, 'Gist token entry is flagged sensitive');

  const dsaQ = registry.find('dsaQuestions');
  assert(dsaQ && dsaQ.owner.indexOf('app-bundle') !== -1, 'dsaQuestions correctly attributed to app-bundle.js');

  const keys = registry.all.map(e => e.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert(dupes.length === 0, 'manifest has no duplicate key entries: ' + dupes.join(','));

  const missingOwner = registry.all.filter(e => !e.owner || !e.description);
  assert(missingOwner.length === 0, 'every manifest entry has an owner and description');
})();

(function testStorageKeysDoesNotThrowOnDoubleLoad() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/storage-keys.js');
  const first = window.__ARISE_STORAGE_KEYS__;
  loadScript(window, 'src/storage-keys.js'); // simulate double-include
  assert(window.__ARISE_STORAGE_KEYS__ === first, 'double-loading src/storage-keys.js is a safe no-op (guarded)');
})();

// ---------------------------------------------------------------------
// 4. src/social-media-widget.js: safeSet integration + version stamping
// ---------------------------------------------------------------------
function loadSocialMediaWidget(window) {
  loadScript(window, 'src/widget-shared-utils.js');
  loadScript(window, 'src/social-media-widget.js');
}

(function testSocialMediaFreshSaveIsVersioned() {
  const dom = freshDom();
  const window = dom.window;
  const host = window.document.createElement('div');
  host.id = 'social-media-root';
  window.document.body.appendChild(host);
  loadSocialMediaWidget(window);

  window.__mountSocialMedia(host);
  const input = host.querySelector('input[data-platform-key]') || host.querySelector('input');
  assert(!!input, 'social media widget rendered an input field');

  // Simulate the widget's own save path by calling saveState indirectly:
  // set a value via the DOM and dispatch the change/blur it listens for.
  if (input) {
    input.value = 'https://example.com/arise';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    input.dispatchEvent(new window.Event('blur', { bubbles: true }));
  }

  const raw = window.localStorage.getItem('arise-social-media-v1');
  assert(!!raw, 'social media widget persisted something to its storage key');
  if (raw) {
    const parsed = JSON.parse(raw);
    assert(parsed.__schemaVersion === 1, 'saved social-media state carries __schemaVersion 1');
  }
})();

(function testSocialMediaLegacyDataStillLoads() {
  const dom = freshDom();
  const window = dom.window;
  const host = window.document.createElement('div');
  host.id = 'social-media-root';
  window.document.body.appendChild(host);

  // Legacy (pre-versioning) shape: no __schemaVersion field.
  window.localStorage.setItem('arise-social-media-v1', JSON.stringify({
    values: { github: 'https://github.com/Arise' },
    custom: []
  }));

  loadSocialMediaWidget(window);
  window.__mountSocialMedia(host);

  const html = host.innerHTML;
  assert(html.indexOf('Arise') !== -1, 'legacy (unversioned) saved value still loads and renders correctly');
})();

(function testSocialMediaQuotaFailureShowsToast() {
  const dom = freshDom();
  const window = dom.window;
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  loadSocialMediaWidget(window);
  window.__mountSocialMedia(host);

  const original = window.localStorage.setItem.bind(window.localStorage);
  mockThrowingStorage(window, function () {
    const e = new Error('quota');
    e.name = 'QuotaExceededError';
    return e;
  });

  const input = host.querySelector('input');
  if (input) {
    input.value = 'https://example.com/x';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    input.dispatchEvent(new window.Event('blur', { bubbles: true }));
  }

  const toastEl = window.document.getElementById('arise-shared-toast');
  assert(!!toastEl, 'a quota failure while saving social-media state surfaces the shared toast');

})();

// ---------------------------------------------------------------------
// 5. src/dev-task-insights-widget.js: legacy flat-map migration + safeSet
// ---------------------------------------------------------------------
(function testDevTaskInsightsMigrationAndSave() {
  const dom = freshDom();
  const window = dom.window;

  // Seed devTasks (React-owned, read-only from this widget's perspective)
  // and a LEGACY (pre-versioning, unwrapped flat-map) devTaskInsights value.
  window.localStorage.setItem('devTasks', JSON.stringify([
    { id: 't1', category: 'Frontend', difficulty: 'Medium', completed: true, revision: false },
    { id: 't2', category: 'Backend', difficulty: 'Hard', completed: true, revision: false }
  ]));
  window.localStorage.setItem('devTaskInsights', JSON.stringify({
    t1: { stack: ['react'], quality: 'guided' }
  }));

  const host = window.document.createElement('div');
  host.className = 'dvp-shell';
  window.document.body.appendChild(host);

  loadScript(window, 'src/widget-shared-utils.js');
  loadScript(window, 'src/dev-task-insights-widget.js');
  fireDomReady(window);

  // update() ran on load (readyState is 'complete' in jsdom by default) —
  // legacy stack tag for t1 should still render after the silent migration.
  assert(host.innerHTML.indexOf('react') !== -1, 't1\'s pre-existing "react" stack tag survived the legacy-shape migration');

  // Click t2's "Independent" quality button to trigger a real save via the
  // widget's own click handler (not calling internals directly).
  const qBtn = host.querySelector('[data-dti-id="t2"][data-dti-quality="independent"]');
  assert(!!qBtn, 'found the Independent quality button for task t2');
  if (qBtn) qBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

  const raw = window.localStorage.getItem('devTaskInsights');
  const parsed = JSON.parse(raw);
  assert(parsed.__schemaVersion === 1, 'devTaskInsights is now stored wrapped with __schemaVersion 1');
  assert(parsed.entries.t1.stack[0] === 'react', 'pre-existing t1 entry preserved through migration + a later save');
  assert(parsed.entries.t2.quality === 'independent', 'new t2 entry was saved correctly inside the wrapped shape');
})();

(function testDevTaskInsightsQuotaFailureToast() {
  const dom = freshDom();
  const window = dom.window;
  window.localStorage.setItem('devTasks', JSON.stringify([
    { id: 't1', category: 'Frontend', difficulty: 'Medium', completed: true, revision: false }
  ]));
  const host = window.document.createElement('div');
  host.className = 'dvp-shell';
  window.document.body.appendChild(host);

  loadScript(window, 'src/widget-shared-utils.js');
  loadScript(window, 'src/dev-task-insights-widget.js');
  fireDomReady(window);

  mockThrowingStorage(window, function () {
    const e = new Error('quota');
    e.name = 'QuotaExceededError';
    return e;
  });
  // Re-seed devTasks into the new mock storage since mockThrowingStorage
  // swapped the whole localStorage object out.
  window.localStorage.getItem = (function (orig) {
    return function (k) { return k === 'devTasks' ? JSON.stringify([{ id: 't1', category: 'Frontend', difficulty: 'Medium', completed: true, revision: false }]) : null; };
  })(window.localStorage.getItem);

  const qBtn = host.querySelector('[data-dti-quality="independent"]');
  if (qBtn) qBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

  const toastEl = window.document.getElementById('arise-shared-toast');
  assert(!!toastEl, 'a quota failure while saving task insights surfaces the shared toast');
})();

// ---------------------------------------------------------------------
// 6. src/dev-revision-scheduler-widget.js: legacy flat-map migration
// ---------------------------------------------------------------------
(function testDevRevisionSchedulerMigration() {
  const dom = freshDom();
  const window = dom.window;

  const now = Date.now();
  window.localStorage.setItem('devTasks', JSON.stringify([
    { id: 'd1', category: 'Frontend', difficulty: 'Medium', completed: true, revision: true },
    { id: 'd2', category: 'Backend', difficulty: 'Hard', completed: true, revision: true }
  ]));
  window.localStorage.setItem('devTaskTimestamps-v1', JSON.stringify({ d1: now - 86400000, d2: now - 3600000 }));
  // Legacy (pre-versioning) SRS schedule, unwrapped — only d1 has an entry,
  // so syncSchedule() will add d2 on boot and trigger a real persist, which
  // is what actually writes the migrated/wrapped shape back to storage.
  window.localStorage.setItem('devRevisionSRS', JSON.stringify({
    d1: { dueAt: now - 3600000, interval: 1, ease: 2.5, reps: 1 }
  }));

  const host = window.document.createElement('div');
  host.className = 'dvp-shell';
  window.document.body.appendChild(host);

  loadScript(window, 'src/widget-shared-utils.js');
  loadScript(window, 'src/dev-revision-scheduler-widget.js');
  fireDomReady(window);

  const raw = window.localStorage.getItem('devRevisionSRS');
  assert(!!raw, 'devRevisionSRS was written back after boot (sync ran)');
  if (raw) {
    const parsed = JSON.parse(raw);
    assert(parsed.__schemaVersion === 1, 'devRevisionSRS persisted in the wrapped, versioned shape after boot');
    assert(parsed.entries && parsed.entries.d1 && typeof parsed.entries.d1.reps === 'number', 'legacy schedule entry for d1 survived the migration');
    assert(parsed.entries.d2, 'newly-synced d2 entry was added alongside the migrated d1 entry');
  }
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
