'use strict';
const assert = require('node:assert/strict');
const { find } = require('../scripts/check-emojis.cjs');
const cp = (...points) => String.fromCodePoint(...points);
for (const value of [cp(0x1f680), cp(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb), cp(0x1f1ee, 0x1f1f3), cp(0x31, 0xfe0f, 0x20e3), cp(0x26a0, 0xfe0f), cp(0x23f1), cp(0x00a9, 0xfe0f), cp(0x1f1ee), cp(0x1f3f3, 0xfe0f, 0x200d, 0x1f308), ':rocket:', '\\u{1F680}', '\\uD83D\\uDE80', '&#x1f680;', '\\1f680 ']) {
  assert.ok(find(value, '.css').length, 'detect ' + JSON.stringify(value));
}
for (const value of ['नमस्ते दुनिया', 'é à 中文', '₹ 200 ≥ 5 × 3', '© 2026', '→']) {
  assert.deepEqual(find(value), [], 'preserve ' + value);
}
console.log('Emoji audit detection tests passed.');
