export function startProtectedRuntime() {
  return window.AriseBoot.ready.then(async () => {
    // Preserve the existing runtime; only delay it until access/restore/consent.
    for (const placeholder of document.querySelectorAll('script[data-arise-protected]')) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = placeholder.dataset.src;
        if (placeholder.dataset.module) { script.type = 'module'; script.crossOrigin = 'anonymous'; }
        script.onload = resolve; script.onerror = () => reject(new Error('Workspace asset unavailable.'));
        document.head.appendChild(script);
      });
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }).catch(() => {
    document.documentElement.removeAttribute('data-cloud-auth');
    document.getElementById('root').inert = true;
    document.getElementById('cloud-gate').hidden = false;
    document.getElementById('cloud-message').textContent = 'A workspace file could not load. Refresh to retry. Your data is retained.';
  });
}
