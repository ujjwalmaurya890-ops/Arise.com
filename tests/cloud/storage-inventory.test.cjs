'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('every statically discoverable native/wrapper storage key is supported or explicitly local-only', () => {
  const result = spawnSync(process.execPath, ['scripts/tools/audit-storage.cjs'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Audited \d+ constant keys/);
  assert.ok(!result.stderr.includes('MISSING:'));
});

const schema = require('../../src/cloud/storage-schema.js');
test('new DSA journal and planner stores are included in the cloud/backup allowlist', () => {
  assert.equal(schema.isLocalKey('dsaMistakeJournal-v1'), true);
  assert.equal(schema.isLocalKey('dsaStudyPlanner-v1'), true);
});
