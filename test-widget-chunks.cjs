/* v225: guards the generated widget chunks (run `node tools/build-widget-chunks.cjs` after editing any widget script). */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
const scripts = [...idx.match(/var SCRIPTS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
const chunks = JSON.parse(idx.match(/var CHUNKS = (\[[\s\S]*?\]);/)[1]);
const map = JSON.parse(idx.match(/var CHUNK_FILES = (\{[\s\S]*?\});\s*\/\*CHUNKS:END/)[1]);
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
/* isolation: a throwing widget must not stop the next one */
const g = {}; g.window = g; g.setTimeout = f => { try { f(); } catch (e) { g.__rethrown = (g.__rethrown || 0) + 1; } };
const demo = 'try{\nthrow new Error("boom")\n}catch(__arise_e){setTimeout(function(){throw __arise_e})}\ntry{\nwindow.__second=1\n}catch(__arise_e){setTimeout(function(){throw __arise_e})}';
vm.createContext(g); vm.runInContext(demo, g);
ok(g.__second === 1 && g.__rethrown === 1, 'a throwing widget is re-thrown (still reported) and the next widget still runs');
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
