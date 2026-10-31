'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/cloud/storage-bridge.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'src/widget-shared-utils.js'), 'utf8');

assert.match(html, /<img src="\.\/assets\/arise-logo\.svg" alt="" width="36" height="36" decoding="async" fetchpriority="high"/);
assert.match(html, /prefers-reduced-motion: reduce/);
assert.match(html, /classList\.add\("reduce-motion"\)/);
assert.match(html, /arise-skip-link:focus,\.arise-skip-link:focus-visible/);
assert.match(bridge, /CustomEvent\('arise:storage-quota'/);
assert.match(utils, /addEventListener\("arise:storage-quota"/);
assert.doesNotMatch(bridge, /FIREBASE_SERVICE_ACCOUNT|BEGIN PRIVATE KEY/);
console.log('optimization-pass: LCP image dimensions, reduced-motion class, quota event, skip-link focus');
