import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, indexedDBLocalPersistence, setPersistence, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { createController, errorMessage } from './auth-controller.js';
import { startProtectedRuntime } from './protected-runtime.js';
import * as backupCodec from './backup-codec.js';
window.AriseBackupCodec = backupCodec;

async function loadPublicConfig() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    return await Promise.race([
      fetch('/api/public-config', { cache: 'no-store', credentials: 'omit', ...(controller ? { signal: controller.signal } : {}) }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.firebase) throw Object.assign(new Error(), { code: 'configuration-unavailable' });
        return data;
      }),
      new Promise((_, reject) => { timer = setTimeout(() => {
        reject(Object.assign(new Error('Configuration timed out.'), { code: 'configuration-timeout' }));
        controller?.abort();
      }, 15000); })
    ]);
  } finally { clearTimeout(timer); }
}

async function boot() {
  try {
    const data = await loadPublicConfig();
    const auth = getAuth(initializeApp(data.firebase));
    await setPersistence(auth, indexedDBLocalPersistence);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    createController({ user: () => auth.currentUser, signIn: () => signInWithPopup(auth, provider), signOut: () => signOut(auth),
      watch: (next, error) => onIdTokenChanged(auth, user => { Promise.resolve(next(user)).catch(error); }, error) });
    startProtectedRuntime();
  } catch (error) {
    document.documentElement.removeAttribute('data-cloud-auth');
    const root = document.getElementById('root'); root.inert = true; root.setAttribute('aria-hidden', 'true');
    const gate = document.getElementById('cloud-gate'); gate.hidden = false; gate.dataset.busy = 'false'; gate.setAttribute('aria-busy', 'false');
    document.getElementById('cloud-title').textContent = 'Your secure workspace';
    const message = document.getElementById('cloud-message'); message.textContent = errorMessage(error); message.removeAttribute('aria-busy');
    document.getElementById('cloud-google').disabled = true;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'cloud-button'; retry.textContent = 'Retry connection';
    retry.addEventListener('click', () => location.reload()); document.getElementById('cloud-actions').replaceChildren(retry);
  }
}
boot();
