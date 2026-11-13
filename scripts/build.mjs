// Reproducible, non-destructive static build. Never publish the repository root.
import { build, transform } from 'esbuild';
import { cp, mkdir, readdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicCacheVersion } from './lib/public-cache-version.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, ['scripts/tools/build-widget-chunks.cjs'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
for (const file of ['index.html', '404.html', 'manifest.webmanifest', 'robots.txt', '_redirects', 'service-worker.js', 'assets', 'styles', 'src']) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
await build({ absWorkingDir: root, entryPoints: ['src/cloud/auth-entry.js'], bundle: true, minify: true, format: 'esm', target: ['es2022'],
  outfile: path.join(output, 'assets/cloud-auth.js'), legalComments: 'none', sourcemap: false });

async function walkFiles(dir, ext) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

async function minifyDir(files, loader) {
  let before = 0, after = 0;
  await Promise.all(files.map(async (file) => {
    const raw = await readFile(file, 'utf8');
    before += Buffer.byteLength(raw, 'utf8');
    const res = await transform(raw, { loader, minify: true, target: 'es2022', legalComments: 'none' });
    after += Buffer.byteLength(res.code, 'utf8');
    await writeFile(file, res.code);
  }));
  return { count: files.length, before, after };
}

const chunkStats = await minifyDir(await walkFiles(path.join(output, 'assets', 'chunks'), '.js'), 'js');
const srcStats = await minifyDir(await walkFiles(path.join(output, 'src'), '.js'), 'js');
const cssFiles = [
  ...(await walkFiles(path.join(output, 'styles'), '.css')),
  path.join(output, 'assets', 'responsive-patch.css')
];
const cssStats = await minifyDir(cssFiles, 'css');

// Public deliverable must not contain privileged code, configs, tests or env files.
for (const forbidden of ['server', 'netlify', '.env', '.git', 'node_modules', 'config', 'tests']) {
  if (await stat(path.join(output, forbidden)).catch(() => null)) throw new Error('Unsafe public build: ' + forbidden);
}
const bundled = await readFile(path.join(output, 'assets/cloud-auth.js'), 'utf8');
if (/FIREBASE_SERVICE_ACCOUNT_JSON|BEGIN PRIVATE KEY|firebase-admin/.test(bundled)) throw new Error('Server credential material in client bundle.');
const revision = await publicCacheVersion(output);
const workerPath = path.join(output, 'service-worker.js');
const worker = await readFile(workerPath, 'utf8');
await writeFile(workerPath, worker.replace(/(CACHE_NAME="[^"]+)"/, '$1-' + revision + '"'));
console.log('Minified dist: chunks ' + Math.round(chunkStats.before / 1024) + '->' + Math.round(chunkStats.after / 1024) + ' KiB, src ' +
  Math.round(srcStats.before / 1024) + '->' + Math.round(srcStats.after / 1024) + ' KiB, css ' +
  Math.round(cssStats.before / 1024) + '->' + Math.round(cssStats.after / 1024) + ' KiB.');
console.log('Offline shell content revision: ' + revision);
console.log('Production site built safely in dist/; Firebase Auth bundle ' + Math.round(Buffer.byteLength(bundled) / 1024) + ' KiB.');
