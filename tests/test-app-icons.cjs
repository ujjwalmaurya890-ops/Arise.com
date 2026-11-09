'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="host"></div>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(__dirname, '../src/app-icons.js'), 'utf8'));
const icons = dom.window.AriseIcons;
for (const name of ['headphones', 'refresh', 'insights', 'target', 'focus', 'flame', 'chart', 'water', 'settings', 'thermometer', 'clock', 'play', 'clipboard', 'moon', 'trendingDown', 'folders', 'scale', 'check', 'battery', 'radar', 'trophy', 'medal', 'people', 'pencil', 'trash', 'book', 'puzzle', 'star', 'graduation', 'code', 'rocket', 'bolt', 'calendar', 'sun', 'shield', 'leaf', 'map', 'brain', 'message', 'warning', 'snow', 'cloud', 'folder', 'download', 'lock', 'tree', 'crown', 'hammer', 'microphone', 'calculator', 'upload', 'pin', 'keyboard', 'info', 'user', 'palette', 'chevron', 'video', 'home', 'briefcase', 'card', 'globe', 'sidebar', 'activity', 'pause', 'dot']) {
  const host = dom.window.document.getElementById('host');
  host.innerHTML = icons.svg(name);
  const svg = host.querySelector('svg');
  assert.ok(svg);
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.getAttribute('stroke-width'), '2');
}
assert.equal(icons.svg('<img onerror=alert(1)>'), '');
assert.equal(icons.svg('toString'), '');
dom.window.close();
console.log('Application icon tests passed.');
