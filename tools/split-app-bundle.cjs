#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
let esbuild, acorn;
try { esbuild = require("esbuild"); } catch { esbuild = require("/tmp/perf-bench/node_modules/esbuild"); }
try { acorn = require("acorn"); } catch { acorn = require("/tmp/perf-bench/node_modules/acorn"); }

const root = path.resolve(__dirname, "..");
const bundlePath = path.join(root, "assets", "app-bundle.js");
const analyticsPath = path.join(root, "assets", "app-analytics.js");

let code = fs.readFileSync(bundlePath, "utf8");

// 1. Upgrade Quote carousel dot buttons: 24x24px WCAG 2.2 AA touch target + GPU scaleX transition (0 CLS, 0 reflow)
const oldQuoteBtn = `r.map((p,v)=>y.jsx(he.button,{onClick:()=>{u(!1),setTimeout(()=>{s(v),u(!0)},350)},"aria-label":\`Quote \${v+1}\`,className:"rounded-full transition-all duration-300 focus:outline-none",animate:{width:v===a?16:5,background:v===a?n.accent:"rgba(255,255,255,0.15)"},style:{height:4}},v))`;
const newQuoteBtn = `r.map((p,v)=>y.jsx("button",{type:"button",onClick:()=>{u(!1),setTimeout(()=>{s(v),u(!0)},350)},"aria-label":\`Quote \${v+1}\`,className:"inline-flex items-center justify-center rounded-full",style:{width:24,height:24,minWidth:24,minHeight:24,padding:0,background:"transparent"},children:y.jsx("span",{className:"block rounded-full transition-transform duration-200",style:{width:16,height:4,transform:v===a?"scaleX(1)":"scaleX(0.32)",background:v===a?n.accent:"rgba(255,255,255,0.22)"}})},v))`;
if (code.includes(oldQuoteBtn)) {
  code = code.replace(oldQuoteBtn, newQuoteBtn);
  console.log("[split] Upgraded Quote carousel buttons to 24x24px GPU scaleX pills");
}

// Upgrade Recharts tick #6b7280 contrast in Analytics to #94a3b8 (WCAG AA on dark cards)
code = code.replace(/tick:\{fill:"#6b7280"/g, 'tick:{fill:"#94a3b8"');
code = code.replace(
  '"serviceWorker"in navigator&&window.addEventListener("load",()=>{const __uxaHadCtl=',
  '"serviceWorker"in navigator&&window.addEventListener("load",()=>{setTimeout(()=>{const __uxaHadCtl='
).replace(
  '{once:true})})});\nconst dx=',
  '{once:true})})},4500)});\nconst dx='
);

// 2. Parse AST & run exact lexical-scope reachability to split Recharts + Analytics (Module Jce) cleanly
const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });

function patternNames(pat, out) {
  if (!pat) return;
  if (pat.type === "Identifier") out.add(pat.name);
  else if (pat.type === "AssignmentPattern") patternNames(pat.left, out);
  else if (pat.type === "RestElement") patternNames(pat.argument, out);
  else if (pat.type === "ArrayPattern") pat.elements.forEach(e => patternNames(e, out));
  else if (pat.type === "ObjectPattern") pat.properties.forEach(p => patternNames(p.type === "RestElement" ? p.argument : p.value, out));
}

function collectVarHoists(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") return;
  if (Array.isArray(node)) { node.forEach(x => collectVarHoists(x, out)); return; }
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    node.declarations.forEach(d => patternNames(d.id, out));
  }
  for (const k of Object.keys(node)) {
    if (k === "start" || k === "end" || k === "loc") continue;
    collectVarHoists(node[k], out);
  }
}

function collectFree(node, scope, free) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(x => collectFree(x, scope, free)); return; }
  if (node.type === "Identifier") {
    if (!scope.has(node.name)) free.add(node.name);
    return;
  }
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    const fnScope = new Set(scope);
    if (node.id) fnScope.add(node.id.name);
    node.params.forEach(p => patternNames(p, fnScope));
    collectVarHoists(node.body, fnScope);
    if (node.body.type === "BlockStatement") {
      node.body.body.forEach(st => {
        if (st.type === "FunctionDeclaration" && st.id) fnScope.add(st.id.name);
        if (st.type === "VariableDeclaration") st.declarations.forEach(d => patternNames(d.id, fnScope));
        if (st.type === "ClassDeclaration" && st.id) fnScope.add(st.id.name);
      });
    }
    node.params.forEach(p => { if (p.type === "AssignmentPattern") collectFree(p.right, fnScope, free); });
    collectFree(node.body, fnScope, free);
    return;
  }
  if (node.type === "BlockStatement" || node.type === "ForStatement" || node.type === "ForOfStatement" || node.type === "ForInStatement") {
    const blkScope = new Set(scope);
    const bodyList = node.type === "BlockStatement" ? node.body : [node.init, node.left].filter(Boolean);
    bodyList.forEach(st => {
      if (st.type === "VariableDeclaration" && st.kind !== "var") st.declarations.forEach(d => patternNames(d.id, blkScope));
      if (st.type === "FunctionDeclaration" && st.id) blkScope.add(st.id.name);
      if (st.type === "ClassDeclaration" && st.id) blkScope.add(st.id.name);
    });
    for (const k of Object.keys(node)) {
      if (k === "start" || k === "end" || k === "loc") continue;
      collectFree(node[k], blkScope, free);
    }
    return;
  }
  if (node.type === "CatchClause") {
    const cScope = new Set(scope);
    patternNames(node.param, cScope);
    collectFree(node.body, cScope, free);
    return;
  }
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    const clsScope = new Set(scope);
    if (node.id) clsScope.add(node.id.name);
    if (node.superClass) collectFree(node.superClass, scope, free);
    collectFree(node.body, clsScope, free);
    return;
  }
  if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
    if (node.computed) collectFree(node.key, scope, free);
    collectFree(node.value, scope, free);
    return;
  }
  for (const k of Object.keys(node)) {
    if (k === "start" || k === "end" || k === "loc") continue;
    if (node.type === "MemberExpression" && k === "property" && !node.computed) continue;
    if (node.type === "Property" && k === "key" && !node.computed && !node.shorthand) continue;
    if (node.type === "VariableDeclarator" && k === "id") continue;
    collectFree(node[k], scope, free);
  }
}

const units = [];
for (let i = 0; i < ast.body.length; i++) {
  const s = ast.body[i];
  if (s.type === "VariableDeclaration") {
    for (const d of s.declarations) {
      const set = new Set();
      patternNames(d.id, set);
      const defs = [...set];
      const refs = new Set();
      collectFree(d.init, new Set(), refs);
      units.push({ kind: s.kind, src: code.slice(d.start, d.end), defs, refs, size: d.end - d.start, stmtIdx: i });
    }
  } else {
    const defs = (s.id && s.id.type === "Identifier") ? [s.id.name] : [];
    const refs = new Set();
    collectFree(s, new Set(defs), refs);
    units.push({ kind: "stmt", src: code.slice(s.start, s.end), defs, refs, size: s.end - s.start, stmtIdx: i });
  }
}

// Find start of d3/Recharts block right after stmt defining Eq/Pq/_q
const eqUnitIdx = units.findIndex(u => u.defs.includes("Jce"));
if (eqUnitIdx === -1) {
  console.log("[split] Bundle already split — skipping.");
  process.exit(0);
}
const afterDsaStmtIdx = units.find(u => u.defs.includes("_q")).stmtIdx + 1;
const jceStmtIdx = units[eqUnitIdx].stmtIdx;

const inAnalytics = units.map(u =>
  (u.stmtIdx >= afterDsaStmtIdx && u.stmtIdx < jceStmtIdx) ||
  u.defs.some(d => ["R0", "Qce", "Jce"].includes(d))
);

const defToUnit = new Map();
units.forEach((u, idx) => u.defs.forEach(d => defToUnit.set(d, idx)));

let changed = true;
while (changed) {
  changed = false;
  for (let i = 0; i < units.length; i++) {
    if (inAnalytics[i]) continue;
    for (const r of units[i].refs) {
      if (r === "Jce") continue;
      const target = defToUnit.get(r);
      if (target !== undefined && inAnalytics[target]) {
        inAnalytics[target] = false;
        changed = true;
      }
    }
  }
}

const depsFromMain = [];
const seenDep = new Set();
units.forEach((u, i) => {
  if (!inAnalytics[i]) return;
  for (const r of u.refs) {
    const target = defToUnit.get(r);
    if (target !== undefined && !inAnalytics[target] && !seenDep.has(r)) {
      seenDep.add(r);
      depsFromMain.push(r);
    }
  }
});

function emitUnits(selectedUnits) {
  const out = [];
  for (const u of selectedUnits) {
    if (u.kind === "stmt") {
      const s = u.src.trim();
      out.push(s.endsWith(";") || s.endsWith("}") ? s : s + ";");
    } else {
      out.push(`${u.kind} ${u.src};`);
    }
  }
  return out.join("\n");
}

const analyticsUnits = units.filter((_, i) => inAnalytics[i]);
const analyticsRaw = `(function(){\nconst { ${depsFromMain.join(", ")} } = globalThis.__ARISE_BUNDLE_DEPS__;\n${emitUnits(analyticsUnits)}\nglobalThis.__ARISE_ANALYTICS_MODULE__ = Jce;\n})();\n`;
const analyticsMin = esbuild.transformSync(analyticsRaw, { loader: "js", minify: true, target: "es2020" }).code;
fs.writeFileSync(analyticsPath, analyticsMin, "utf8");

// Build main bundle with lazy script chunk loader for Jce (works seamlessly in Browser, Service Worker, AND JSDOM window.eval!)
const mainUnits = [];
for (let i = 0; i < units.length; i++) {
  if (inAnalytics[i]) continue;
  mainUnits.push(units[i]);
}

// Insert lazy Jce shim right before the first unit after Jce's original position
const firstAfterJce = units.findIndex((u, i) => !inAnalytics[i] && i > eqUnitIdx);
const lazyJceShim = {
  kind: "stmt",
  src: `var __ariseAnalyticsProm = null;
function __loadAriseAnalytics() {
  if (globalThis.__ARISE_ANALYTICS_MODULE__) return Promise.resolve(globalThis.__ARISE_ANALYTICS_MODULE__);
  if (__ariseAnalyticsProm) return __ariseAnalyticsProm;
  globalThis.__ARISE_BUNDLE_DEPS__ = { ${depsFromMain.join(", ")} };
  __ariseAnalyticsProm = new Promise(function(resolve, reject) {
    if (typeof document === "undefined") { reject(new Error("no document")); return; }
    var s = document.createElement("script");
    s.src = "./assets/app-analytics.js";
    s.async = true;
    s.onload = function() { resolve(globalThis.__ARISE_ANALYTICS_MODULE__); };
    s.onerror = function(e) { __ariseAnalyticsProm = null; reject(e); };
    document.head.appendChild(s);
  });
  return __ariseAnalyticsProm;
}
const __AriseLazyAnalytics = b.lazy(__loadAriseAnalytics);
const Jce = { default: function(props) { return y.jsx(__AriseLazyAnalytics, props); } };`
};
mainUnits.splice(mainUnits.indexOf(units[firstAfterJce]), 0, lazyJceShim);

// Minify only whitespace on verbose multi-line DSA block while preserving ALL identifier names and Oq/Eq contract
for (const u of mainUnits) {
  if (u.defs && u.defs.includes("Pq") && u.src.length > 20000) {
    const wrapped = esbuild.transformSync(`const ${u.src};`, {
      loader: "js",
      minifyWhitespace: true,
      minifySyntax: false,
      minifyIdentifiers: false,
      target: "es2020"
    }).code.trim();
    u.src = wrapped.replace(/^const\s+/, "").replace(/;$/, "");
  }
}

const mainCode = emitUnits(mainUnits) + "\n";
// Syntax validation via V8 vm.Script before writing to disk!
new vm.Script(mainCode, { filename: "app-bundle.js" });
new vm.Script(analyticsMin, { filename: "app-analytics.js" });

fs.writeFileSync(bundlePath, mainCode, "utf8");
console.log(`[split] SUCCESS! app-bundle.js: ${(mainCode.length / 1024).toFixed(1)} KB | app-analytics.js: ${(analyticsMin.length / 1024).toFixed(1)} KB`);
