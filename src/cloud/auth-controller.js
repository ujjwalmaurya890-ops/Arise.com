import { CloudSync, operationId } from './sync-engine.js';
import { decodeBackup, downloadBackup, fingerprint } from './backup-codec.js';

const labels = { saving: 'Saving…', saved: 'Saved', offline: 'Offline · changes pending', failed: 'Sync failed', retrying: 'Retrying…', conflict: 'Resolve sync conflict', remote: 'Update available', unsupported: 'Local-only setting' };
const errorMessage = error => {
  if (error?.code === 'access-denied' || error?.status === 403) return 'This Google account is not approved for Arise. Ask the owner to approve your verified email address.';
  if (error?.code === 'access-unavailable') return 'Access is temporarily unavailable. Your progress is safe; please contact the workspace owner.';
  if (error?.code === 'configuration-unavailable') return 'Google sign-in is not configured yet. The workspace owner must complete the secure setup checklist.';
  if (error?.code === 'configuration-timeout') return 'The secure connection timed out. Check your connection and retry; your existing progress is safe.';
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error?.code)) return 'Sign-in was cancelled. You can try again when ready.';
  if (error?.code === 'auth/popup-blocked') return 'Allow pop-ups for this site, then try again. If you are in a preview, open it in a full browser tab.';
  if (error?.code === 'auth/unauthorized-domain' || error?.code === 'auth/invalid-api-key' || error?.code === 'auth/operation-not-allowed') return 'Google sign-in needs an owner configuration update. Please contact the workspace owner.';
  if (error?.status === 401 || /^auth\/(user-disabled|user-token-expired|invalid-user-token)/.test(error?.code || '')) return 'Your session has expired or access has changed. Sign in again. Pending changes remain on this device.';
  return 'We could not connect securely. Check your connection and retry. Existing data has not been deleted.';
};

export function createController(adapter, { storage = window.AriseStorage, schema = window.AriseSyncSchema, fetcher = window.fetch.bind(window), reload = () => location.reload() } = {}) {
  const element = id => document.getElementById(id);
  let sync, currentUser, attemptedOwner, generation = 0, started = false, unsubscribeStorage, lastError, pollTimer, releaseAccount;
  const gate = (title, message, busy = false) => {
    document.documentElement.removeAttribute('data-cloud-auth');
    element('root').inert = true; element('root').setAttribute('aria-hidden', 'true');
    const gateEl = element('cloud-gate');
    gateEl.hidden = false; gateEl.dataset.busy = busy ? 'true' : 'false'; gateEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    element('cloud-account').hidden = true;
    element('cloud-title').textContent = title;
    const msgEl = element('cloud-message');
    msgEl.textContent = message; msgEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    element('cloud-google').disabled = busy; element('cloud-google').hidden = busy;
    element('cloud-actions').replaceChildren();
  };
  const action = (parent, text, handler) => {
    const button = document.createElement('button'); button.className = 'cloud-button'; button.type = 'button'; button.textContent = text;
    button.addEventListener('click', handler); parent.appendChild(button); return button;
  };
  const prompt = (title, message, choices, backup) => {
    // Waiting for a decision is not network activity; do not leave a spinner
    // or aria-busy on an interactive consent prompt.
    gate(title, message, false);
    element('cloud-google').hidden = true; element('cloud-google').disabled = true;
    if (backup) action(element('cloud-actions'), 'Download recovery backup', () => downloadBackup(backup, 'arise-pre-migration').catch(() => { element('cloud-message').textContent = 'Could not export the backup. Browser data is still retained; do not clear it.'; }));
    return new Promise(resolve => {
      for (const choice of choices) action(element('cloud-actions'), choice.label, () => { element('cloud-actions').replaceChildren(); resolve(choice.value); });
    });
  };
  const publish = () => window.dispatchEvent(new Event('arise:auth-state'));
  const status = info => {
    const account = element('cloud-account'); account.dataset.status = info.status;
    element('cloud-sync-label').textContent = labels[info.status] || info.status;
    element('cloud-sync-detail').textContent = info.message || (info.status === 'saved' ? 'Confirmed by the cloud database. Pending offline changes are never labelled saved.' :
      info.status === 'offline' ? 'Changes stay in this account’s local recovery queue. Keep this browser data until it reconnects.' :
      info.status === 'remote' ? 'Progress changed on another device. Refresh to restore it before continuing.' :
      info.status === 'conflict' ? 'Another device changed the same store. Both versions are retained until you decide.' : 'Cloud progress sync is running in the background.');
    if (info.attachmentProgress !== undefined) element('cloud-sync-detail').textContent = 'Uploading attachment: ' + info.attachmentProgress + '%';
    if (info.status === 'conflict') showConflict();
    publish();
  };
  const fatal = async error => {
    lastError = error; generation++; gate('Sign-in required', errorMessage(error)); clearInterval(pollTimer); unsubscribeStorage?.(); sync?.stop();
    try { await sync?.persistence; } catch {}
    releaseAccount?.(); releaseAccount = null; storage.lock();
    gate('Sign-in required', errorMessage(error)); publish();
    try { await adapter.signOut(); } catch { /* Gate remains locked even if provider cleanup fails. */ }
  };
  const requestFor = (user, sessionGeneration) => async (query = '', body) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (sessionGeneration !== generation || adapter.user()?.uid !== user.uid) throw Object.assign(new Error('Session changed.'), { status: 401 });
      let token;
      try { token = await user.getIdToken(attempt === 1); }
      catch (error) { throw Object.assign(error, { status: 401 }); }
      const encodedBody = body ? JSON.stringify(body) : undefined;
      const response = await fetcher('/api/cloud' + query, { method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: encodedBody, keepalive: document.hidden && new TextEncoder().encode(encodedBody).byteLength < 48000 } : {}), signal: AbortSignal.timeout(25000) });
      if (sessionGeneration !== generation) throw Object.assign(new Error('Session changed.'), { status: 401 });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) throw Object.assign(new Error('Secure request failed.'), { status: response.status, code: data.error });
      return data;
    }
  };
  async function showConflict() {
    const modal = element('cloud-conflict');
    if (!modal.hidden) return;
    const focusBefore = document.activeElement;
    const wasInert = element('root').inert; element('root').inert = true;
    modal.hidden = false; const buttons = element('cloud-conflict-actions'); buttons.replaceChildren();
    action(buttons, 'Download this device’s backup', async () => downloadBackup(await storage.snapshot(false)));
    for (const [label, keepLocal] of [['Use cloud version', false], ['Keep this device’s version', true]]) {
      action(buttons, label, async event => {
        const button = event.currentTarget; button.disabled = true;
        try {
          if (keepLocal && !window.confirm('Replace the conflicting cloud store with this device’s saved version? Other cloud stores are not changed. Both prior versions remain recoverable.')) return;
          await sync.resolveConflict(keepLocal);
          if (!sync.blocked) reload();
        } catch { element('cloud-conflict-message').textContent = 'Conflict recovery could not finish. Both versions and the pending queue are retained. Please retry.'; }
        finally { button.disabled = false; }
      });
    }
    const close = action(buttons, 'Decide later', () => {
      modal.hidden = true; element('root').inert = wasInert; focusBefore?.focus();
    });
    close.focus();
  }
  const trapFocus = event => {
    const modal = element('cloud-conflict');
    if (modal.hidden || event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button:not(:disabled)')];
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', trapFocus);

  async function migration(sessionGeneration, engine) {
    const ownerUid = engine.uid;
    const ensure = () => {
      if (sessionGeneration !== generation || sync !== engine || storage.uid !== ownerUid || !engine.active) throw Object.assign(new Error('The account session changed.'), { status: 401 });
    };
    let backup = await storage.load('legacy:backup:v1'); ensure();
    if (!backup) {
      backup = await storage.snapshot(true); ensure();
      if (!Object.keys(backup.localStorage).length && !backup.indexedDB.length && !backup.unknownKeys?.length) return;
      await storage.save('legacy:backup:v1', backup); ensure(); // BEFORE import; never clear the source.
    }
    const assignment = await storage.load('legacy:assignment:v1');
    const declined = await storage.load('legacy:declined:' + ownerUid); ensure();
    if (assignment?.uid && assignment.uid !== ownerUid || assignment?.status === 'complete' || declined) return;
    if (!assignment) {
      const own = await prompt('Keep your existing progress', 'This browser contains older local progress. Does it belong to the signed-in account (' + engine.profile.email + ')? Nothing will be uploaded without your confirmation. If unsure, keep it separate.',
        [{ label: 'This is mine — continue', value: true }, { label: 'Not mine / keep separate', value: false }], backup); ensure();
      if (!own) { await storage.save('legacy:declined:' + ownerUid, true); return; }
    }
    const migrationId = assignment?.migrationId || await fingerprint(backup); ensure();
    await storage.save('legacy:assignment:v1', { uid: ownerUid, migrationId, status: 'pending', consentAt: assignment?.consentAt || new Date().toISOString() }); ensure();
    let replace = false;
    if (engine.records.size) {
      replace = await prompt('Choose how to import', 'Your cloud account already has progress. Import only missing stores to keep existing cloud values, or explicitly replace matching stores with your confirmed local backup. The original local data and a recovery copy are retained either way.',
        [{ label: 'Keep cloud; import missing stores', value: false }, { label: 'Replace matching cloud stores', value: true }], backup); ensure();
      if (replace && !window.confirm('Confirm that this backup belongs to you and may replace matching cloud progress. This decision is recorded; original backups are retained.')) replace = false;
    }
    gate('Importing your progress', 'Backing up, saving and verifying each store. Keep this page open. If interrupted, sign in again on this device to resume safely.', true);
    const report = await engine.importSnapshot(backup, { migrationId, replace }); ensure();
    await storage.save('legacy:assignment:v1', { uid: ownerUid, migrationId, status: 'complete', report }); ensure();
    element('cloud-recovery-note').textContent = 'Import verified: ' + report.verified + ' stores. ' + report.skipped.length + ' conflicting/unsupported stores retained in the recovery backup.';
  }
  async function startUser(user) {
    if (!user) {
      gate('Your progress. Every device.', lastError ? errorMessage(lastError) : 'Sign in to your private CSE workspace. Your approved Google account restores your progress securely across devices.');
      generation++; currentUser = null; clearInterval(pollTimer); unsubscribeStorage?.(); sync?.stop();
      try { await sync?.persistence; } catch {}
      releaseAccount?.(); releaseAccount = null; storage.lock();
      gate('Your progress. Every device.', lastError ? errorMessage(lastError) : 'Sign in to your private CSE workspace. Your approved Google account restores your progress securely across devices.'); publish(); return;
    }
    if (attemptedOwner && !currentUser) { gate('Restoring session', 'Reloading your account safely…', true); reload(); return; }
    if (currentUser?.uid === user.uid) { if (started) sync?.poll(); return; }
    if (currentUser) { generation++; sync?.stop(); storage.lock(); gate('Switching account', 'Restoring the next account safely…', true); reload(); return; }
    currentUser = user; attemptedOwner = user.uid; const sessionGeneration = ++generation;
    gate('Restoring your workspace', 'Checking account access and loading your saved cloud progress…', true);
    try {
      const request = requestFor(user, sessionGeneration);
      const state = await request('?action=state');
      if (state.profile.uid !== user.uid || sessionGeneration !== generation) throw Object.assign(new Error(), { status: 401 });
      storage.activate(state.profile.uid);
      const acquired = storage.acquire ? await storage.acquire() : null;
      if (sessionGeneration !== generation) { acquired?.(); return; }
      releaseAccount = acquired;
      sync = new CloudSync({ storage, schema, request, onStatus: status, onFatal: fatal,
        onRemote: async () => {
          if (started) {
            const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
            if (!editing && document.visibilityState !== 'hidden') reload();
            return false;
          }
          return true;
        } });
      await sync.initialize(state);
      if (sync.blocked || !sync.active || sessionGeneration !== generation) return;
      await migration(sessionGeneration, sync);
      if (sessionGeneration !== generation) return;
      unsubscribeStorage = storage.onChange((key, value, journal) => sync.enqueue(key, value, journal ? { opId: journal.opId, occurredAt: journal.occurredAt, journalKind: 'local' } : {}));
      await sync.scanAttachments();
      // The secure gate replaces the old anonymous landing screen, not the workspace.
      localStorage.setItem('showLanding', 'false');
      if (!localStorage.getItem('appSettings')) localStorage.setItem('appSettings', JSON.stringify({ theme: 'cyberpunk', sidebarCollapsed: true, userName: sync.profile.name || 'Student' }));
      const theme = localStorage.getItem('arise-dashboard-theme') || 'cyberMidnightPro';
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.themeMode = ['cyberMidnightPro', 'amoled', 'dracula', 'linearDark', 'vercelMono', 'supabaseDark'].includes(theme) ? 'dark' : 'light';
      window.AriseCloudSync = { isConfigured: () => sync.active, push: () => sync.flush(), pull: () => sync.poll() };
      element('cloud-account-name').textContent = sync.profile.name || 'Arise member';
      element('cloud-account-email').textContent = sync.profile.email + ' · verified';
      const avatar = element('cloud-avatar'); avatar.onerror = () => { avatar.onerror = null; avatar.src = './assets/arise-logo.svg'; avatar.alt = 'Arise account'; }; avatar.hidden = !sync.profile.photoURL; avatar.src = sync.profile.photoURL || './assets/arise-logo.svg';
      gate('Workspace ready', 'Your saved progress is restored.', true);
      document.documentElement.dataset.cloudAuth = 'ready';
      element('root').inert = false; element('root').removeAttribute('aria-hidden');
      element('cloud-gate').hidden = true; element('cloud-account').hidden = false;
      started = true; window.AriseBoot.start(); publish();
      pollTimer = setInterval(() => { if (!document.hidden) sync.poll(); }, 20000);
    } catch (error) {
      if (sessionGeneration !== generation) return;
      if ([401, 403].includes(error.status) || ['access-unavailable', 'configuration-unavailable'].includes(error.code)) return fatal(error);
      gate('Restore paused safely', /another tab|Web Locks/.test(error.message || '') ? error.message : errorMessage(error));
      action(element('cloud-actions'), 'Retry restore', reload);
      if (storage.uid) action(element('cloud-actions'), 'Download recovery backup', async () => downloadBackup(await storage.snapshot(false)));
      action(element('cloud-actions'), 'Sign out', logout);
    }
  }
  async function login() {
    lastError = null;
    const button = element('cloud-google');
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    element('cloud-message').textContent = 'Opening Google sign-in…';
    try { await adapter.signIn(); }
    catch (error) { lastError = error; gate('Continue with Google', errorMessage(error)); }
    finally { button.removeAttribute('aria-busy'); }
  }
  async function logout() {
    gate('Signing out', 'Closing your secure session…', true);
    const pending = sync?.queue.length || 0;
    if (pending) {
      gate('Saving before sign out', 'Finishing pending cloud writes. Unsent changes are retained under this account on this device.', true);
      await Promise.race([sync.flush(), new Promise(resolve => setTimeout(resolve, 10000))]);
      if (sync.queue.length) {
        const proceed = await prompt('Changes are still on this device', 'Some changes have not reached the cloud. Signing out keeps the queue for this same account, but another device cannot restore those changes yet.', [{ label: 'Sign out; keep pending changes', value: true }, { label: 'Stay signed in and retry', value: false }]);
        if (!proceed) { reload(); return; }
      }
    }
    generation++; unsubscribeStorage?.(); sync?.stop(); clearInterval(pollTimer);
    try { await sync?.persistence; } catch {}
    releaseAccount?.(); releaseAccount = null; storage.lock();
    gate('Signing out', 'Closing your secure session…', true);
    try { await adapter.signOut(); reload(); }
    catch { gate('Signed out of the workspace', 'This page is locked. Refresh to finish provider session cleanup.'); }
  }
  async function importBackup(raw) {
    if (!sync?.active) throw new Error('Sign in first.');
    const engine = sync, ownerUid = storage.uid, sessionGeneration = generation;
    const ensure = () => { if (sessionGeneration !== generation || engine !== sync || ownerUid !== storage.uid || !engine.active) throw new Error('The account session changed. Restore stopped safely.'); };
    const snapshot = decodeBackup(raw);
    if (!snapshot || !snapshot.localStorage || typeof snapshot.localStorage !== 'object' || Array.isArray(snapshot.localStorage) || !Array.isArray(snapshot.indexedDB || [])) throw new Error('Not a valid Arise backup.');
    if (snapshot.meta?.ownerUid && snapshot.meta.ownerUid !== ownerUid) throw new Error('This backup belongs to a different account.');
    // Old generic JSON exports encoded Blob as {} and cannot recover bytes.
    // Never pretend those are valid files or silently discard their metadata.
    for (const database of snapshot.indexedDB || []) {
      if (!schema.databases[database.name]) continue;
      for (const contents of Object.values(database.stores || {})) {
        for (const entry of contents.records || []) {
          if (!(entry.value?.blob instanceof Blob) || !['string', 'number'].includes(typeof entry.value?.id)) throw new Error('This older backup does not contain valid attachment bytes. Keep the file and use the original browser’s new account backup export; do not clear its site data.');
        }
      }
    }
    const backupId = await fingerprint(snapshot); ensure();
    const owner = await storage.load('import-owner:' + backupId); ensure();
    if (owner && owner !== ownerUid) throw new Error('This backup has already been assigned to a different account in this browser.');
    if (!window.confirm('I confirm that this backup belongs to ' + engine.profile.email + '. Restore its matching stores to this account? A before-restore backup will be kept.')) return;
    await storage.save('import-owner:' + backupId, ownerUid); ensure();
    await engine.archiveRecovery(await storage.snapshot(false), 'before-manual-restore'); ensure();
    await storage.save('manual-source:' + ownerUid + ':' + backupId, snapshot); ensure();
    const restoreId = operationId();
    const report = await engine.importSnapshot(snapshot, { migrationId: restoreId, replace: true, kind: 'restore' });
    ensure(); reload(); return report;
  }
  const withButtonPending = (button, fn) => async () => {
    if (!button || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try { await fn(); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  };
  element('cloud-google').addEventListener('click', login);
  element('cloud-signout').addEventListener('click', logout);
  element('cloud-retry').addEventListener('click', withButtonPending(element('cloud-retry'), () => sync?.blocked && sync.conflict ? showConflict() : sync?.lastStatus.status === 'remote' ? reload() : sync?.flush()));
  element('cloud-export').addEventListener('click', withButtonPending(element('cloud-export'), async () => { try { await downloadBackup(await storage.snapshot(false)); } catch { status({ status: 'failed', message: 'Backup export failed. Browser data is retained. Do not clear this browser.' }); } }));
  element('cloud-legacy-export').addEventListener('click', withButtonPending(element('cloud-legacy-export'), async () => {
    const assignment = await storage.load('legacy:assignment:v1');
    const backup = await storage.load('legacy:backup:v1');
    if (backup && (!assignment?.uid || assignment.uid === storage.uid)) await downloadBackup(assignment?.uid ? { ...backup, meta: { ...backup.meta, ownerUid: assignment.uid } } : backup, 'arise-original-local');
    else element('cloud-recovery-note').textContent = 'No unassigned recovery backup is available to this account.';
  }));
  window.addEventListener('online', () => { sync?.flush().then(() => sync?.poll()); });
  window.addEventListener('offline', () => sync?.status('offline'));
  document.addEventListener('visibilitychange', () => { if (!sync?.active) return; if (document.hidden) sync.flush(); else sync.poll(); });
  window.addEventListener('pagehide', () => sync?.flush());
  let attachmentTimer;
  window.addEventListener('arise:attachment-error', () => status({ status: 'failed', message: 'The file operation was cancelled because recovery storage is full or the account changed. Existing files are retained. Export a backup before retrying.' }));
  window.addEventListener('arise:attachment-change', () => { clearTimeout(attachmentTimer); attachmentTimer = setTimeout(() => sync?.scanAttachments().catch(() => status({ status: 'failed', message: 'Attachment sync paused. The local file is retained.' })), 200); });
  // Native changes from another tab must never leave stale in-memory React state.
  window.addEventListener('storage', event => { if (!event.__ariseRemote && event.key?.startsWith('arise:account:' + encodeURIComponent(storage.uid) + ':') && started) reload(); });
  const api = {
    login, logout, importBackup,
    snapshot: () => ({ session: { mode: started && sync?.active ? 'google' : 'anonymous', name: sync?.profile?.name || 'Arise member' }, displayName: sync?.profile?.name || 'Arise member', avatarUrl: sync?.profile?.photoURL || null,
      isAuthenticated: !!(started && sync?.active), syncState: { status: sync?.lastStatus.status === 'saved' ? 'synced' : sync?.lastStatus.status === 'saving' ? 'syncing' : sync?.lastStatus.status || 'idle' } }),
    fetch: async (url, options = {}) => {
      if (!currentUser || !sync?.active) throw new Error('Sign in first.');
      const token = await currentUser.getIdToken();
      return fetcher(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token }, cache: 'no-store' });
    },
    exportBackup: async () => downloadBackup(await storage.snapshot(false)),
    recoveryCopies: async () => {
      if (!sync?.active || !storage.uid) throw new Error('Sign in first.');
      return await storage.load('recovery-index:' + storage.uid) || [];
    },
    exportRecovery: async (selectedKey) => {
      if (!sync?.active || !storage.uid) throw new Error('Sign in first.');
      const index = await storage.load('recovery-index:' + storage.uid) || [];
      if (!index.length) throw new Error('No previous device snapshot exists yet.');
      const selected = selectedKey ? index.find(entry => entry.key === selectedKey) : index.at(-1);
      if (!selected) throw new Error('Recovery copy is unavailable for this account.');
      const backup = await storage.load(selected.key);
      if (!backup || backup.meta?.ownerUid && backup.meta.ownerUid !== storage.uid) throw new Error('Recovery copy is unavailable for this account.');
      await downloadBackup(backup, 'arise-previous-device');
    },
    get sync() { return sync; }, startUser
  };
  window.AriseAuth = api;
  adapter.watch(startUser, fatal);
  return api;
}
export { errorMessage };
