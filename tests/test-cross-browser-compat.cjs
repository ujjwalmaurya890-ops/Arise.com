/* v229 cross-browser static checks. These are source-level guards for fixes made in the
   cross-browser pass; they do NOT replace real-browser testing (see UPGRADE-README.md). */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL: ' + m); } };
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'chunks' || e.name === 'netlify' || e.name === 'upgrade') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|css)$/.test(e.name) && !/^test-|^_/.test(e.name) && e.name !== 'app-bundle.js' && e.name !== 'app-styles.css') out.push(p);
  }
  return out;
}
const files = walk(root, []);

// 1. Every non-"none" backdrop-filter has a -webkit- twin (Safari < 18 only honours the prefixed property).
let unpaired = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /(^|[^-\w])backdrop-filter\s*:\s*([^;}"'`]+)/g; let m;
  while ((m = re.exec(s))) {
    const val = m[2].trim();
    if (/^none\b/.test(val)) continue;
    // the prefixed twin may sit just before or just after the unprefixed declaration, in the same rule
    const near = s.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120);
    if (!/-webkit-backdrop-filter\s*:/.test(near)) unpaired.push(path.relative(root, f) + ' -> ' + val);
  }
}
ok(unpaired.length === 0, 'backdrop-filter without -webkit- twin: ' + unpaired.join(' | '));

// 2. No object URL is revoked in the same tick as the download click.
let early = [];
for (const f of files.filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /\.click\(\)\s*,\s*(?:document\.body\.removeChild\([^)]*\)\s*,\s*)?URL\.revokeObjectURL/g;
  if (re.test(s)) early.push(path.relative(root, f));
}
ok(early.length === 0, 'revokeObjectURL right after click(): ' + early.join(', '));
ok(!/setTimeout\([^)]*URL\.revokeObjectURL[^)]*\)\s*,\s*0\s*\)/.test(read('src/cgpa-tracker-widget.js')), 'cgpa export revokes with 0ms delay');

// 3. localStorage reads inside catch-fallbacks are themselves guarded.
ok(!/catch\s*(\(\w+\))?\s*\{\s*var \w+\s*=\s*Number\(localStorage\.getItem/.test(read('src/battle-plan-widget.js')), 'battle-plan fallback read unguarded');
ok(!/catch\s*(\(\w+\))?\s*\{\s*var \w+\s*=\s*Number\(localStorage\.getItem/.test(read('src/readiness-50lpa-widget.js')), 'readiness-50lpa fallback read unguarded');
ok(!/catch\s*(\(\w+\))?\s*\{\s*var \w+\s*=\s*Number\(localStorage\.getItem/.test(read('src/readiness-path-planner-widget.js')), 'path-planner fallback read unguarded');
ok(!/\|\|\(e=de\(e\)\)/.test(read('src/hackathon-expense-tracker-widget.js').replace(/\(function\(\)\{try\{return localStorage\.getItem\(H\)\}catch\{return null\}\}\)\(\)\|\|\(e=de\(e\)\)/, '')), 'hackathon-expense load read unguarded');

// 4. widget-nav active pill keeps a plain fallback before each color-mix() declaration.
const wn = read('styles/widget-nav.css');
const active = wn.slice(wn.indexOf('.wnav-pill-active {'), wn.indexOf('/* ── Icon slot'));
ok(/border-color:\s*var\(--primary\);[\s\S]*border-color:\s*color-mix/.test(active), 'wnav-pill-active border-color fallback missing');
ok(/background:\s*var\(--surface-active[^;]*;[\s\S]*background:\s*color-mix/.test(active), 'wnav-pill-active background fallback missing');

// 5. chunks are in sync with the SW cache list (the SW lifecycle itself is untouched here).
const sw = read('service-worker.js'), idx = read('index.html');
const chunkRefs = (idx.match(/assets\/chunks\/w\d+\.[0-9a-f]{8}\.js/g) || []).filter((v, i, a) => a.indexOf(v) === i);
ok(chunkRefs.length === 12 && chunkRefs.every((c) => sw.includes(c) && fs.existsSync(path.join(root, c))), 'chunk refs / SW list / files out of sync');
ok((sw.match(/skipWaiting\(\)/g) || []).length === 1 && (sw.match(/clients\.claim\(\)/g) || []).length === 1, 'service-worker lifecycle calls changed');

console.log('cross-browser compat: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
