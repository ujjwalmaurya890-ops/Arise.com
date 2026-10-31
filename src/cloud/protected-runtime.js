export function startProtectedRuntime() {
  return window.AriseBoot.ready.then(async () => {
    // Fetch in parallel only AFTER access/restore/consent. Keep execution in the
    // original order below; preload mode must match each eventual script type.
    const placeholders = [...document.querySelectorAll('script[data-arise-protected]')];
    for (const placeholder of placeholders) {
      const link = document.createElement('link');
      link.rel = placeholder.dataset.module ? 'modulepreload' : 'preload';
      link.href = placeholder.dataset.src;
      if (placeholder.dataset.module) link.crossOrigin = 'anonymous';
      else link.setAttribute('as', 'script');
      document.head.appendChild(link);
    }
    for (const placeholder of placeholders) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = placeholder.dataset.src;
        if (placeholder.dataset.module) { script.type = 'module'; script.crossOrigin = 'anonymous'; }
        let settled = false;
        const timer = setTimeout(() => finish(false), 15000);
        const finish = ok => {
          if (settled) return;
          settled = true; clearTimeout(timer); script.onload = script.onerror = null;
          if (ok) resolve();
          else { script.remove(); reject(new Error('Workspace asset unavailable.')); }
        };
        script.onload = () => finish(true); script.onerror = () => finish(false);
        try { document.head.appendChild(script); } catch { finish(false); }
      });
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }).catch(() => {
    document.documentElement.removeAttribute('data-cloud-auth');
    const root = document.getElementById('root'); root.inert = true; root.setAttribute('aria-hidden', 'true');
    const gate = document.getElementById('cloud-gate'); gate.hidden = false; gate.dataset.busy = 'false'; gate.setAttribute('aria-busy', 'false');
    document.getElementById('cloud-account').hidden = true;
    document.getElementById('cloud-title').textContent = 'Workspace unavailable';
    const message = document.getElementById('cloud-message'); message.removeAttribute('aria-busy');
    message.textContent = 'A workspace file could not load. Try again; your saved data is retained.';
    const google = document.getElementById('cloud-google'); google.hidden = true; google.disabled = true;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'cloud-button'; retry.textContent = 'Retry loading workspace';
    retry.addEventListener('click', () => location.reload());
    document.getElementById('cloud-actions').replaceChildren(retry);
  });
}
