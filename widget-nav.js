(function () {
  'use strict';
  if (window.AriseWidgetNav) return;

  /* ── helpers ───────────────────────────────────────────────────── */
  function esc(a) {
    return String(a ?? '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lsGet(k, list, def) {
    if (!k) return def;
    try { var v = localStorage.getItem(k); if (v && list.some(function (s) { return s.id === v; })) return v; } catch (e) {}
    return def;
  }
  function lsSet(k, v) { if (k) try { localStorage.setItem(k, v); } catch (e) {} }

  /* ── ids for ARIA linking ───────────────────────────────────────── */
  var _uid = 0;
  function uid() { return 'awnav-' + (++_uid) + '-' + Math.random().toString(36).slice(2, 6); }

  /* single shared visually-hidden live region for the whole page — SR
     users hear which tab is now showing regardless of which widget's
     nav triggered it. Belt-and-braces alongside aria-selected, which
     some SR/browser combos don't announce reliably on its own. */
  var _liveRegion = null;
  function _announce(section) {
    if (!section) return;
    if (!_liveRegion) {
      _liveRegion = document.createElement('div');
      _liveRegion.setAttribute('role', 'status');
      _liveRegion.setAttribute('aria-live', 'polite');
      _liveRegion.className = 'wnav-sr-only';
      document.body.appendChild(_liveRegion);
    }
    _liveRegion.textContent = section.label + ' tab selected';
  }

  /* ── factory ────────────────────────────────────────────────────── */
  function create(opts) {
    opts = opts || {};
    var sections    = opts.sections || [];
    var storageKey  = opts.storageKey || null;
    var defaultSec  = opts.defaultSection || (sections[0] && sections[0].id);
    var active      = lsGet(storageKey, sections, defaultSec);
    var builders    = {};   /* id → function when lazy */
    var rootId      = uid();  /* unique per nav instance */

    function tabId(id)   { return rootId + '-tab-'   + id; }
    function panelId(id) { return rootId + '-panel-' + id; }

    /* nav HTML ─────────────────────────────────────────────────── */
    function navHtml() {
      if (!sections.length) return '';
      return (
        '<div class="wnav' + (opts.sticky ? ' wnav--sticky' : '') + '" data-wnav-root role="tablist" aria-orientation="horizontal" id="' + rootId + '" aria-label="' + esc(opts.label || 'Navigation') + '">' +
        sections.map(function (t) {
          var on = t.id === active;
          return (
            '<button type="button"' +
            ' class="wnav-pill' + (on ? ' wnav-pill-active' : '') + '"' +
            ' data-wnav-id="' + esc(t.id) + '"' +
            ' id="' + tabId(t.id) + '"' +
            ' role="tab"' +
            ' aria-selected="' + on + '"' +
            ' aria-controls="' + panelId(t.id) + '"' +
            ' tabindex="' + (on ? '0' : '-1') + '"' +
            '>' +
            (t.icon ? '<span class="wnav-icon" aria-hidden="true">' + t.icon + '</span>' : '') +
            '<span>' + esc(t.label) + '</span>' +
            '</button>'
          );
        }).join('') +
        '</div>'
      );
    }

    /* panel wrapper ─────────────────────────────────────────────── */
    function panelWrap(id, content) {
      var on      = id === active;
      var isLazy  = typeof content === 'function';
      if (isLazy) builders[id] = content;
      var inner   = isLazy ? (on ? content() : '') : content;
      return (
        '<div class="wnav-panel"' +
        ' data-wnav-panel="' + esc(id) + '"' +
        ' id="' + panelId(id) + '"' +
        ' role="tabpanel"' +
        ' aria-labelledby="' + tabId(id) + '"' +
        (on ? '' : ' hidden') +
        '>' + inner + '</div>'
      );
    }

    /* sync visible state to DOM ─────────────────────────────────── */
    function syncDOM(root) {
      if (!root) return;
      root.querySelectorAll('[data-wnav-root] [data-wnav-id]').forEach(function (btn) {
        var on = btn.getAttribute('data-wnav-id') === active;
        btn.classList.toggle('wnav-pill-active', on);
        btn.setAttribute('aria-selected', String(on));
        btn.setAttribute('tabindex', on ? '0' : '-1');
      });
      root.querySelectorAll('[data-wnav-panel]').forEach(function (p) {
        var on = p.getAttribute('data-wnav-panel') === active;
        if (on) { p.removeAttribute('hidden'); } else { p.setAttribute('hidden', ''); }
      });
    }

    /* fill a lazy panel if it's currently active and still empty ── */
    function fillActive(root) {
      if (!root) return;
      var fn = builders[active];
      if (!fn) return;
      var panel = root.querySelector('[data-wnav-panel="' + active + '"]');
      if (panel && !panel.hasChildNodes() && !panel.textContent) panel.innerHTML = fn();
    }

    /* scroll active tab into view ───────────────────────────────── */
    function scrollTabIntoView(root) {
      if (!root) return;
      var btn = root.querySelector('[data-wnav-id="' + active + '"]');
      if (btn && typeof btn.scrollIntoView === "function") btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    /* activate a section ─────────────────────────────────────────── */
    function setActive(id, root, opts2) {
      if (!sections.some(function (s) { return s.id === id; })) return;
      if (id === active) return;
      active = id;
      lsSet(storageKey, id);
      syncDOM(root);
      fillActive(root);
      scrollTabIntoView(root);
      if (!opts2 || !opts2.silent) _announce(sections.find(function (s) { return s.id === id; }));
    }

    /* step to the next/previous section (wraps) ──────────────────── */
    function step(delta, root) {
      var idx = sections.findIndex(function (s) { return s.id === active; });
      if (idx < 0) return;
      var next = (idx + delta + sections.length) % sections.length;
      setActive(sections[next].id, root);
    }

    /* keyboard navigation (roving tabindex, arrow keys) ────────── */
    function handleKey(e, root) {
      var navRoot = e.target.closest('[data-wnav-root]');
      if (!navRoot || !root.contains(navRoot)) return;
      var tabs = Array.from(navRoot.querySelectorAll('[data-wnav-id]'));
      var idx  = tabs.indexOf(e.target);
      if (idx < 0) return;

      var next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  next = (idx + 1) % tabs.length;
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    next = (idx - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home')                                  next = 0;
      if (e.key === 'End')                                   next = tabs.length - 1;

      if (next >= 0) {
        e.preventDefault();
        var id = tabs[next].getAttribute('data-wnav-id');
        setActive(id, root);
        /* move focus to the newly-activated tab */
        var focused = root.querySelector('[data-wnav-id="' + id + '"]');
        if (focused) focused.focus();
        return;
      }

      /* Space / Enter on tab */
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        var clickId = e.target.getAttribute('data-wnav-id');
        if (clickId) setActive(clickId, root);
      }
    }

    /* wire ──────────────────────────────────────────────────────── */
    function wire(root, wireOpts) {
      if (!root) return;
      wireOpts = wireOpts || {};
      syncDOM(root);
      fillActive(root);
      scrollTabIntoView(root);

      var navRoot = root.querySelector('[data-wnav-root]');
      if (!navRoot) return;

      /* click */
      navRoot.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-wnav-id]');
        if (!btn || !navRoot.contains(btn)) return;
        var id = btn.getAttribute('data-wnav-id');
        if (id && id !== active) {
          setActive(id, root);
          if (typeof wireOpts.onChange === 'function') wireOpts.onChange(id);
        }
      });

      /* keyboard */
      navRoot.addEventListener('keydown', function (e) { handleKey(e, root); });

      /* scroll-fade indicator */
      _initScrollIndicator(navRoot);

      /* click-through chevrons for overflowing tab rails (pointer/mouse) */
      _initScrollChevrons(navRoot);

      /* swipe left/right on the active panel to switch tabs (touch) */
      _initSwipe(root, sections.length > 1 ? function (delta) { step(delta, root); } : null);

      /* "back to tabs" jump button once the rail scrolls out of view
         (skipped for widgets that opted into sticky — they don't need it) */
      if (!opts.sticky) _initBackToTabs(navRoot);
    }

    /* shared across every widget-nav instance on the page: a single small
       floating button that appears once a tab rail scrolls out of view,
       and jumps back to whichever one just disappeared. Cheap (one
       IntersectionObserver per rail, one shared button element) and a
       real fix for "I scrolled deep into a tab and can't find the nav
       again" on long widgets. */
    var _backToTabsBtn = null;
    var _backToTabsTarget = null;
    function _getBackToTabsBtn() {
      if (_backToTabsBtn) return _backToTabsBtn;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wnav-back-to-tabs';
      btn.textContent = '↑ Tabs';
      btn.hidden = true;
      btn.addEventListener('click', function () {
        if (_backToTabsTarget && typeof _backToTabsTarget.scrollIntoView === 'function') {
          _backToTabsTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        btn.hidden = true;
      });
      document.body.appendChild(btn);
      _backToTabsBtn = btn;
      return btn;
    }
    function _initBackToTabs(navRoot) {
      if (!navRoot || navRoot.__wnavBackToTabsInit) return;
      navRoot.__wnavBackToTabsInit = true;
      if (typeof IntersectionObserver !== 'function') return;
      var btn = _getBackToTabsBtn();
      var io = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          if (_backToTabsTarget === navRoot) { btn.hidden = true; _backToTabsTarget = null; }
        } else if (entry.boundingClientRect.top < 0) {
          /* scrolled above the viewport (not just not-yet-scrolled-to) */
          _backToTabsTarget = navRoot;
          btn.hidden = false;
        }
      }, { threshold: 0 });
      io.observe(navRoot);
    }

    /* prev/next chevrons — only useful (and only shown) once the rail
       actually overflows; harmless no-op otherwise. Skipped on coarse
       (touch-only) pointers, where the fade + native drag-scroll already
       covers it and a floating chevron would just sit in the way. */
    function _initScrollChevrons(navRoot) {
      if (!navRoot || navRoot.__wnavChevronsInit) return;
      navRoot.__wnavChevronsInit = true;
      if (!window.matchMedia || !window.matchMedia('(any-pointer: fine)').matches) return;

      var prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'wnav-chevron wnav-chevron-prev';
      prevBtn.setAttribute('aria-label', 'Scroll tabs left');
      prevBtn.setAttribute('tabindex', '-1');
      prevBtn.innerHTML = '‹';

      var nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'wnav-chevron wnav-chevron-next';
      nextBtn.setAttribute('aria-label', 'Scroll tabs right');
      nextBtn.setAttribute('tabindex', '-1');
      nextBtn.innerHTML = '›';

      function scrollBy(amount) {
        navRoot.scrollBy({ left: amount, behavior: 'smooth' });
      }
      prevBtn.addEventListener('click', function () { scrollBy(-140); });
      nextBtn.addEventListener('click', function () { scrollBy(140); });

      function updateVisibility() {
        var overflowing = navRoot.scrollWidth - navRoot.clientWidth > 4;
        prevBtn.hidden = !overflowing;
        nextBtn.hidden = !overflowing;
      }
      navRoot.addEventListener('scroll', updateVisibility, { passive: true });
      window.addEventListener('resize', updateVisibility, { passive: true });
      (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(updateVisibility, 0);

      var wrap = navRoot.parentNode;
      if (!wrap) return;
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      wrap.classList.add('wnav-chevron-wrap');
      wrap.insertBefore(prevBtn, navRoot);
      wrap.insertBefore(nextBtn, navRoot.nextSibling);
    }

    /* touch-swipe on the panel body to move between tabs, iOS/Android-style */
    function _initSwipe(root, onStep) {
      if (!root || !onStep || root.__wnavSwipeInit) return;
      root.__wnavSwipeInit = true;
      var sx = 0, sy = 0, tracking = false;
      root.addEventListener('touchstart', function (e) {
        if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
        var t = e.target.closest('[data-wnav-panel]');
        if (!t) { tracking = false; return; }
        /* don't hijack swipes starting on interactive/scrollable controls */
        if (e.target.closest('input, textarea, select, [data-wnav-id], .att-cal-grid, .att-heat-grid, [class*="scroll"], [style*="overflow"]')) { tracking = false; return; }
        sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
      }, { passive: true });
      root.addEventListener('touchend', function (e) {
        if (!tracking) return;
        tracking = false;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        onStep(dx < 0 ? 1 : -1);
      }, { passive: true });
    }

    /* scroll-fade indicator (shows/hides gradient if tabs overflow) */
    function _initScrollIndicator(navRoot) {
      if (!navRoot) return;
      function update() {
        var sl = navRoot.scrollLeft;
        var max = navRoot.scrollWidth - navRoot.clientWidth;
        navRoot.classList.toggle('wnav--scroll-start', sl > 4);
        navRoot.classList.toggle('wnav--scroll-end',   sl < max - 4);
      }
      navRoot.addEventListener('scroll', update, { passive: true });
      /* RAF so layout is computed */
      (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(update, 0);
    }

    return {
      navHtml:   navHtml,
      panelWrap: panelWrap,
      wire:      wire,
      setActive: setActive,
      getActive: function () { return active; },
      sections:  sections
    };
  }

  window.AriseWidgetNav = { create: create };
})();
