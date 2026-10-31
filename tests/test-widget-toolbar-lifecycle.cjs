'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<main id="arise-main"><header><h1>Dashboard</h1></header><div class="flex-1"><section id="upp-data-health-card"><h2>Storage health</h2></section><div id="route"><div class="space-y-6"><article><h2>First widget</h2></article><article><h2>Second widget</h2></article><article><h2>Third widget</h2></article></div></div></div></main>', { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
try {
  w.eval(fs.readFileSync(path.resolve(__dirname, '../src/saas-widget-enhancer.js'), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(w.document.querySelectorAll('.arise-pwb-chip').length, 3, 'a supplemental health panel is not the route container');
  const route = w.document.getElementById('route');
  route.innerHTML = '<div data-arise-route-loading>Loading Analytics</div>';
  w.dispatchEvent(new w.Event('arise:widgets-ready'));
  const bar = w.document.getElementById('arise-page-widget-bar');
  assert.ok(bar); assert.equal(bar.style.visibility, 'hidden'); assert.equal(bar.inert, true);
  route.innerHTML = '<div class="arise-route-state"><div><article><h2>Chart one</h2></article><article><h2>Chart two</h2></article><article><h2>Chart three</h2></article></div></div>';
  w.dispatchEvent(new w.Event('arise:widgets-ready'));
  assert.equal(w.document.getElementById('arise-page-widget-bar'), bar, 'same toolbar survives pending-to-ready transition');
  assert.equal(bar.style.visibility, ''); assert.equal(bar.inert, false);
  assert.equal(w.document.querySelectorAll('.arise-pwb-chip').length, 3, 'transparent error-boundary wrapper is skipped');
  console.log('Widget toolbar lifecycle: supplemental panels, loading reservation and Analytics wrapper discovery passed.');
} finally { w.close(); }
