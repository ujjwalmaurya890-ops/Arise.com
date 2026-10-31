'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '../src/career-intelligence-dashboard.js'), 'utf8');
const key = 'arise-career-intelligence-v1';
function create(raw) {
  const dom = new JSDOM('<!doctype html><main id="arise-main"><div class="flex-1"></div></main>', { url: 'https://example.test/', runScripts: 'outside-only' });
  const w = dom.window, messages = [];
  w.alert = message => messages.push(message); w.confirm = () => true;
  if (raw !== undefined) w.localStorage.setItem(key, raw);
  w.eval(source); w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { dom, w, messages };
}
function select(w, name) { [...w.document.querySelectorAll('.ci-tab')].find(button => button.textContent === name).click(); }
{
  const { w } = create();
  try {
    const first = w.document.querySelector('.ci-tab'); first.focus();
    first.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(w.document.activeElement.dataset.tab, 'Career Roadmap', 'focus must survive tab rerender');
    w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(w.document.activeElement.dataset.tab, 'Settings & Data Management');
    for (const input of w.document.querySelectorAll('[data-settings] input')) assert.ok(input.closest('label') || input.labels?.length, input.name + ' has a persistent visible label');
    w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(w.document.activeElement.dataset.tab, 'Overview');
  } finally { w.close(); }
}
for (const raw of ['{invalid', 'null', '{"items":null,"settings":null}', '{"active":"Weekly Planner","items":{"Weekly Planner":[{"title":"bad","fields":null}]},"settings":{}}']) {
  const { w } = create(raw);
  try {
    assert.ok(w.document.querySelector('#career-intelligence [role="alert"]'), 'corrupt state has a visible recovery explanation');
    assert.ok(w.document.querySelector('[data-recovery-export]'), 'original stored data can be exported');
    assert.equal(w.localStorage.getItem(key), raw, 'reading invalid state never replaces it with empty defaults');
  } finally { w.close(); }
}
{
  const original = { active: 'Overview', items: {}, settings: { role: 'Engineer' } };
  const { w, messages } = create(JSON.stringify(original));
  try {
    select(w, 'Settings & Data Management');
    const before = w.localStorage.getItem(key);
    const input = w.document.querySelector('[data-import]');
    function upload(value, size = 100) {
      w.FileReader = class { readAsText(file) { this.result = JSON.stringify(file.value); this.onload(); } };
      Object.defineProperty(input, 'files', { configurable: true, value: [{ value, size }] });
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
    }
    upload({ items: { 'Weekly Planner': [{ title: 'bad', fields: [{}] }] }, settings: {} });
    assert.equal(w.localStorage.getItem(key), before, 'invalid import is rejected atomically');
    assert.match(messages.at(-1), /rejected/i);
    upload({ items: {}, settings: {} }, 6 * 1024 * 1024);
    assert.equal(w.localStorage.getItem(key), before, 'oversized imports do not touch data');
    upload(JSON.parse('{"items":{},"settings":{"__proto__":{"role":"untrusted"}}}'));
    assert.equal(w.localStorage.getItem(key), before, 'prototype-setting keys are rejected atomically');
    assert.match(messages.at(-1), /rejected/i, 'dangerous keys cannot be reported as successfully imported');
    const valid = { items: { 'Weekly Planner': [{ id: 'entry-1', title: 'Read docs', fields: ['Read docs', '2026-10-30', '30', 'High'], done: false }] }, settings: { hours: 6 } };
    upload(valid);
    const merged = JSON.parse(w.localStorage.getItem(key));
    assert.equal(merged.items['Weekly Planner'][0].id, 'entry-1');
    assert.equal(merged.settings.role, 'Engineer');
    assert.equal(merged.settings.hours, 6);
    const afterValid = w.localStorage.getItem(key);
    w.Storage.prototype.setItem = () => { throw new Error('quota'); };
    const currentInput = w.document.querySelector('[data-import]');
    Object.defineProperty(currentInput, 'files', { value: [{ value: valid, size: 100 }] });
    currentInput.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal(w.localStorage.getItem(key), afterValid);
    assert.match(messages.at(-1), /save failed/i, 'failed persistence is never announced as merged');
  } finally { w.close(); }
}
console.log('Career dashboard: focus, visible labels, corrupted-store recovery, atomic import validation and quota errors passed.');
