'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
(async () => {
  const { publicCacheVersion } = await import('../scripts/lib/public-cache-version.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arise-cache-version-'));
  try {
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'index.html'), 'shell one');
    await fs.writeFile(path.join(root, 'assets', 'fixed-name.js'), 'one');
    await fs.writeFile(path.join(root, 'service-worker.js'), 'const CACHE_NAME="arise-developer-system-secure-cloud";');
    const first = await publicCacheVersion(root);
    assert.match(first, /^[a-f0-9]{16}$/);
    assert.equal(await publicCacheVersion(root), first);
    await fs.utimes(path.join(root, 'index.html'), new Date(0), new Date(0));
    assert.equal(await publicCacheVersion(root), first, 'mtime never affects cache revision');
    await fs.writeFile(path.join(root, 'service-worker.js'), 'const CACHE_NAME="arise-developer-system-secure-cloud-' + first + '";');
    assert.equal(await publicCacheVersion(root), first, 'an already-versioned build verifies consistently');
    await fs.writeFile(path.join(root, 'assets', 'fixed-name.js'), 'two');
    assert.notEqual(await publicCacheVersion(root), first, 'equal-size fixed-name code edits invalidate the offline cache');
    await fs.writeFile(path.join(root, 'assets', 'fixed-name.js'), 'one');
    await fs.writeFile(path.join(root, 'index.html'), 'shell two');
    assert.notEqual(await publicCacheVersion(root), first, 'HTML edits invalidate the cache without a manual version bump');
    console.log('Public cache revision: deterministic, content-sensitive and independent of timestamps.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
