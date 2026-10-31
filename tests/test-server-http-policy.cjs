'use strict';
const assert = require('node:assert/strict');
const {
  API_SECURITY_HEADERS,
  DEPLOYMENT_SECURITY_HEADERS,
  cacheControlFor,
  mergeHeaders
} = require('../server/http-policy.cjs');

const policies = [
  ['/', 'no-cache, no-store, must-revalidate'],
  ['/index.html', 'no-cache, no-store, must-revalidate'],
  ['/404.html', 'no-store'],
  ['/manifest.webmanifest', 'no-cache, must-revalidate'],
  ['/assets/interview_sheets_data.json', 'public, max-age=60, must-revalidate'],
  ['/service-worker.js', 'no-cache, no-store, must-revalidate'],
  ['/assets/cloud-auth.js', 'no-cache, must-revalidate'],
  ['/assets/cloud-auth.js?build=2', 'no-cache, must-revalidate'],
  ['/assets/app-bundle.js', 'public, max-age=60, must-revalidate'],
  ['/assets/app-styles.css', 'public, max-age=60, must-revalidate'],
  ['/assets/responsive-patch.css', 'public, max-age=60, must-revalidate'],
  ['/src/cloud/auth-entry.js', 'public, max-age=60, must-revalidate'],
  ['/styles/theme.css', 'public, max-age=60, must-revalidate'],
  ['/assets/chunks/w01.16217cc5.js', 'public, max-age=31536000, immutable'],
  ['/assets/fonts/inter-latin-wght-normal.woff2', 'public, max-age=31536000, immutable'],
  ['/assets/sounds/rain.mp3', 'public, max-age=31536000, immutable'],
  ['/assets/arise-logo.svg', 'public, max-age=31536000, stale-while-revalidate=86400']
];
for (const [path, expected] of policies) assert.equal(cacheControlFor(path), expected, path);

assert.deepEqual(DEPLOYMENT_SECURITY_HEADERS, {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "base-uri 'self'"
});
assert.equal(API_SECURITY_HEADERS['Cache-Control'], 'no-store, private');

const merged = mergeHeaders(API_SECURITY_HEADERS, {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer'
});
const header = name => Object.entries(merged).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
assert.equal(header('content-type'), 'application/json; charset=utf-8');
assert.equal(header('referrer-policy'), 'no-referrer');
assert.equal(header('cache-control'), 'no-store, private');
assert.equal(header('x-content-type-options'), 'nosniff');
assert.equal(header('content-security-policy'), "base-uri 'self'");
assert.equal(Object.keys(merged).filter(key => key.toLowerCase() === 'content-type').length, 1);

console.log(`HTTP policy: ${policies.length} cache cases and deployment/API security headers passed.`);

const fs = require('node:fs');
const path = require('node:path');
const redirects = fs.readFileSync(path.resolve(__dirname, '../_redirects'), 'utf8');
for (const dir of ['assets', 'src', 'styles']) {
  assert.ok(redirects.indexOf('/' + dir + '/* /404.html 404') < redirects.indexOf('/* /index.html 200'));
}
