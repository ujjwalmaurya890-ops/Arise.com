'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><div id="notes"></div><div id="wiki"></div>', { url: 'https://arise.test/', runScripts: 'outside-only' });
const w = dom.window;
try {
  w.eval(fs.readFileSync(path.join(root, 'src/widget-shared-utils.js'), 'utf8'));
  const content = '[Unsafe](javascript:alert%281%29)\n\n[Data](data:text/html,bad)\n\n[VB](vbscript:msgbox)\n\n[Safe](https://example.com/a_b?q=1&x=2)\n\n[Relative](/guide#topic)\n\n[Email](mailto:hello@example.com)\n\n![Bad image](data:image/svg+xml,bad)\n\n![Image](https://example.com/image.png)\n\n**Bold** and `a < b`\n\n[[R&D]]\n\n[`nested <code>`](https://example.com/code)\n\n![`quoted "x"`](https://example.com/alt.png)\n\n<script>bad()</script>';
  const notes = { version: 2, folders: [], notes: [{ id: 'n1', title: 'Audit', content, linkedUrl: 'JaVaScRiPt:alert(1)', tags: [], createdAt: '2026-10-30', updatedAt: '2026-10-30' }], ui: { activeNoteId: 'n1' } };
  const wiki = { version: 1, categories: [], pages: [{ id: 'p1', title: 'Audit', content, createdAt: '2026-10-30', updatedAt: '2026-10-30' }, { id: 'p2', title: 'R&D', content: 'Linked page' }], ui: { activePageId: 'p1' } };
  w.localStorage.setItem('arise-notes-app-v1', JSON.stringify(notes));
  w.localStorage.setItem('arise-personal-wiki-v1', JSON.stringify(wiki));
  for (const file of ['src/notes-app-widget.js', 'src/personal-wiki-widget.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  w.__mountNotesApp(w.document.getElementById('notes'));
  w.__mountPersonalWiki(w.document.getElementById('wiki'));
  assert.equal([...w.document.querySelectorAll('a')].filter(a => /^(javascript|data|vbscript):/i.test(a.getAttribute('href') || '')).length, 0, 'stored links and both Markdown renderers reject executable schemes');
  for (const prefix of ['na', 'pw']) {
    const links = [...w.document.querySelectorAll('.' + prefix + '-md-link')];
    assert.equal(links.find(a => a.textContent === 'Safe').href, 'https://example.com/a_b?q=1&x=2');
    assert.equal(links.find(a => a.textContent === 'Relative').href, 'https://arise.test/guide#topic');
    assert.equal(links.find(a => a.textContent === 'Email').href, 'mailto:hello@example.com');
    assert.equal(w.document.querySelector('.' + prefix + '-inline-code').textContent, 'a < b', 'code is escaped exactly once');
    assert.ok(w.document.querySelector('#' + (prefix === 'na' ? 'notes' : 'wiki') + ' strong'));
  }
  assert.equal(w.document.querySelector('.na-md-link[href="https://example.com/code"] code')?.textContent, 'nested <code>');
  assert.equal(w.document.querySelector('.pw-md-link[href="https://example.com/code"] code')?.textContent, 'nested <code>');
  assert.equal(w.document.querySelector('.na-md-img[src="https://example.com/alt.png"]').alt, 'quoted "x"');
  assert.equal(/[\u0003\u0004]/.test(w.document.body.innerHTML), false, 'nested token placeholders never leak');
  assert.equal(w.document.querySelectorAll('script').length, 0);
  assert.equal(w.document.querySelectorAll('img[src^="data:"]').length, 0);
  assert.equal(w.document.querySelector('.na-md-img').getAttribute('referrerpolicy'), 'no-referrer');
  const wikiLink = w.document.querySelector('.pw-wikilink[data-title="R&D"]');
  assert.ok(wikiLink && !wikiLink.classList.contains('pw-wikilink-new'), 'wiki titles are not double-escaped');
  const safeURL = w.__ariseShared.safeURL;
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', 'file:///tmp/a', 'blob:https://arise.test/id', 'https://user:password@example.com/']) assert.equal(safeURL(bad, { allowMailto: true }), '', bad);
  assert.equal(safeURL('mailto:hello@example.com'), '', 'images/default URLs do not accept mailto');
  assert.equal(safeURL('https://example.com/?a=1&b=2'), 'https://example.com/?a=1&b=2');
  assert.equal(JSON.parse(w.localStorage.getItem('arise-notes-app-v1')).notes[0].content, content, 'unsafe input is not erased from the stored document');
  assert.equal(JSON.parse(w.localStorage.getItem('arise-personal-wiki-v1')).pages[0].content, content);
  console.log('Safe Markdown: unsafe schemes, stored links, code escaping, wiki links, legitimate URLs, image privacy and original data retention passed.');
} finally { w.close(); }
