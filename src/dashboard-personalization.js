/* ==========================================================================
   Dashboard personalization (src/dashboard-personalization.js)
   --------------------------------------------------------------------------
   The React dashboard owns an ordered set of cards inside #arise-main's main
   column. Users can now choose which of those cards they see, in what order,
   and pin the ones they use every day. Nothing is moved at the loader level:
   every module still mounts exactly as before, this pass only re-orders and
   hides DOM nodes after they exist and restores them when the preference is
   cleared.

   Public API (window.AriseDashboardLayout)
   ----------------------------------------
   cards()                     -> [{ key, label, node, hidden, pinned, nodeIndex }]
   move(key, delta)            -> move a card up (-1) / down (+1) / to top (0)
   toggle(key)                 -> show/hide one card
   pin(key)                    -> pin/unpin (pinned cards always sort first)
   reset()                     -> forget all preferences and restore DOM order
   open() / close()            -> open the Personalize dashboard panel
   storageKey                  -> "arise-dashboard-layout-v1"

   Safety rules
   ------------
   - Only direct children of the dashboard card stack are eligible, and only
     those that existed before this pass ran (widget slots injected later keep
     their own order).
   - Hidden cards are `hidden` + inert, never removed, so widget lifecycle and
     their own timers/observers keep working.
   - A stored list that mentions a card which no longer exists is ignored; new
     cards appear at the end. Corrupt JSON is discarded, not repaired in place.
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseDashboardLayout) return;

  var STORAGE_KEY = "arise-dashboard-layout-v1";
  var MAIN_ID = "arise-main";
  var MAX_KEY = 120;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function getAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { order: [], hidden: [], pinned: [] };
      var parsed = JSON.parse(raw);
      function cleanList(list) {
        if (!Array.isArray(list)) return [];
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var entry = list[i];
          if (typeof entry === "string" && entry && entry.length <= MAX_KEY && out.indexOf(entry) === -1) out.push(entry);
        }
        return out;
      }
      return { order: cleanList(parsed && parsed.order), hidden: cleanList(parsed && parsed.hidden), pinned: cleanList(parsed && parsed.pinned) };
    } catch {
      return { order: [], hidden: [], pinned: [] };
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, order: state.order, hidden: state.hidden, pinned: state.pinned }));
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------- discovery -- */

  function mainEl() {
    return document.getElementById(MAIN_ID);
  }

  /** The column that actually holds the dashboard cards. */
  function cardStack() {
    var main = mainEl();
    if (!main) return null;
    var content = main.querySelector(".max-w-7xl");
    if (!content) return null;
    // The dashboard commits its card stack as a spaced column. Prefer the
    // element that actually carries that stack class rather than "the first
    // child", which is only true while React has already painted.
    var stack = content.querySelector(":scope > .space-y-6") || content.querySelector(".space-y-6");
    if (stack && stack.children.length) return stack;
    var direct = content.firstElementChild;
    if (direct && direct.children.length > 2 && direct.className === "space-y-6") return direct;
    return direct && direct.children.length > 1 ? direct : content;
  }

  /**
   * Every element child of the dashboard card stack is a card — the stack's
   * only job is to lay them out. Non-elements, scripts and anything a widget
   * explicitly opted out of are skipped.
   */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, LINK: 1, META: 1, NOSCRIPT: 1 };

  function looksLikeCard(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return false;
    if (el.getAttribute("data-arise-card-ignore") === "true") return false;
    // An empty widget slot is still a card: its widget mounts into it later.
    if (el.id && /(^|-)slot$/.test(el.id)) return true;
    if (!el.children.length && !String(el.textContent || "").trim()) return false;
    return true;
  }

  function labelOf(el) {
    if (!el) return "Section";
    var id = el.id || "";
    if (id === "arise-career-readiness-slot") return "Career readiness widget";
    if (id === "arise-readiness-planner-slot") return "Readiness planner widget";
    var heading = el.matches && el.matches("h1,h2,h3") ? el : el.querySelector ? el.querySelector("h1, h2, h3, .stat-label, [data-card-title]") : null;
    if (heading) {
      var text = String(heading.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return text.slice(0, 60);
    }
    var text2 = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (text2) return text2.split(" ").slice(0, 5).join(" ").slice(0, 60);
    return "Section";
  }

  /**
   * Stable identity: the element id when present, otherwise a slug of its
   * visible label. Index-based keys would silently re-point to a different
   * card the moment one is moved, which is exactly what this feature does.
   */
  function keyOf(el, label, seen) {
    if (el.id) return "id:" + el.id;
    var slug = String(label || "section").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "section";
    var key = "label:" + slug;
    if (seen[key]) key += "#" + (seen[key] + 1);
    seen[key.split("#")[0]] = (seen[key.split("#")[0]] || 0) + 1;
    return key;
  }

  /**
   * Snapshot of the card stack in AUTHOR order. Recomputed on every read so a
   * card added by a widget does not shift the identity of the others.
   */
  function snapshot() {
    var stack = cardStack();
    if (!stack) return [];
    var out = [], seen = {};
    for (var i = 0; i < stack.children.length; i++) {
      var el = stack.children[i];
      if (!looksLikeCard(el)) continue;
      var label = labelOf(el);
      out.push({ key: keyOf(el, label, seen), label: label, node: el, nodeIndex: i });
    }
    return out;
  }

  function state() {
    var cards = snapshot();
    var prefs = getAll();
    var known = {};
    cards.forEach(function (card) { known[card.key] = true; });

    // Keep only preferences that still match a live card.
    var order = prefs.order.filter(function (key) { return known[key]; });
    cards.forEach(function (card) {
      if (order.indexOf(card.key) === -1) order.push(card.key);
    });

    return {
      cards: cards,
      order: order,
      hidden: prefs.hidden.filter(function (key) { return known[key]; }),
      pinned: prefs.pinned.filter(function (key) { return known[key]; })
    };
  }

  /* ----------------------------------------------------------------- apply -- */

  var applying = false;

  /**
   * Author order captured the first time this pass sees the stack, so "Reset"
   * restores the real default instead of the user's last arrangement.
   */
  var authorOrder = null;

  function captureAuthorOrder() {
    if (authorOrder) return authorOrder;
    var cards = snapshot();
    authorOrder = cards.map(function (card) { return card.node; });
    return authorOrder;
  }

  function apply() {
    var stack = cardStack();
    if (!stack || applying) return false;
    var snapshotState = state();
    if (!snapshotState.cards.length) return false;
    captureAuthorOrder();
    applying = true;
    try {
      var byKey = {};
      snapshotState.cards.forEach(function (card) { byKey[card.key] = card; });

      // Pinned cards first (in the user's order), then the rest of the order.
      var ordered = snapshotState.order.slice().sort(function (a, b) {
        var pa = snapshotState.pinned.indexOf(a) === -1 ? 1 : 0;
        var pb = snapshotState.pinned.indexOf(b) === -1 ? 1 : 0;
        if (pa !== pb) return pa - pb;
        return snapshotState.order.indexOf(a) - snapshotState.order.indexOf(b);
      });

      ordered.forEach(function (key) {
        var card = byKey[key];
        if (!card) return;
        stack.appendChild(card.node); // appendChild moves existing nodes; it never clones
      });

      snapshotState.cards.forEach(function (card) {
        var hidden = snapshotState.hidden.indexOf(card.key) !== -1;
        if (hidden) {
          card.node.hidden = true;
          card.node.setAttribute("data-arise-card-hidden", "true");
          try { card.node.inert = true; } catch {}
        } else {
          card.node.hidden = false;
          card.node.removeAttribute("data-arise-card-hidden");
          try { card.node.inert = false; } catch {}
        }
        if (snapshotState.pinned.indexOf(card.key) !== -1) card.node.setAttribute("data-arise-card-pinned", "true");
        else card.node.removeAttribute("data-arise-card-pinned");
        card.node.setAttribute("data-arise-card-key", card.key);
      });

      return true;
    } finally {
      applying = false;
    }
  }

  /* -------------------------------------------------------------- mutations -- */

  function persist(next) {
    var prefs = getAll();
    var merged = {
      order: next.order || prefs.order,
      hidden: next.hidden || prefs.hidden,
      pinned: next.pinned || prefs.pinned
    };
    var saved = save(merged);
    apply();
    notify(saved);
    return saved;
  }

  function currentOrderKeys() {
    return state().order;
  }

  function move(key, delta) {
    var order = currentOrderKeys();
    var at = order.indexOf(key);
    if (at === -1) return false;
    order.splice(at, 1);
    var target = delta <= 0 && delta !== 0 ? at - 1 : delta === 0 ? 0 : at + 1;
    target = Math.max(0, Math.min(order.length, target));
    order.splice(target, 0, key);
    return persist({ order: order });
  }

  function toggle(key) {
    var prefs = state();
    var hidden = prefs.hidden.slice();
    var at = hidden.indexOf(key);
    if (at === -1) hidden.push(key);
    else hidden.splice(at, 1);
    return persist({ hidden: hidden, order: prefs.order, pinned: prefs.pinned });
  }

  function pin(key) {
    var prefs = state();
    var pinned = prefs.pinned.slice();
    var at = pinned.indexOf(key);
    if (at === -1) pinned.push(key);
    else pinned.splice(at, 1);
    return persist({ pinned: pinned, order: prefs.order, hidden: prefs.hidden });
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    var stack = cardStack();
    var order = captureAuthorOrder() || [];
    order.forEach(function (node) {
      if (!stack || !node || node.parentNode !== stack) return;
      node.hidden = false;
      node.removeAttribute("data-arise-card-hidden");
      node.removeAttribute("data-arise-card-pinned");
      node.removeAttribute("data-arise-card-key");
      try { node.inert = false; } catch {}
      stack.appendChild(node);
    });
    close();
    notify(true);
  }

  /* ------------------------------------------------------------------- UI -- */

  var live = null;
  function announce(message) {
    if (!live) {
      live = document.createElement("div");
      live.className = "adl-sr-only";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);
    }
    live.textContent = message;
  }

  function notify(saved) {
    if (!saved) announce("Could not save the dashboard layout. This browser is blocking local storage.");
    announce("Dashboard layout updated.");
  }

  function panel() {
    return document.getElementById("adl-panel");
  }

  function renderPanel() {
    var host = panel();
    if (!host) return;
    var prefs = state();
    if (!prefs.cards.length) {
      host.querySelector(".adl-list").innerHTML = '<p class="adl-empty">No dashboard cards were found on this screen.</p>';
      return;
    }
    var rows = prefs.order.map(function (key) {
      var card = null;
      for (var i = 0; i < prefs.cards.length; i++) if (prefs.cards[i].key === key) card = prefs.cards[i];
      if (!card) return "";
      var hidden = prefs.hidden.indexOf(key) !== -1;
      var pinned = prefs.pinned.indexOf(key) !== -1;
      return '<li class="adl-row" data-key="' + esc(key) + '"' + (hidden ? ' data-hidden="true"' : "") + '>' +
        '<span class="adl-row-main"><span class="adl-row-title">' + esc(card.label) + "</span>" +
        (pinned ? '<span class="adl-badge">Pinned</span>' : "") +
        (hidden ? '<span class="adl-badge adl-badge-muted">Hidden</span>' : "") + "</span>" +
        '<span class="adl-row-actions">' +
        '<button type="button" class="adl-btn" data-adl="up" aria-label="Move ' + esc(card.label) + ' up">↑</button>' +
        '<button type="button" class="adl-btn" data-adl="down" aria-label="Move ' + esc(card.label) + ' down">↓</button>' +
        '<button type="button" class="adl-btn" data-adl="pin" aria-pressed="' + (pinned ? "true" : "false") + '" aria-label="' + (pinned ? "Unpin " : "Pin ") + esc(card.label) + '">' + (pinned ? "Unpin" : "Pin") + "</button>" +
        '<button type="button" class="adl-btn" data-adl="toggle" aria-pressed="' + (hidden ? "false" : "true") + '" aria-label="' + (hidden ? "Show " : "Hide ") + esc(card.label) + '">' + (hidden ? "Show" : "Hide") + "</button>" +
        "</span></li>";
    }).join("");
    host.querySelector(".adl-list").innerHTML = rows;
    var count = prefs.cards.length - prefs.hidden.length;
    host.querySelector(".adl-status").textContent = count + " of " + prefs.cards.length + " cards visible";
  }

  function open() {
    var host = panel();
    if (!host) {
      host = document.createElement("div");
      host.id = "adl-panel";
      host.className = "adl-overlay";
      host.setAttribute("data-open", "false");
      host.innerHTML =
        '<div class="adl-dialog" role="dialog" aria-modal="true" aria-labelledby="adl-title">' +
        '<div class="adl-head"><div><h2 id="adl-title">Personalize dashboard</h2>' +
        '<p class="adl-status" role="status"></p></div>' +
        '<button type="button" class="adl-btn adl-close" data-adl="close" aria-label="Close personalization">✕</button></div>' +
        '<p class="adl-hint">Reorder, hide or pin the dashboard cards you use. Pinned cards always sort first. Nothing is deleted — every card can be shown again.</p>' +
        '<ul class="adl-list" aria-label="Dashboard cards"></ul>' +
        '<div class="adl-foot"><button type="button" class="adl-btn" data-adl="reset">Reset to default</button>' +
        '<button type="button" class="adl-btn adl-primary" data-adl="close">Done</button></div></div>';
      host.addEventListener("click", onPanelClick);
      document.body.appendChild(host);
    }
    var previous = document.activeElement;
    host.__previous = previous;
    host.setAttribute("data-open", "true");
    host.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeydown, true);
    renderPanel();
    var first = host.querySelector(".adl-close");
    if (first) first.focus();
    return true;
  }

  function close() {
    var host = panel();
    if (!host || host.getAttribute("data-open") !== "true") return false;
    document.removeEventListener("keydown", onKeydown, true);
    host.setAttribute("data-open", "false");
    host.setAttribute("aria-hidden", "true");
    var previous = host.__previous;
    if (previous && typeof previous.focus === "function" && previous.isConnected) {
      try { previous.focus({ preventScroll: true }); } catch { previous.focus(); }
    }
    return true;
  }

  /** Layout-independent visibility, so the trap also works before paint. */
  function isVisible(el) {
    if (!el || el.disabled) return false;
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      if (node !== el && node.getAttribute("aria-hidden") === "true") return false;
    }
    try {
      var style = window.getComputedStyle(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    } catch {}
    return true;
  }

  /** Escape dismisses; Tab is contained inside the dialog. */
  function onKeydown(event) {
    var host = panel();
    if (!host || host.getAttribute("data-open") !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    var dialog = host.querySelector(".adl-dialog");
    var focusable = dialog ? Array.prototype.slice.call(dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
      .filter(isVisible) : [];
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onPanelClick(event) {
    var button = event.target.closest ? event.target.closest("[data-adl]") : null;
    if (!button) return;
    var action = button.getAttribute("data-adl");
    if (action === "close") return void close();
    if (action === "reset") return void reset();
    var row = button.closest(".adl-row");
    var key = row && row.getAttribute("data-key");
    if (!key) return;
    if (action === "up") move(key, -1);
    else if (action === "down") move(key, 1);
    else if (action === "pin") pin(key);
    else if (action === "toggle") toggle(key);
    renderPanel();
  }

  /* ------------------------------------------------------------- lifecycle -- */

  var scheduled = 0;
  function schedule() {
    if (scheduled) return;
    scheduled = 1;
    var run = function () {
      scheduled = 0;
      apply();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 60);
  }

  function boot() {
    if (!mainEl()) return;
    apply();
    if (typeof MutationObserver !== "function") return;
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var target = records[i].target;
        if (target && target.nodeType === 1 && !target.closest) return schedule();
      }
      // New cards in the stack (route re-render) need the preference re-applied.
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.AriseDashboardLayout = {
    storageKey: STORAGE_KEY,
    cards: function () {
      var prefs = state();
      return prefs.cards.map(function (card) {
        return { key: card.key, label: card.label, node: card.node, hidden: prefs.hidden.indexOf(card.key) !== -1, pinned: prefs.pinned.indexOf(card.key) !== -1, nodeIndex: card.nodeIndex };
      });
    },
    move: move,
    toggle: toggle,
    pin: pin,
    reset: reset,
    apply: apply,
    open: open,
    close: close
  };

  // The loader may inject this module before DOMContentLoaded; when the
  // dashboard shell is already present, apply immediately so a saved layout is
  // never shown in author order for a frame.
  if (document.getElementById(MAIN_ID)) boot();
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
