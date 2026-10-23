import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, indexedDBLocalPersistence, setPersistence, onIdTokenChanged, signInWithPopup, signOut } from 'firebase/auth';
import { createController, errorMessage } from './auth-controller.js';
import { startProtectedRuntime } from './protected-runtime.js';
import * as backupCodec from './backup-codec.js';
window.AriseBackupCodec = backupCodec;

async function boot() {
  try {
    const response = await fetch('/api/public-config', { cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.firebase) throw Object.assign(new Error(), { code: 'configuration-unavailable' });
    const auth = getAuth(initializeApp(data.firebase));
    await setPersistence(auth, indexedDBLocalPersistence);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    createController({ user: () => auth.currentUser, signIn: () => signInWithPopup(auth, provider), signOut: () => signOut(auth),
      watch: (next, error) => onIdTokenChanged(auth, user => { Promise.resolve(next(user)).catch(error); }, error) });
    startProtectedRuntime();
  } catch (error) {
    document.getElementById('cloud-title').textContent = 'Your secure workspace';
    document.getElementById('cloud-message').textContent = errorMessage(error);
    document.getElementById('cloud-google').disabled = true;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'cloud-button'; retry.textContent = 'Retry connection';
    retry.addEventListener('click', () => location.reload()); document.getElementById('cloud-actions').replaceChildren(retry);
  }
}
boot();
