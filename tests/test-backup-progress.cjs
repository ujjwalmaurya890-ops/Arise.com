#!/usr/bin/env node
'use strict';

/**
 * Backup Center progress + cancellation regression (jsdom).
 *
 * Verifies the contract added for measured backup progress:
 *  - the inline indicator is determinate only while a real fraction exists and
 *    carries aria-valuenow between 0 and 100;
 *  - phase-only work (compressing, unpacking) switches back to indeterminate
 *    instead of inventing a percentage;
 *  - Cancel aborts a genuinely reversible phase and says so truthfully;
 *  - the control, the bar and aria-busy are always restored — success, failure
 *    and cancellation alike.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  passed += 1;
}

function abortError() {
  const error = new Error('Backup cancelled before anything changed.');
  error.name = 'AbortError';
  return error;
}

function makeWidget({ onZip, onRead, onRestore } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="backup"></div></body></html>', {
    url: 'https://arise.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.eval(read('src/loading-system.js'));
  w.eval(read('src/backup-center-widget.js'));
  const snapshot = { meta: { ownerUid: 'uid-1' }, localStorage: { notes: '["kept"]' }, indexedDB: [] };
  w.AriseStorage = { snapshot: async () => snapshot };
  w.AriseBackupCodec = {
    downloadZip: async (value, options = {}) => onZip?.(value, options),
    readBackupFile: async (file, options = {}) => onRead?.(file, options),
    downloadBackup: async () => {}
  };
  w.AriseAuth = {
    snapshot: () => ({ isAuthenticated: true }),
    exportBackup: async () => { throw new Error('not used in this test'); },
    importBackup: async (raw) => onRestore?.(raw)
  };
  w.__mountBackupCenter(w.document.getElementById('backup'));
  const buttons = [...w.document.querySelectorAll('button')];
  return {
    w,
    dom,
    host: w.document.getElementById('backup'),
    bar: w.document.querySelector('.ars-progress'),
    label: w.document.querySelector('.ars-progress-label'),
    zipButton: buttons.find((button) => button.textContent === 'Export ZIP'),
    importButton: buttons.find((button) => button.textContent === 'Import & Restore'),
    cancelButton: buttons.find((button) => button.textContent === 'Cancel'),
    status: w.document.querySelector('.cloud-note')
  };
}

/** Records every determinate value the inline bar receives. */
function watchBar(w, bar) {
  const values = [];
  const observer = new w.MutationObserver(() => {
    if (bar.getAttribute('data-mode') === 'determinate') {
      const value = bar.getAttribute('aria-valuenow');
      if (value !== null && values[values.length - 1] !== value) values.push(value);
    }
  });
  observer.observe(bar, { attributes: true, attributeFilter: ['aria-valuenow', 'data-mode', 'style'] });
  return { values, stop: () => observer.disconnect() };
}

const measure = (host) => {
  const bar = host.querySelector('.ars-progress');
  return {
    hidden: bar.hidden,
    mode: bar.getAttribute('data-mode'),
    now: bar.getAttribute('aria-valuenow'),
    label: (host.querySelector('.ars-progress-label')?.textContent || '').trim(),
    cancelHidden: host.querySelectorAll('button')[host.querySelectorAll('button').length - 1]?.hidden
  };
};

(async function main() {
  /* ------------------------------------------------------- determinate run */
  {
    const env = makeWidget({
      onZip: async (snapshot, options) => {
        for (let step = 1; step <= 3; step += 1) {
          if (options.signal?.aborted) throw abortError();
          options.onProgress?.({ phase: 'encode', done: step, total: 3, fraction: step / 3 });
          await tick(12);
        }
        options.onProgress?.({ phase: 'compress', fraction: null });
        await tick(12);
        options.onProgress?.({ phase: 'done', fraction: 1 });
      }
    });
    ok(env.bar.hidden === true, 'the inline indicator starts hidden');
    ok(env.bar.getAttribute('role') === 'progressbar', 'the inline indicator is a progressbar');
    const watch = watchBar(env.w, env.bar);
    env.zipButton.click();
    await tick(6);
    ok(env.bar.hidden === false, 'starting a backup shows the inline indicator');
    ok(env.cancelButton && env.cancelButton.hidden === false, 'a reversible export offers Cancel');
    ok(env.zipButton.disabled === true, 'the export control is disabled while it runs');
    ok(env.status.getAttribute('aria-busy') === 'true', 'the status region is aria-busy during the operation');
    await tick(20);
    const midLabel = env.label.textContent;
    const midMode = env.bar.getAttribute('data-mode');
    const midValue = env.bar.getAttribute('aria-valuenow');
    ok(midMode === 'determinate', 'the bar is determinate while a real fraction exists');
    ok(Number(midValue) > 0 && Number(midValue) <= 100, 'aria-valuenow carries the measured percentage: ' + midValue);
    ok(env.bar.getAttribute('aria-valuetext') === midLabel, 'aria-valuetext exposes the phase and percentage to assistive technology');
    ok(midLabel.includes('Encoding backup items…'), 'the label names the real phase: ' + midLabel);
    ok(midLabel.includes('%'), 'the label shows the measured percentage: ' + midLabel);
    await tick(70);
    watch.stop();
    ok(watch.values.length >= 2, 'the bar received several measured values: ' + watch.values.join(','));
    ok(watch.values.every((value) => Number(value) >= 0 && Number(value) <= 100), 'every value is a valid percentage');
    ok(
      watch.values.every((value, index) => index === 0 || Number(value) >= Number(watch.values[index - 1])),
      'progress never goes backwards'
    );
    ok(watch.values.includes('100'), 'the final measured value reaches 100%');
    ok(env.bar.hidden === true, 'the indicator hides once the export completes');
    ok(env.bar.getAttribute('aria-valuenow') === null, 'no stale aria-valuenow is left behind');
    ok(env.cancelButton.hidden === true, 'Cancel disappears when the operation ends');
    ok(env.zipButton.disabled === false, 'the export control is enabled again');
    ok(env.status.getAttribute('aria-busy') === null, 'aria-busy is cleared from the status region');
    ok(/ZIP backup exported/.test(env.status.textContent), 'the success message is unchanged');
    env.dom.window.close();
  }

  /* ------------------------------------------------ phase-only inderminate */
  {
    const env = makeWidget({
      onZip: async (snapshot, options) => {
        options.onProgress?.({ phase: 'compress', fraction: null });
        await tick(10);
      }
    });
    env.zipButton.click();
    await tick(6);
    ok(env.bar.getAttribute('data-mode') === 'indeterminate', 'a phase without a true fraction stays indeterminate');
    ok(env.bar.getAttribute('aria-valuenow') === null, 'indeterminate phases carry no fake percentage');
    ok(/Compressing archive…/.test(env.label.textContent), 'the phase label describes the real work');
    await tick(30);
    ok(env.bar.hidden === true, 'the bar is cleared after the phase-only operation');
    env.dom.window.close();
  }

  /* -------------------------------------------------------- cancellation */
  {
    let aborted = false;
    const env = makeWidget({
      onZip: async (snapshot, options) => {
        for (let step = 1; step <= 6; step += 1) {
          if (options.signal?.aborted) { aborted = true; throw abortError(); }
          options.onProgress?.({ phase: 'encode', done: step, total: 6, fraction: step / 6 });
          await tick(15);
        }
      }
    });
    env.zipButton.click();
    await tick(20);
    ok(env.cancelButton.hidden === false, 'Cancel is available during encoding');
    env.cancelButton.click();
    ok(env.cancelButton.disabled === true, 'Cancel is disabled once requested');
    ok(env.cancelButton.textContent === 'Cancelling…', 'Cancel reports the in-flight cancellation');
    await tick(80);
    ok(aborted, 'the operation observed the abort signal');
    ok(/cancelled before anything changed/i.test(env.status.textContent), 'the status tells the truth about cancellation');
    ok(env.bar.hidden === true, 'the indicator is cleared after cancellation');
    ok(env.zipButton.disabled === false, 'the export control is restored after cancellation');
    ok(env.zipButton.getAttribute('data-cloud-busy') === null, 'no busy marker survives cancellation');
    ok(env.cancelButton.hidden === true, 'Cancel hides after cancellation');
    env.dom.window.close();
  }

  /* ------------------------------------------------------------- failure */
  {
    const env = makeWidget({
      onZip: async (snapshot, options) => {
        options.onProgress?.({ phase: 'encode', done: 1, total: 4, fraction: 0.25 });
        await tick(5);
        throw new Error('Disk is full.');
      }
    });
    env.zipButton.click();
    await tick(40);
    ok(/Disk is full\./.test(env.status.textContent), 'the failure message is surfaced verbatim');
    ok(env.bar.hidden === true, 'the indicator is cleared after a failure');
    ok(env.zipButton.disabled === false, 'the export control is restored after a failure');
    ok(env.status.getAttribute('aria-busy') === null, 'aria-busy is cleared after a failure');
    env.dom.window.close();
  }

  /* ------------------------------------------------------------- import */
  {
    let readOptions, restoreWasNonCancelable = false;
    const env = makeWidget({
      onRead: async (file, options) => {
        readOptions = options;
        for (let step = 1; step <= 2; step += 1) {
          if (options.signal?.aborted) throw abortError();
          options.onProgress?.({ phase: 'read', loaded: step * 50, total: 100, fraction: step / 2 });
          await tick(15);
        }
        return { meta: { ownerUid: 'uid-1' } };
      },
      onRestore: async () => {
        restoreWasNonCancelable = env.cancelButton.hidden === true && env.bar.getAttribute('data-mode') === 'indeterminate' && env.bar.getAttribute('aria-valuenow') === null;
      }
    });
    const input = env.w.document.querySelector('input[type="file"]');
    const file = new env.w.File(['{"meta":{}}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new env.w.Event('change'));
    await tick(10);
    ok(env.bar.hidden === false, 'importing shows the inline indicator');
    ok(env.cancelButton.hidden === false, 'reading a file is cancellable');
    ok(readOptions && readOptions.signal, 'the codec receives an abort signal for the read phase');
    await tick(60);
    ok(restoreWasNonCancelable, 'restore is labeled indeterminate and has no misleading Cancel control');
    ok(env.bar.hidden === true, 'the indicator clears after the import finishes');
    ok(env.importButton.disabled === false, 'the import control is restored');
    env.dom.window.close();
  }

  /* -------------------------------------------- import cancellation path */
  {
    const env = makeWidget({
      onRead: async (file, options) => {
        options.onProgress?.({ phase: 'read', loaded: 10, total: 100, fraction: 0.1 });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
        });
        return {};
      }
    });
    const input = env.w.document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new env.w.File(['{}'], 'b.json')] });
    input.dispatchEvent(new env.w.Event('change'));
    await tick(15);
    env.cancelButton.click();
    await tick(60);
    ok(/Import cancelled before anything was restored/.test(env.status.textContent), 'import cancellation is described accurately');
    ok(env.bar.hidden === true, 'the indicator clears after import cancellation');
    ok(env.importButton.disabled === false, 'the import control is restored after cancellation');
    env.dom.window.close();
  }

  console.log('Backup progress: ' + passed + ' assertions passed, 0 failed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
