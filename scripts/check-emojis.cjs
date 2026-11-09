#!/usr/bin/env node
'use strict';
// Audit shipped, application-owned text. Generated widget chunks are derived
// from src and deliberately excluded; the checked-in app bundle is included
// because its original React source is not present in this repository.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const roots = ['index.html', '404.html', 'manifest.webmanifest', 'service-worker.js', 'src', 'styles', 'assets', 'server', 'netlify/functions', 'upgrade'];
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs', '.html', '.css', '.json', '.svg', '.webmanifest']);
const excluded = new Set(['assets/chunks']);
// Unicode emoji sequence data comes from the development-only emoji-regex
// package. Text-default single characters are ambiguous: keep ordinary
// symbols such as copyright and arrows, while recognizing common UI icons.
const emojiRegex = require('emoji-regex').default;
const standaloneIndicator = /^(?:\p{Emoji_Presentation}|[\u23F1\u23F3\u26A0\u270F\u23F8\u25B6])$/u;
const regionalIndicator = /\p{Regional_Indicator}/gu;
const shortcode = /:(?:smile|smiley|grinning|joy|heart|thumbsup|thumbs_up|rocket|fire|tada|warning|white_check_mark|x|sparkles|star|trophy|bulb|memo|calendar|lock|eyes):/gi;
function decode(line, ext) {
  // Decode source encodings only for detection, never modify application text.
  return line.replace(/\\u\{([\da-fA-F]{1,6})\}|\\u([\da-fA-F]{4})|&#(?:x([\da-fA-F]+)|(\d+));?/g, (all, a, b, c, d) => {
    const value = parseInt(a || b || c || d, d ? 10 : 16);
    return value <= 0x10ffff ? String.fromCodePoint(value) : all;
  }).replace(ext === '.css' ? /\\([\da-fA-F]{1,6})(?:\s)?/g : /$^/g, (all, hex) => {
    const value = parseInt(hex, 16);
    return value <= 0x10ffff ? String.fromCodePoint(value) : all;
  });
}
function find(line, ext = '') {
  const text = decode(line, ext);
  const matches = [...text.matchAll(emojiRegex())].filter(m => [...m[0]].length > 1 || standaloneIndicator.test(m[0]));
  // A lone regional indicator is not an RGI flag, but is still an emoji
  // placeholder. Avoid double-counting indicators already in a flag match.
  for (const m of text.matchAll(regionalIndicator)) {
    if (!matches.some(hit => m.index >= hit.index && m.index < hit.index + hit[0].length)) matches.push(m);
  }
  return [...matches, ...text.matchAll(shortcode)].map(m => m[0]);
}
function filesAt(relative) {
  if (excluded.has(relative)) return [];
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return [];
  const info = fs.statSync(full);
  if (info.isDirectory()) return fs.readdirSync(full).sort().flatMap(name => filesAt(path.posix.join(relative, name)));
  return extensions.has(path.extname(relative)) ? [relative] : [];
}
function run() {
  let count = 0, affected = 0;
  for (const file of roots.flatMap(filesAt)) {
    let fileCount = 0;
    fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).forEach((line, index) => {
      const matches = find(line, path.extname(file));
      if (!matches.length) return;
      count += matches.length; fileCount += matches.length;
      if (!process.argv.includes('--summary')) console.log(`${file}:${index + 1}: ${matches.map(m => JSON.stringify(m)).join(' ')}`);
    });
    if (fileCount) { affected++; if (process.argv.includes('--summary')) console.log(`${file}: ${fileCount}`); }
  }
  console.log(`Emoji audit: ${count} matches in ${affected} files.`);
  if (count) process.exitCode = 1;
}
if (require.main === module) run();
module.exports = { find, decode };
