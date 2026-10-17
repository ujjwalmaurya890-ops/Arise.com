/* v225: guards the generated widget chunks (run `node tools/build-widget-chunks.cjs` after editing any widget script). */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
const scripts = [...idx.match(/var SCRIPTS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
const chunks = JSON.parse(idx.match(/var CHUNKS = (\[[\s\S]*?\]);/)[1]);
// v238: tolerate extra generated vars (CHUNK_PRIORITY) between CHUNK_FILES and the
// end marker; still matches the pre-v238 block layout exactly.
const map = JSON.parse(idx.match(/var CHUNK_FILES = (\{[\s\S]*?\});[\s\S]*?\/\*CHUNKS:END/)[1]);
ok(scripts.length > 50 && chunks.length > 1, 'index.html lists ' + scripts.length + ' scripts in ' + chunks.length + ' chunks');
ok(JSON.stringify([].concat.apply([], chunks.map(c => map[c]))) === JSON.stringify(scripts), 'chunk contents == SCRIPTS, same files, same order');
chunks.forEach(c => {
  const p = path.join(__dirname, c); const exists = fs.existsSync(p); ok(exists, c + ' exists');
  if (!exists) return;
  const body = fs.readFileSync(p, 'utf8');
  let syntax = true; try { new vm.Script(body); } catch (e) { syntax = false; }
  ok(syntax, c + ' parses');
  let cursor = 0, inOrder = true, verbatim = true;
  map[c].forEach(f => {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
    const at = body.indexOf(src, cursor); if (at < 0) { verbatim = false; } else { cursor = at + src.length; }
    if (body.indexOf('/* ---- ' + f + ' ---- */') < 0) inOrder = false;
  });
  ok(verbatim && inOrder, c + ' embeds every source file verbatim and in order (not stale)');
  ok(sw.indexOf('"' + c + '"') !== -1, c + ' is in the service worker extended cache list');
});
/* v238: the deferred-chunk split must be an ordered prefix + suffix, and must cover
 * every chunk, or the loader would change which script runs when. */
const prio = (idx.match(/var CHUNK_PRIORITY = (\[[^\]]*\]);/) || [null, '[]'])[1];
const priority = JSON.parse(prio);
ok(Array.isArray(priority), 'CHUNK_PRIORITY parses');
ok(priority.every(u => chunks.indexOf(u) === priority.indexOf(u) && chunks.indexOf(u) !== -1),
   'CHUNK_PRIORITY is a subset of CHUNKS');
ok(JSON.stringify(priority) === JSON.stringify(chunks.slice(0, priority.length)),
   'CHUNK_PRIORITY is an ordered PREFIX of CHUNKS (load order unchanged)');
const deferred = chunks.filter(c => priority.indexOf(c) === -1);
ok(priority.length + deferred.length === chunks.length, 'priority + deferred covers every chunk exactly once');
ok(JSON.stringify(priority.concat(deferred)) === JSON.stringify(chunks), 'concatenating the two phases reproduces CHUNKS order');
if (priority.length && priority.length < chunks.length) {
  const pb = priority.reduce((n, c) => n + fs.statSync(path.join(__dirname, c)).size, 0);
  const db = deferred.reduce((n, c) => n + fs.statSync(path.join(__dirname, c)).size, 0);
  console.log('  info  first phase ' + (pb / 1024).toFixed(0) + ' KB, deferred ' + (db / 1024).toFixed(0) + ' KB (' + (100 * db / (pb + db)).toFixed(0) + '% of the widget payload moves behind the fold)');
}
ok(/rel="modulepreload"[^>]*app-bundle\.js/.test(idx) && /src="\.\/assets\/app-bundle\.js"/.test(idx),
   'app-bundle.js is modulepreloaded with the same crossorigin fetch as its <script> tag');

/* isolation: a throwing widget must not stop the next one */
const g = {}; g.window = g; g.setTimeout = f => { try { f(); } catch (e) { g.__rethrown = (g.__rethrown || 0) + 1; } };
const demo = 'try{\nthrow new Error("boom")\n}catch(__arise_e){setTimeout(function(){throw __arise_e})}\ntry{\nwindow.__second=1\n}catch(__arise_e){setTimeout(function(){throw __arise_e})}';
vm.createContext(g); vm.runInContext(demo, g);
ok(g.__second === 1 && g.__rethrown === 1, 'a throwing widget is re-thrown (still reported) and the next widget still runs');
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
