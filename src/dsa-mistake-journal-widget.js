(function () {
  'use strict';
  if (window.__ARISE_DSA_MISTAKE_JOURNAL__) return;
  window.__ARISE_DSA_MISTAKE_JOURNAL__ = true;

  var KEY = 'dsaMistakeJournal-v1';
  var ROOT_ID = 'dmj-mistake-journal';
  var STYLE_ID = 'dmj-mistake-journal-style';
  var utils = window.__ARISE_WIDGET_UTILS__ || {};
  var formOpen = false;
  var editingId = '';
  var statusMessage = '';
  var filters = { status: 'all', category: 'all', query: '' };
  var categories = [
    { id: 'approach', label: 'Approach / pattern' },
    { id: 'edge-case', label: 'Missed edge case' },
    { id: 'implementation', label: 'Implementation bug' },
    { id: 'complexity', label: 'Complexity / optimization' },
    { id: 'recall', label: 'Concept recall' },
    { id: 'time', label: 'Time management' },
    { id: 'other', label: 'Other' }
  ];

  function localDate(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + 'T12:00:00');
    return !isNaN(date.getTime()) && localDate(date) === value;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function read(key, fallback) {
    if (typeof utils.safeGet === 'function') return utils.safeGet(key, fallback);
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function write(value) {
    if (typeof utils.safeSet === 'function') return utils.safeSet(KEY, value, {
      quotaMessage: 'Storage is full — export a backup from Backup Center before saving this mistake.',
      errorMessage: 'Could not save the mistake journal entry.'
    });
    try { localStorage.setItem(KEY, JSON.stringify(value)); return true; }
    catch (_) {
      if (utils.showToast) utils.showToast('Could not save the mistake journal entry.', 'danger');
      return false;
    }
  }
  function makeId() {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return 'mistake-' + window.crypto.randomUUID(); }
    catch (_) { /* Fall through for older browsers and test DOMs. */ }
    return 'mistake-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function categoryLabel(id) {
    var match = categories.find(function (item) { return item.id === id; });
    return match ? match.label : 'Other';
  }
  function normalize(raw) {
    var source = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray(raw.entries) ? raw.entries : [];
    var entries = [];
    source.forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      var what = String(item.whatHappened || '').trim().slice(0, 2000);
      var id = String(item.id || '').trim().slice(0, 120);
      if (!id || !what) return;
      var createdAt = Number(item.createdAt);
      if (!isFinite(createdAt) || createdAt < 0) createdAt = Date.now();
      var updatedAt = Number(item.updatedAt);
      if (!isFinite(updatedAt) || updatedAt < 0) updatedAt = createdAt;
      var questionId = item.questionId == null ? '' : String(item.questionId).slice(0, 160);
      var questionTitle = String(item.questionTitle || '').trim().slice(0, 240);
      var category = categories.some(function (candidate) { return candidate.id === item.category; }) ? item.category : 'other';
      var occurredOn = validDate(item.occurredOn) ? item.occurredOn : localDate(new Date(createdAt));
      entries.push({
        id: id,
        createdAt: createdAt,
        updatedAt: updatedAt,
        occurredOn: occurredOn,
        questionId: questionId,
        questionTitle: questionTitle,
        category: category,
        whatHappened: what,
        takeaway: String(item.takeaway || '').trim().slice(0, 2000),
        resolved: item.resolved === true
      });
    });
    return { schemaVersion: 1, entries: entries };
  }
  function readQuestions() {
    var value = read('dsaQuestions', []);
    return Array.isArray(value) ? value.filter(function (question) { return question && question.id != null && question.title; }) : [];
  }
  function linkedTitle(entry, questions) {
    if (!entry.questionId) return '';
    var current = questions.find(function (question) { return String(question.id) === entry.questionId; });
    if (current) return String(current.title);
    return entry.questionTitle ? entry.questionTitle + ' · no longer in bank' : 'Linked problem no longer in bank';
  }
  function repeatCount(entries, entry) {
    if (!entry || !entry.questionId) return 0;
    return entries.filter(function (candidate) {
      return candidate.questionId === entry.questionId && candidate.category === entry.category;
    }).length;
  }
  function filteredEntries(entries) {
    var query = filters.query.trim().toLocaleLowerCase();
    return entries.filter(function (entry) {
      if (filters.status === 'open' && entry.resolved) return false;
      if (filters.status === 'resolved' && !entry.resolved) return false;
      if (filters.category !== 'all' && entry.category !== filters.category) return false;
      if (!query) return true;
      return [entry.whatHappened, entry.takeaway, entry.questionTitle, categoryLabel(entry.category)]
        .join(' ').toLocaleLowerCase().indexOf(query) !== -1;
    }).sort(function (left, right) {
      return right.occurredOn.localeCompare(left.occurredOn) || right.createdAt - left.createdAt;
    });
  }
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.dmj-block{display:flex;flex-direction:column;gap:.85rem;color:var(--text-primary,#f1f5ff)}',
      '.dmj-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap}',
      '.dmj-title{margin:0;font-family:var(--font-display,inherit);font-size:1rem;font-weight:800;color:var(--text-primary,#f1f5ff)}',
      '.dmj-sub,.dmj-muted{margin:.2rem 0 0;font-size:.74rem;line-height:1.5;color:var(--text-secondary,#8b93b0)}',
      '.dmj-btn{border:1px solid var(--border-soft,rgba(255,255,255,.14));border-radius:.65rem;padding:.45rem .7rem;background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);font-family:inherit;font-size:.72rem;font-weight:600;cursor:pointer}',
      '.dmj-btn:hover{border-color:color-mix(in srgb,var(--info) 55%,transparent);background:color-mix(in srgb,var(--info) 10%,transparent)}',
      '.dmj-btn:focus-visible,.dmj-control:focus-visible{outline:2px solid var(--info,#38bdf8);outline-offset:2px}',
      '.dmj-btn-primary{border-color:color-mix(in srgb,var(--info) 50%,transparent);background:color-mix(in srgb,var(--info) 14%,transparent)}',
      '.dmj-btn-danger{color:var(--danger,#ef4444)}',
      '.dmj-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem;padding:.8rem;border:1px solid var(--border-soft,rgba(255,255,255,.1));border-radius:.9rem;background:var(--surface-soft,var(--surface-muted,rgba(255,255,255,.035)))}',
      '.dmj-field{display:flex;flex-direction:column;gap:.25rem;min-width:0;font-size:.68rem;font-weight:650;color:var(--text-secondary,#a7aec4)}',
      '.dmj-field-wide{grid-column:1/-1}',
      '.dmj-control{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--border-soft,rgba(255,255,255,.12));border-radius:.6rem;padding:.48rem .58rem;background:var(--surface,var(--surface-soft,#151a25));color:var(--text-primary,#f1f5ff);font-family:inherit;font-size:.75rem;font-weight:400}',
      '.dmj-control::placeholder{color:var(--text-muted,#788099)}',
      '.dmj-form-actions{grid-column:1/-1;display:flex;gap:.45rem;flex-wrap:wrap}',
      '.dmj-filters{display:grid;grid-template-columns:minmax(150px,1fr) minmax(125px,.45fr) minmax(145px,.5fr);gap:.5rem;align-items:center}',
      '.dmj-count{font-size:.68rem;color:var(--text-secondary,#8b93b0)}',
      '.dmj-list{display:flex;flex-direction:column;gap:.55rem;max-height:560px;overflow:auto;padding-right:.15rem}',
      '.dmj-entry{display:flex;flex-direction:column;gap:.4rem;padding:.7rem .75rem;border:1px solid var(--border-soft,var(--border,rgba(255,255,255,.08)));border-radius:.8rem;background:var(--surface-soft,var(--surface-muted,rgba(255,255,255,.03)))}',
      '.dmj-entry-top{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}',
      '.dmj-chip{display:inline-flex;align-items:center;border:1px solid color-mix(in srgb,var(--warning) 32%,transparent);border-radius:999px;padding:.15rem .48rem;color:var(--warning,#fbbf24);font-size:.62rem;font-weight:700}',
      '.dmj-chip-resolved{border-color:color-mix(in srgb,var(--success) 35%,transparent);color:var(--success,#34d399)}',
      '.dmj-date{font-size:.65rem;color:var(--text-secondary,#8b93b0)}',
      '.dmj-problem{font-size:.76rem;font-weight:750;color:var(--text-primary,#f1f5ff);overflow-wrap:anywhere}',
      '.dmj-copy{margin:0;font-size:.73rem;line-height:1.5;color:var(--text-primary,#dce2f2);overflow-wrap:anywhere;white-space:pre-wrap}',
      '.dmj-takeaway{padding:.45rem .55rem;border-left:2px solid var(--info,#38bdf8);border-radius:.2rem .5rem .5rem .2rem;background:color-mix(in srgb,var(--info) 6%,transparent);font-size:.71rem;line-height:1.5;color:var(--text-secondary,#aeb6cb);white-space:pre-wrap;overflow-wrap:anywhere}',
      '.dmj-repeat{font-size:.64rem;color:var(--warning,#fbbf24)}',
      '.dmj-entry-actions{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.1rem}',
      '.dmj-empty{padding:.85rem;border:1px dashed var(--border-soft,rgba(255,255,255,.16));border-radius:.8rem;font-size:.74rem;line-height:1.5;color:var(--text-secondary,#8b93b0)}',
      '.dmj-status{min-height:1rem;font-size:.7rem;color:var(--success,#34d399)}',
      '[data-theme-mode=light] .dmj-title,[data-theme-mode=light] .dmj-problem,[data-theme-mode=light] .dmj-copy{color:var(--text-primary,#111827)}',
      '[data-theme-mode=light] .dmj-sub,[data-theme-mode=light] .dmj-muted,[data-theme-mode=light] .dmj-field,[data-theme-mode=light] .dmj-date,[data-theme-mode=light] .dmj-takeaway,[data-theme-mode=light] .dmj-empty{color:var(--text-secondary,#4b5563)}',
      '[data-theme-mode=light] .dmj-control,[data-theme-mode=light] .dmj-btn{color:var(--text-primary,#111827);background:var(--surface,#fff)}',
      '@media(max-width:680px){.dmj-filters{grid-template-columns:1fr 1fr}.dmj-search{grid-column:1/-1}}',
      '@media(max-width:520px){.dmj-form{grid-template-columns:1fr}.dmj-field-wide,.dmj-form-actions{grid-column:auto}.dmj-filters{grid-template-columns:1fr}.dmj-search{grid-column:auto}}'
    ].join('');
    document.head.appendChild(style);
  }
  function selectOptions(items, selected, allLabel) {
    return items.map(function (item) {
      return '<option value="' + escapeHtml(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>';
    }).join('');
  }
  function renderForm(entries, questions) {
    if (!formOpen) return '';
    var editing = entries.find(function (entry) { return entry.id === editingId; }) || null;
    var questionOptions = '<option value="">No linked problem</option>' + questions.map(function (question) {
      var id = String(question.id);
      return '<option value="' + escapeHtml(id) + '"' + (editing && editing.questionId === id ? ' selected' : '') + '>' + escapeHtml(question.title) + '</option>';
    }).join('');
    if (editing && editing.questionId && !questions.some(function (question) { return String(question.id) === editing.questionId; })) {
      questionOptions += '<option value="' + escapeHtml(editing.questionId) + '" selected>' + escapeHtml((editing.questionTitle || 'Linked problem') + ' · no longer in bank') + '</option>';
    }
    var selectedCategory = editing ? editing.category : 'approach';
    return '<form class="dmj-form" data-mj-form>' +
      '<label class="dmj-field">Date noticed<input class="dmj-control" type="date" data-mj-date value="' + escapeHtml(editing ? editing.occurredOn : localDate()) + '" required></label>' +
      '<label class="dmj-field">Mistake category<select class="dmj-control" data-mj-category>' + selectOptions(categories, selectedCategory) + '</select></label>' +
      '<label class="dmj-field dmj-field-wide">Related DSA problem (optional)<select class="dmj-control" data-mj-question>' + questionOptions + '</select></label>' +
      '<label class="dmj-field dmj-field-wide">What went wrong?<textarea class="dmj-control" data-mj-what maxlength="2000" rows="3" placeholder="Describe the specific mistake or point of confusion." required>' + escapeHtml(editing ? editing.whatHappened : '') + '</textarea></label>' +
      '<label class="dmj-field dmj-field-wide">Corrective takeaway (optional)<textarea class="dmj-control" data-mj-takeaway maxlength="2000" rows="2" placeholder="What will you try or check next time?">' + escapeHtml(editing ? editing.takeaway : '') + '</textarea></label>' +
      '<div class="dmj-form-actions"><button class="dmj-btn dmj-btn-primary" type="submit">' + (editing ? 'Save changes' : 'Save mistake') + '</button><button class="dmj-btn" type="button" data-mj-cancel>Cancel</button></div>' +
      '</form>';
  }
  function renderEntry(entry, allEntries, questions) {
    var title = linkedTitle(entry, questions);
    var repeat = repeatCount(allEntries, entry);
    return '<article class="dmj-entry" data-mj-entry="' + escapeHtml(entry.id) + '">' +
      '<div class="dmj-entry-top"><span class="dmj-chip' + (entry.resolved ? ' dmj-chip-resolved' : '') + '">' + (entry.resolved ? 'Resolved' : 'Open') + '</span>' +
      '<span class="dmj-chip">' + escapeHtml(categoryLabel(entry.category)) + '</span><time class="dmj-date" datetime="' + escapeHtml(entry.occurredOn) + '">' + escapeHtml(new Date(entry.occurredOn + 'T12:00:00').toLocaleDateString()) + '</time></div>' +
      (title ? '<div class="dmj-problem">' + escapeHtml(title) + '</div>' : '') +
      '<p class="dmj-copy">' + escapeHtml(entry.whatHappened) + '</p>' +
      (entry.takeaway ? '<div class="dmj-takeaway"><strong>Next time:</strong> ' + escapeHtml(entry.takeaway) + '</div>' : '') +
      (repeat > 1 ? '<div class="dmj-repeat">Logged ' + repeat + ' times for this problem and category.</div>' : '') +
      '<div class="dmj-entry-actions"><button class="dmj-btn" type="button" data-mj-resolve="' + escapeHtml(entry.id) + '" aria-pressed="' + String(entry.resolved) + '">' + (entry.resolved ? 'Reopen' : 'Mark resolved') + '</button>' +
      '<button class="dmj-btn" type="button" data-mj-edit="' + escapeHtml(entry.id) + '">Edit</button>' +
      '<button class="dmj-btn dmj-btn-danger" type="button" data-mj-delete="' + escapeHtml(entry.id) + '">Delete</button></div></article>';
  }
  function renderList(root, normalized, questions) {
    var shown = filteredEntries(normalized.entries);
    var counts = root.querySelector('[data-mj-count]');
    var list = root.querySelector('[data-mj-list]');
    var countText = normalized.entries.length + ' entries · ' + normalized.entries.filter(function (entry) { return !entry.resolved; }).length + ' open · ' + normalized.entries.filter(function (entry) { return entry.resolved; }).length + ' resolved';
    var listHtml = shown.length ? shown.map(function (entry) { return renderEntry(entry, normalized.entries, questions); }).join('') : '<div class="dmj-empty">' + (normalized.entries.length ? 'No entries match these filters.' : 'No mistake entries yet. Log a specific miss and the takeaway you want to remember; this journal will not change your question bank or existing notes.') + '</div>';
    if (counts && counts.textContent !== countText) counts.textContent = countText;
    if (list && list.innerHTML !== listHtml) list.innerHTML = listHtml;
  }
  function render() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    ensureStyles();
    var normalized = normalize(read(KEY, { schemaVersion: 1, entries: [] }));
    var questions = readQuestions();
    var editExists = normalized.entries.some(function (entry) { return entry.id === editingId; });
    if (editingId && !editExists) { editingId = ''; formOpen = false; }
    var markup = '<section class="dmj-block" aria-labelledby="dmj-title"><header class="dmj-head"><div><h3 class="dmj-title" id="dmj-title">Mistake journal</h3><p class="dmj-sub">Capture dated misses and a next-time takeaway. This is separate from per-problem notes and mock history.</p></div><button class="dmj-btn dmj-btn-primary" type="button" data-mj-new>' + (formOpen ? 'Add another' : '＋ Log a mistake') + '</button></header>' +
      '<div class="dmj-status" role="status" aria-live="polite">' + escapeHtml(statusMessage) + '</div>' +
      renderForm(normalized.entries, questions) +
      '<div class="dmj-filters"><input class="dmj-control dmj-search" type="search" data-mj-search value="' + escapeHtml(filters.query) + '" placeholder="Search mistakes, takeaways, or problems" aria-label="Search mistake journal">' +
      '<select class="dmj-control" data-mj-status aria-label="Filter by status"><option value="all"' + (filters.status === 'all' ? ' selected' : '') + '>All statuses</option><option value="open"' + (filters.status === 'open' ? ' selected' : '') + '>Open</option><option value="resolved"' + (filters.status === 'resolved' ? ' selected' : '') + '>Resolved</option></select>' +
      '<select class="dmj-control" data-mj-category-filter aria-label="Filter by category"><option value="all">All categories</option>' + selectOptions(categories, filters.category) + '</select></div>' +
      '<div class="dmj-count" data-mj-count></div><div class="dmj-list" data-mj-list aria-live="polite"></div></section>';
    if (root.__dmjMarkup !== markup) { root.__dmjMarkup = markup; root.innerHTML = markup; }
    renderList(root, normalized, questions);
    if (!root.__dmjWired) {
      root.__dmjWired = true;
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('input', onInput);
      root.addEventListener('submit', onSubmit);
    }
  }
  function onClick(event) {
    var target = event.target.closest && event.target.closest('[data-mj-new], [data-mj-cancel], [data-mj-edit], [data-mj-resolve], [data-mj-delete]');
    if (!target) return;
    if (target.hasAttribute('data-mj-new')) {
      formOpen = true; editingId = ''; statusMessage = ''; render();
      var what = document.querySelector('#' + ROOT_ID + ' [data-mj-what]');
      if (what) what.focus();
      return;
    }
    if (target.hasAttribute('data-mj-cancel')) { formOpen = false; editingId = ''; statusMessage = ''; render(); return; }
    var id = target.getAttribute('data-mj-edit') || target.getAttribute('data-mj-resolve') || target.getAttribute('data-mj-delete');
    var normalized = normalize(read(KEY, { schemaVersion: 1, entries: [] }));
    var index = normalized.entries.findIndex(function (entry) { return entry.id === id; });
    if (index < 0) return;
    if (target.hasAttribute('data-mj-edit')) { editingId = id; formOpen = true; statusMessage = ''; render(); return; }
    if (target.hasAttribute('data-mj-resolve')) {
      normalized.entries[index].resolved = !normalized.entries[index].resolved;
      normalized.entries[index].updatedAt = Date.now();
      if (write(normalized)) { statusMessage = normalized.entries[index].resolved ? 'Entry marked resolved.' : 'Entry reopened.'; render(); }
      return;
    }
    if (target.hasAttribute('data-mj-delete')) {
      var title = normalized.entries[index].questionTitle || 'this mistake entry';
      if (typeof window.confirm === 'function' && !window.confirm('Delete ' + title + '? This does not change the linked question.')) return;
      normalized.entries.splice(index, 1);
      if (write(normalized)) { if (editingId === id) { editingId = ''; formOpen = false; } statusMessage = 'Entry deleted.'; render(); }
    }
  }
  function onChange(event) {
    if (event.target.matches('[data-mj-status]')) filters.status = event.target.value;
    else if (event.target.matches('[data-mj-category-filter]')) filters.category = event.target.value;
    else return;
    var root = document.getElementById(ROOT_ID);
    if (root) renderList(root, normalize(read(KEY, { entries: [] })), readQuestions());
  }
  function onInput(event) {
    if (!event.target.matches('[data-mj-search]')) return;
    filters.query = event.target.value;
    var root = document.getElementById(ROOT_ID);
    if (root) renderList(root, normalize(read(KEY, { entries: [] })), readQuestions());
  }
  function onSubmit(event) {
    if (!event.target.matches('[data-mj-form]')) return;
    event.preventDefault();
    var form = event.target;
    var what = form.querySelector('[data-mj-what]').value.trim();
    var date = form.querySelector('[data-mj-date]').value;
    if (!what || !validDate(date)) {
      statusMessage = 'Enter a mistake description and a valid date.';
      render();
      return;
    }
    var normalized = normalize(read(KEY, { schemaVersion: 1, entries: [] }));
    var previous = normalized.entries.find(function (entry) { return entry.id === editingId; }) || null;
    var questionId = form.querySelector('[data-mj-question]').value;
    var questions = readQuestions();
    var question = questions.find(function (item) { return String(item.id) === questionId; });
    var snapshot = question ? String(question.title) : previous && previous.questionId === questionId ? previous.questionTitle : '';
    var entry = {
      id: previous ? previous.id : makeId(),
      createdAt: previous ? previous.createdAt : Date.now(),
      updatedAt: Date.now(),
      occurredOn: date,
      questionId: questionId,
      questionTitle: snapshot,
      category: form.querySelector('[data-mj-category]').value,
      whatHappened: what,
      takeaway: form.querySelector('[data-mj-takeaway]').value.trim(),
      resolved: previous ? previous.resolved : false
    };
    if (previous) normalized.entries[normalized.entries.indexOf(previous)] = entry;
    else normalized.entries.unshift(entry);
    if (!write(normalized)) return;
    formOpen = false; editingId = ''; statusMessage = previous ? 'Mistake entry updated.' : 'Mistake entry saved.';
    render();
  }

  window.__ARISE_DSA_MISTAKE_JOURNAL_API__ = {
    normalize: normalize,
    repeatCount: repeatCount,
    categoryLabel: categoryLabel
  };
  if (typeof utils.bootUpdater === 'function') utils.bootUpdater(render);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
