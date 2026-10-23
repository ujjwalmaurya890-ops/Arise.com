// Test runner shim: package.json declares "type":"module". ESM tests run directly;
// CommonJS tests are copied beside the test source so require() and __dirname work.
// Usage: node scripts/_run-test.cjs [--all | tests/test-foo.js ...]
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const testsRoot = path.join(root, "tests");
let sources = process.argv.slice(2);
if (sources[0] === "--all") {
  sources = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/^test-.*\.(?:js|cjs)$/.test(e.name)) sources.push(path.relative(root, full));
    }
  };
  walk(testsRoot);
  sources.sort();
}
let failed = false;
for (const src of sources) {
  const abs = path.resolve(root, src.startsWith("tests/") ? src : path.join("tests", src));
  const code = fs.readFileSync(abs, "utf8");
  const isCjs = /\brequire\s*\(/.test(code) && !/^\s*import\s/m.test(code);
  console.log("\n=== running " + path.relative(root, abs) + (isCjs ? " (cjs shim)" : " (esm)") + " ===");
  let result, tmp = null;
  if (isCjs) {
    tmp = path.join(path.dirname(abs), path.basename(abs).replace(/\.(?:js|cjs)$/, "") + ".runner.cjs");
    fs.copyFileSync(abs, tmp);
    result = spawnSync(process.execPath, [tmp], { stdio: "inherit", cwd: root });
  } else {
    result = spawnSync(process.execPath, [abs], { stdio: "inherit", cwd: root });
  }
  if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch {} }
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
