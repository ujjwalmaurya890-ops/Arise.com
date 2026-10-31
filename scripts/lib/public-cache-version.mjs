import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Content-only, sorted traversal: mtimes and machine paths do not affect a build.
// Called only on the allowlisted public dist tree, never server/env/user data.
export async function publicCacheVersion(directory) {
  const hash = createHash('sha256');
  async function visit(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        let content = await readFile(path.join(directory, name));
        if (name === 'service-worker.js') {
          // Stable even when verifying an already-versioned build.
          content = Buffer.from(content.toString('utf8').replace(/(CACHE_NAME="[^"]*?)-[a-f0-9]{16}"/, '$1"'));
        }
        hash.update(name + '\0' + content.length + '\0');
        hash.update(content);
      } else throw new Error('Unsupported public build entry: ' + name);
    }
  }
  await visit();
  return hash.digest('hex').slice(0, 16);
}
