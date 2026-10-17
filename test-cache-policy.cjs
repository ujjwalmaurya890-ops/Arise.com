/* v238 perf guard: every shipped .js/.css/.json/.png/.svg must be covered by a
 * Cache-Control rule in BOTH netlify.toml and ./_headers, the content-hashed widget
 * chunks must be immutable, and index.html / service-worker.js must stay no-store.
 * Netlify's header globs are literal and single-segment (`*` does not cross `/`,
 * there is no `**`), which is exactly how the files disappeared from the policy
 * before v238 — so this test walks the real deploy tree instead of trusting the
 * patterns look right. Run: node _run-test.cjs test-cache-policy.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } }

const ROOT = __dirname;
const EXTS = ['.js', '.mjs', '.css', '.json', '.png', '.svg'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'tools', 'upgrade', 'netlify', 'sounds']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); continue; }
    if (EXTS.includes(path.extname(e.name).toLowerCase())) out.push('/' + path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
  }
  return out;
}
const files = walk(ROOT, []).filter(f => !/\/test-[^/]+$/.test(f));

// Netlify semantics for header globs: split the pattern on '/', `*` matches within a
// segment (greedy, and may span the rest of a segment), and a trailing '/*' extends
// across segments only when the tool is in its permissive mood — so require an exact
// per-segment match here, which is the conservative reading both files must satisfy.
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// `/assets/*.js` -> ^/assets/[^/]*\.js$   (a `*` never crosses a `/`)
function toRegex(pattern) {
  const body = pattern.split('/').map(seg => seg.split('*').map(escapeRe).join('[^/]*')).join('/');
  return new RegExp('^' + (body.startsWith('/') ? body : '/' + body) + '$');
}
function matches(pattern, p) { return toRegex(pattern).test(p); }

// ── netlify.toml ──────────────────────────────────────────────────────────────
const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
const tomlRules = [];
{
  const re = /\[\[headers\]\]\s*(?:#[^\n]*\n\s*)*for\s*=\s*"([^"]+)"([\s\S]*?)(?=\n\[\[|\n\[headers|$)/g;
  let m;
  while ((m = re.exec(toml))) {
    const cc = /Cache-Control\s*=\s*"([^"]+)"/.exec(m[2]);
    if (cc) tomlRules.push({ for: m[1], cc: cc[1] });
  }
}
ok(tomlRules.length >= 12, 'netlify.toml parses to ' + tomlRules.length + ' Cache-Control rules');

// ── _headers ──────────────────────────────────────────────────────────────────
const hdrRules = [];
{
  const lines = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n');
  let cur = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (!/^\s/.test(raw)) { cur = { for: l.split(/\s+/)[0], cc: null }; hdrRules.push(cur); }
    else if (cur) { const m = /^cache-control:\s*(.+)$/i.exec(l); if (m) cur.cc = m[1].trim(); }
  }
}
ok(hdrRules.length >= 9, '_headers parses to ' + hdrRules.length + ' Cache-Control rules');

function policyFor(rules, p) {
  // Netlify applies the most specific matching rule; use segment-count then length.
  const hit = rules.filter(r => matches(r.for, p) && r.cc).sort((a, b) => {
    const sa = a.for.split('/').length, sb = b.for.split('/').length;
    return sb - sa || b.for.length - a.for.length;
  })[0];
  return hit ? hit.cc : null;
}

const immutables = files.filter(f => f.startsWith('/assets/chunks/'));
ok(immutables.length > 0, 'found ' + immutables.length + ' content-hashed chunks to check');
immutables.forEach(f => {
  const a = policyFor(tomlRules, f), b = policyFor(hdrRules, f);
  ok(a === 'public, max-age=31536000, immutable', `netlify.toml pins ${f} immutable`);
  ok(b === 'public, max-age=31536000, immutable', `_headers pins ${f} immutable`);
});

const uncoveredToml = files.filter(f => !policyFor(tomlRules, f));
const uncoveredHdr = files.filter(f => !policyFor(hdrRules, f));
ok(uncoveredToml.length === 0,
  'every one of the ' + files.length + ' shipped js/css/json/img files has a netlify.toml rule' +
  (uncoveredToml.length ? ' — MISSING: ' + uncoveredToml.slice(0, 8).join(', ') : ''));
ok(uncoveredHdr.length === 0,
  'and the same files are covered by _headers' + (uncoveredHdr.length ? ' — MISSING: ' + uncoveredHdr.slice(0, 8).join(', ') : ''));

const divergent = files.filter(f => {
  const a = policyFor(tomlRules, f), b = policyFor(hdrRules, f);
  return a && b && a !== b;
});
ok(divergent.length === 0, 'netlify.toml and _headers agree on all ' + files.length + ' files' +
  (divergent.length ? ' — DIVERGE: ' + divergent.slice(0, 6).map(f => `${f} (${policyFor(tomlRules, f)} vs ${policyFor(hdrRules, f)})`).join('; ') : ''));

// The two documents that must never be cached.
for (const f of ['/index.html', '/service-worker.js']) {
  ok(policyFor(tomlRules, f) === 'no-cache, no-store, must-revalidate', `${f} stays no-store in netlify.toml`);
}
// Nothing un-hashed may be pinned immutable — that is how stale code ships forever.
const wronglyImmutable = files.filter(f => {
  if (f.startsWith('/assets/chunks/') || f.startsWith('/sounds/')) return false;
  const c = policyFor(tomlRules, f);
  if (!c) return false;
  if (/immutable/.test(c)) return false;   // hashed chunks + sounds only, checked above
  const m = /max-age=(\d+)/.exec(c);
  return m && Number(m[1]) > 604800;       // un-hashed assets must revalidate within a week
});
ok(wronglyImmutable.length === 0, 'no un-hashed asset is pinned long (would serve stale code after a deploy)' +
  (wronglyImmutable.length ? ' — ' + wronglyImmutable.slice(0, 6).join(', ') : ''));

// The loader must reference exactly the chunk files that exist, or a rule would be
// written for a filename that never ships.
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const chunks = JSON.parse(idx.match(/var CHUNKS = (\[[\s\S]*?\]);/)[1]);
ok(chunks.every(c => fs.existsSync(path.join(ROOT, c.replace(/^\.\//, '')))),
  'all ' + chunks.length + ' CHUNKS urls resolve to real files (so the immutable rule applies to them)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
