// Reproducible, non-destructive static build. Never publish the repository root.
import { build } from 'esbuild';
import { cp, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, ['scripts/tools/build-widget-chunks.cjs'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
for (const file of ['index.html', 'manifest.webmanifest', 'robots.txt', '_redirects', 'service-worker.js', 'assets', 'styles', 'src']) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
await build({ absWorkingDir: root, entryPoints: ['src/cloud/auth-entry.js'], bundle: true, minify: true, format: 'esm', target: ['es2022'],
  outfile: path.join(output, 'assets/cloud-auth.js'), legalComments: 'none', sourcemap: false });
// Public deliverable must not contain privileged code, configs, tests or env files.
for (const forbidden of ['server', 'netlify', '.env', '.git', 'node_modules', 'config', 'tests']) {
  if (await stat(path.join(output, forbidden)).catch(() => null)) throw new Error('Unsafe public build: ' + forbidden);
}
const bundled = await readFile(path.join(output, 'assets/cloud-auth.js'), 'utf8');
if (/FIREBASE_SERVICE_ACCOUNT_JSON|BEGIN PRIVATE KEY|firebase-admin/.test(bundled)) throw new Error('Server credential material in client bundle.');
console.log('Production site built safely in dist/; Firebase Auth bundle ' + Math.round(Buffer.byteLength(bundled) / 1024) + ' KiB.');
