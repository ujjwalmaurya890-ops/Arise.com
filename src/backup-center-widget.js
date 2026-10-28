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
    function setBusy(control, busy) {
      if (!control) return;
      control.disabled = !!busy;
      if (busy) control.setAttribute('aria-busy', 'true');
      else control.removeAttribute('aria-busy');
    }
    function button(text, fn) {
      var control = node('button', text, 'cloud-button'); control.type = 'button';
      control.addEventListener('click', async function () {
        if (control.disabled) return;
        setBusy(control, true);
        try { await fn(); } catch (error) { status.textContent = error.message || 'Backup operation paused. Existing data is retained; do not clear this browser.'; }
        finally { setBusy(control, false); }
      }); actions.appendChild(control);
      return control;
    }
    function auth() { if (!window.AriseAuth || !window.AriseAuth.snapshot().isAuthenticated) throw new Error('Sign in with an approved Google account first.'); return window.AriseAuth; }
    button('Export Backup (JSON)', async function () { await auth().exportBackup(); status.textContent = 'Account backup exported. Keep this file private.'; });
    button('Export ZIP', async function () {
      auth();
      await window.AriseBackupCodec.downloadZip(await window.AriseStorage.snapshot(false));
      status.textContent = 'Lossless ZIP backup exported. JSON and ZIP use the same ownership-checked restore.';
    });
    var recovery = node('select'); recovery.setAttribute('aria-label', 'Device recovery snapshot'); recovery.className = 'cloud-button'; recovery.hidden = true; actions.appendChild(recovery);
    if (window.AriseAuth && window.AriseAuth.recoveryCopies) window.AriseAuth.recoveryCopies().then(function (entries) {
      entries.slice().reverse().forEach(function (entry) { var option = node('option', new Date(entry.capturedAt).toLocaleString() + ' · ' + entry.localKeys + ' stores'); option.value = entry.key; recovery.appendChild(option); });
      recovery.hidden = !entries.length;
    }).catch(function () {});
    button('Download previous device snapshot', async function () { await auth().exportRecovery(recovery.value || undefined); });
    var input = node('input'); input.type = 'file'; input.accept = '.json,.zip,application/json,application/zip'; input.hidden = true; card.appendChild(input);
    var importBtn = button('Import & Restore', async function () { auth(); input.click(); });
    input.addEventListener('change', async function () {
      if (!input.files[0] || importBtn.disabled) return;
      setBusy(importBtn, true);
      status.setAttribute('aria-busy', 'true');
      try {
        status.textContent = 'Reading backup. Ownership confirmation and a before-restore copy are required.';
        var raw = await window.AriseBackupCodec.readBackupFile(input.files[0]); await auth().importBackup(raw);
      } catch (error) { status.textContent = error.message || 'Import could not finish. Backup and existing records are retained.'; }
      finally {
        setBusy(importBtn, false);
        status.removeAttribute('aria-busy');
        input.value = '';
      }
    });
    button('Save now / Retry', async function () {
      auth(); var ok = await window.AriseCloudSync.push();
      status.textContent = ok ? 'Cloud database confirmed the pending writes.' : 'Not yet saved. Check the sync indicator; pending changes remain on this device.';
    });
    button('Check other devices', async function () { auth(); await window.AriseCloudSync.pull(); });
    card.appendChild(node('p', 'Recovery: the pre-migration browser data is never deleted. Download its recovery copy from the account menu. Interrupted imports resume for the same account; never clear site data while changes are pending. Shared-code and browser-token Gist sync have been retired for security. Existing remote copies are not deleted; the owner can archive them with trusted provider tools.'));
    host.appendChild(card);
    var snapshot = window.AriseAuth && window.AriseAuth.snapshot();
    status.textContent = snapshot && snapshot.isAuthenticated ? 'Signed in. Use the account menu for verified email, saving status and sign out.' : 'Sign in to access protected backup and progress actions.';
  };
})();
