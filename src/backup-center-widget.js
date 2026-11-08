/* Local backup/restore remains available; Google/UID sync replaces shared codes
   and browser-stored Gist tokens. Only the signed-in account is ever exported. */
(function () {
  'use strict';
  function node(tag, text, className) {
    var element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
  }
  window.__mountBackupCenter = function (host) {
    if (!host) return;
    host.replaceChildren();
    var card = node('section', '', 'cloud-card'); card.style.width = '100%';
    card.appendChild(node('h2', 'Backup & secure cloud sync'));
    card.appendChild(node('p', 'Progress saves automatically to your approved Google account. Backups include this account’s audited stores and both attachment databases, with file bodies preserved. Firebase sessions, credentials and other users’ caches are never exported.'));
    var status = node('p', '', 'cloud-note'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); card.appendChild(status);
    var actions = node('div'); actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin:16px 0'; card.appendChild(actions);
    // Shared loading system (optional: the widget still works without it).
    var Loading = window.AriseLoading;
    var opProgress = node('div', '', 'ars-progress');
    opProgress.setAttribute('data-mode', 'indeterminate');
    opProgress.setAttribute('role', 'progressbar');
    opProgress.setAttribute('aria-label', 'Backup operation in progress');
    opProgress.innerHTML = '<div class="ars-progress-track"><div class="ars-progress-fill"></div></div><div class="ars-progress-label"></div>';
    opProgress.hidden = true;
    card.appendChild(opProgress);
    var opLabel = opProgress.querySelector('.ars-progress-label');
    // Cancellation is offered only for phases that are genuinely reversible:
    // encoding the snapshot and reading the chosen file. Restoring cannot be
    // aborted safely, so the control disappears before that phase starts.
    var cancelBtn = node('button', 'Cancel', 'cloud-button'); cancelBtn.type = 'button'; cancelBtn.hidden = true;
    card.appendChild(cancelBtn);
    var active = null;
    var PHASE_LABELS = {
      encode: 'Encoding backup items…',
      read: 'Reading backup bytes…',
      serialize: 'Serializing backup…',
      compress: 'Compressing archive…',
      unpack: 'Unpacking archive…',
      parse: 'Checking backup…',
      done: 'Finishing…'
    };
    function resetProgress() {
      opProgress.hidden = true;
      opProgress.setAttribute('data-mode', 'indeterminate');
      opProgress.removeAttribute('aria-valuenow');
      opProgress.removeAttribute('aria-valuemin');
      opProgress.removeAttribute('aria-valuemax');
      opProgress.removeAttribute('aria-valuetext');
      opProgress.style.removeProperty('--ars-progress');
      if (opLabel) opLabel.textContent = '';
    }
    function showPercent(fraction, label) {
      var percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
      opProgress.hidden = false;
      opProgress.setAttribute('data-mode', 'determinate');
      opProgress.setAttribute('aria-valuemin', '0');
      opProgress.setAttribute('aria-valuemax', '100');
      opProgress.setAttribute('aria-valuenow', String(percent));
      opProgress.setAttribute('aria-valuetext', (label || 'Working…') + ' ' + percent + '%');
      opProgress.style.setProperty('--ars-progress', String(fraction));
      if (opLabel) opLabel.textContent = (label || 'Working…') + ' ' + percent + '%';
    }
    function showPhase(phase, label) {
      opProgress.hidden = false;
      opProgress.setAttribute('data-mode', 'indeterminate');
      opProgress.removeAttribute('aria-valuenow');
      opProgress.removeAttribute('aria-valuetext');
      opProgress.style.removeProperty('--ars-progress');
      if (opLabel) opLabel.textContent = PHASE_LABELS[phase] || label || 'Working…';
    }
    function beginOperation(label, cancelable) {
      var controller = null;
      if (cancelable && typeof AbortController === 'function') controller = new AbortController();
      active = { controller: controller, label: label, cancelable: !!controller };
      opProgress.hidden = false;
      opProgress.setAttribute('data-mode', 'indeterminate');
      if (opLabel) opLabel.textContent = label;
      cancelBtn.hidden = !active.cancelable;
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
      if (Loading && Loading.progress) Loading.progress.start();
      return {
        signal: controller ? controller.signal : undefined,
        onProgress: function (info) {
          if (!info) return;
          var phaseLabel = PHASE_LABELS[info.phase] || label;
          if (typeof info.fraction === 'number' && isFinite(info.fraction)) showPercent(info.fraction, phaseLabel);
          else if (info.phase) showPhase(info.phase, phaseLabel);
        }
      };
    }
    function endOperation(failed) {
      active = null;
      resetProgress();
      cancelBtn.hidden = true;
      cancelBtn.disabled = false;
      status.removeAttribute('aria-busy');
      if (Loading && Loading.progress) {
        if (failed && Loading.progress.fail) Loading.progress.fail();
        else Loading.progress.done();
      }
    }
    cancelBtn.addEventListener('click', function () {
      if (!active || !active.controller || active.controller.signal.aborted) return;
      active.controller.abort();
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling…';
      if (opLabel) opLabel.textContent = 'Cancelling…';
    });
    function setBusy(control, busy, label) {
      if (!control) return;
      if (Loading && Loading.button) {
        if (busy) Loading.button.busy(control, true, label || 'Working…');
        else Loading.button.busy(control, false);
      } else {
        control.disabled = !!busy;
        if (busy) control.setAttribute('aria-busy', 'true');
        else control.removeAttribute('aria-busy');
      }
      if (busy) status.setAttribute('aria-busy', 'true');
      else status.removeAttribute('aria-busy');
    }
    function button(text, fn, busyLabel, cancelable) {
      var control = node('button', text, 'cloud-button'); control.type = 'button';
      control.addEventListener('click', async function () {
        if (control.disabled || control.getAttribute('data-cloud-busy') === 'true') return;
        control.setAttribute('data-cloud-busy', 'true');
        setBusy(control, true, busyLabel || 'Working…');
        var options = beginOperation(busyLabel || 'Working…', cancelable);
        var failed = false, cancelled = false;
        try {
          await fn(options);
        } catch (error) {
          if (error && error.name === 'AbortError') {
            cancelled = true;
            if (Loading && Loading.announce) Loading.announce('Backup cancelled. Nothing was changed.');
          } else {
            failed = true;
            status.textContent = error.message || 'Backup operation paused. Existing data is retained; do not clear this browser.';
            if (Loading && Loading.announce) Loading.announce('Backup operation failed. Existing data is retained.', { assertive: true });
          }
        } finally {
          control.removeAttribute('data-cloud-busy');
          setBusy(control, false);
          endOperation(failed);
          if (cancelled) status.textContent = 'Backup cancelled before anything changed. Your data and account are untouched.';
        }
      }); actions.appendChild(control);
      return control;
    }
    function auth() { if (!window.AriseAuth || !window.AriseAuth.snapshot().isAuthenticated) throw new Error('Sign in with an approved Google account first.'); return window.AriseAuth; }
    button('Export Backup (JSON)', async function (options) { await auth().exportBackup(options); status.textContent = 'Account backup exported. Keep this file private.'; }, 'Preparing backup…', true);
    button('Export ZIP', async function (options) {
      auth();
      await window.AriseBackupCodec.downloadZip(await window.AriseStorage.snapshot(false), options);
      status.textContent = 'Lossless ZIP backup exported. JSON and ZIP use the same ownership-checked restore.';
}, 'Preparing backup…', true);
    var recovery = node('select'); recovery.setAttribute('aria-label', 'Device recovery snapshot'); recovery.className = 'cloud-button'; recovery.hidden = true; actions.appendChild(recovery);
    if (window.AriseAuth && window.AriseAuth.recoveryCopies) window.AriseAuth.recoveryCopies().then(function (entries) {
      entries.slice().reverse().forEach(function (entry) { var option = node('option', new Date(entry.capturedAt).toLocaleString() + ' · ' + entry.localKeys + ' stores'); option.value = entry.key; recovery.appendChild(option); });
      recovery.hidden = !entries.length;
    }).catch(function () {});
    button('Download previous device snapshot', async function (options) { await auth().exportRecovery(recovery.value || undefined, options); }, 'Preparing snapshot…', true);
    var input = node('input'); input.type = 'file'; input.accept = '.json,.zip,application/json,application/zip'; input.hidden = true; card.appendChild(input);
    var importBtn = button('Import & Restore', async function () { auth(); input.click(); }, 'Choose a file…', false);
    input.addEventListener('change', async function () {
      if (!input.files[0] || importBtn.disabled) return;
      setBusy(importBtn, true, 'Restoring backup…');
      var options = beginOperation('Reading backup…', true);
      var failed = false;
      try {
        status.textContent = 'Reading backup. Ownership confirmation and a before-restore copy are required.';
        var raw = await window.AriseBackupCodec.readBackupFile(input.files[0], options);
        // Restoring is not cancellable: the signal is deliberately not forwarded.
        cancelBtn.hidden = true;
        showPhase('restore', 'Restoring backup…');
        await auth().importBackup(raw);
      } catch (error) {
        if (error && error.name === 'AbortError') {
          status.textContent = 'Import cancelled before anything was restored. Existing records are unchanged.';
          if (Loading && Loading.announce) Loading.announce('Import cancelled. Nothing was restored.');
        } else {
          failed = true;
          status.textContent = error.message || 'Import could not finish. Backup and existing records are retained.';
          if (Loading && Loading.announce) Loading.announce('Import failed. Existing records are retained.', { assertive: true });
        }
      } finally {
        setBusy(importBtn, false);
        endOperation(failed);
        input.value = '';
      }
    });
    button('Save now / Retry', async function () {
      auth(); var ok = await window.AriseCloudSync.push();
      status.textContent = ok ? 'Cloud database confirmed the pending writes.' : 'Not yet saved. Check the sync indicator; pending changes remain on this device.';
    }, 'Saving…', false);
    button('Check other devices', async function () { auth(); await window.AriseCloudSync.pull(); }, 'Checking…', false);
    card.appendChild(node('p', 'Recovery: the pre-migration browser data is never deleted. Download its recovery copy from the account menu. Interrupted imports resume for the same account; never clear site data while changes are pending. Shared-code and browser-token Gist sync have been retired for security. Existing remote copies are not deleted; the owner can archive them with trusted provider tools.'));
    host.appendChild(card);
    var snapshot = window.AriseAuth && window.AriseAuth.snapshot();
    status.textContent = snapshot && snapshot.isAuthenticated ? 'Signed in. Use the account menu for verified email, saving status and sign out.' : 'Sign in to access protected backup and progress actions.';
  };
})();
