'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', reject);
  });
}

function waitForListen(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Local server did not start: ' + output)), 5000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('serving ')) { clearTimeout(timeout); resolve(); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { child.__stderr = (child.__stderr || '') + chunk; });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Local server exited before listen (' + code + '): ' + output)); });
  });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arise-serve-error-test-'));
  const port = await reservePort();
  const script = path.resolve(__dirname, '../scripts/serve.mjs');
  const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForListen(child);

    const malformed = await request(port, '/%E0%A4%A');
    assert.equal(malformed.status, 400, 'malformed percent-encoded URI is a client error, not a missing resource');
    assert.equal(malformed.headers['cache-control'], 'no-store');
    assert.equal(malformed.headers['x-content-type-options'], 'nosniff');
    assert.match(malformed.body, /^Bad request\./);
    assert.doesNotMatch(malformed.body, /URIError|stack|arise-serve-error-test/);

    // An absent build root is an internal server/setup failure, not a 404.
    const missingBuild = await request(port, '/');
    assert.equal(missingBuild.status, 500);
    assert.equal(missingBuild.headers['cache-control'], 'no-store');
    assert.equal(missingBuild.headers['x-content-type-options'], 'nosniff');
    assert.match(missingBuild.body, /^Internal server error\./);
    assert.doesNotMatch(missingBuild.body, /ENOENT|stack|arise-serve-error-test/);
    assert.match(child.__stderr || '', /\[serve\] request failed:/, 'internal failure is logged for the developer');

    console.log('Local server errors: malformed URI -> 400; missing build -> logged 500 without diagnostic leakage.');
  } finally {
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
