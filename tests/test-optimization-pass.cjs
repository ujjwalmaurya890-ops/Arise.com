'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/cloud/storage-bridge.js'), 'utf8');
const utils = fs.readFileSync(path.join(root, 'src/widget-shared-utils.js'), 'utf8');

assert.match(html, /<div class="cloud-brand"><span class="arise-brand-mark" aria-hidden="true">A<\/span><span>Arise<\/span><\/div>/);
assert.doesNotMatch(html, /<img\b/, 'the gate chrome renders a text brand mark, not an image');
assert.match(html, /prefers-reduced-motion: reduce/);
assert.match(html, /classList\.add\("reduce-motion"\)/);
assert.match(html, /arise-skip-link:focus,\.arise-skip-link:focus-visible/);
assert.match(bridge, /CustomEvent\('arise:storage-quota'/);
assert.match(utils, /addEventListener\("arise:storage-quota"/);
assert.doesNotMatch(bridge, /FIREBASE_SERVICE_ACCOUNT|BEGIN PRIVATE KEY/);
console.log('optimization-pass: text brand mark, reduced-motion class, quota event, skip-link focus');
