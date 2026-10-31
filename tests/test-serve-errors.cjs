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

function request(port, requestPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath, headers, method }, response => {
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

    fs.mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist/index.html'), '<!doctype html><title>Fixture shell</title>');
    fs.writeFileSync(path.join(root, 'dist/assets/audio.mp3'), '0123456789');
    fs.writeFileSync(path.join(root, 'dist/assets/code.js'), '// compression fixture\n'.repeat(100));
    const missing = await request(port, '/assets/missing.js');
    assert.equal(missing.status, 404, 'missing assets must not become a successful HTML response');
    assert.equal(missing.headers['cache-control'], 'no-store');
    assert.equal((await request(port, '/notes')).status, 200, 'extensionless SPA navigation is preserved');
    for (const [range, status, body, contentRange] of [
      ['bytes=0-3', 206, '0123', 'bytes 0-3/10'],
      ['bytes=7-', 206, '789', 'bytes 7-9/10'],
      ['bytes=-3', 206, '789', 'bytes 7-9/10'],
      ['bytes=-20', 206, '0123456789', 'bytes 0-9/10'],
      ['bytes=7-99', 206, '789', 'bytes 7-9/10'],
      ['bytes=99-', 416, '', 'bytes */10'],
      ['bytes=5-2', 416, '', 'bytes */10'],
      ['bytes=-0', 416, '', 'bytes */10'],
      ['bytes=oops', 416, '', 'bytes */10']
    ]) {
      const response = await request(port, '/assets/audio.mp3', { Range: range });
      assert.equal(response.status, status, range);
      assert.equal(response.body, body, range);
      assert.equal(response.headers['content-range'], contentRange, range);
      assert.equal(Number(response.headers['content-length']), Buffer.byteLength(body), range);
    }
    const head = await request(port, '/assets/audio.mp3', {}, 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(head.headers['content-length'], '10');
    const identity = await request(port, '/assets/code.js', { 'Accept-Encoding': 'br;q=0, gzip;q=0' });
    assert.equal(identity.headers['content-encoding'], undefined, 'q=0 explicitly rejects compression');
    const gzip = await request(port, '/assets/code.js', { 'Accept-Encoding': 'br;q=0, gzip;q=1' });
    assert.equal(gzip.headers['content-encoding'], 'gzip');
    const notModified = await request(port, '/assets/code.js', { 'If-None-Match': identity.headers.etag });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.headers.vary, 'Accept-Encoding');
    console.log('Local server: safe 400/500/404, SPA fallback, valid/invalid/suffix audio ranges, HEAD, encoding q-values and 304 Vary passed.');
  } finally {
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
