// Test runner shim: package.json declares "type":"module". ESM test files run
// directly; CommonJS test files (require/jsdom) get copied to a temp .cjs twin
// so require()/__dirname work. Usage:
//   node _run-test.cjs test-foo.js [more-test-files...]
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let failed = false;
for (const src of process.argv.slice(2)) {
  const abs = path.resolve(__dirname, src);
  const code = fs.readFileSync(abs, "utf8");
  const isCjs = /\brequire\s*\(/.test(code) && !/^\s*import\s/m.test(code);
  console.log("\n=== running " + src + (isCjs ? " (cjs shim)" : " (esm)") + " ===");
  let r;
  let tmp = null;
  if (isCjs) {
    tmp = path.join(__dirname, path.basename(src).replace(/\.js$/, "") + ".cjs");
    fs.copyFileSync(abs, tmp);
    r = spawnSync(process.execPath, [tmp], { stdio: "inherit", cwd: __dirname });
  } else {
    r = spawnSync(process.execPath, [abs], { stdio: "inherit", cwd: __dirname });
  }
  if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch {} }
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
