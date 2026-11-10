/* ==========================================================================
   Knowledge assistant (src/knowledge-assistant.js)
   --------------------------------------------------------------------------
   Notes & Personal Wiki already do the hard parts: folders, tags, pins,
   revision dates, markdown preview, [[wiki links]], backlinks, full-text
   search and four export formats. What was missing was everything *between*
   the two panes:

     - no way to know one note is a near-duplicate copy of another;
     - no way to jump from a note to the notes/wiki pages that mention its
       title (search only covers the Notes list and the Wiki sidebar);
     - no way to see which [[wiki links]] point at a page that does not exist
       until you click one;
     - no view of what was edited last across both stores;
     - the wiki links panel was only reachable while the Wiki tab was open.

   This module reads the two existing stores and adds those views. It is a
   read-only lens with two deliberate exceptions, both user-confirmed:
     1. "Create page" on a dangling wiki link calls the wiki widget's own
        new-page action (a real page, not a synthetic one);
     2. nothing else is ever written — no note content, no schema change, no
        second notes store.

   Public API (window.AriseKnowledge)
   ----------------------------------
   scan()                      -> { notes, wiki, links, related, duplicates, health }
   relatedTo({ store, id })    -> [{ store, id, title, reason, score }]
   open() / close()            -> the Knowledge health panel
   refresh()
   storageKey                  -> "arise-knowledge-ui-v1" (panel state only)
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseKnowledge) return;

  var NOTES_KEY = "arise-notes-app-v1";
  var WIKI_KEY = "arise-personal-wiki-v1";
  var UI_KEY = "arise-knowledge-ui-v1";
  var DUP_THRESHOLD = 0.7;
  var MAX_RELATED = 5;
  var SNIPPET = 120;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function readStore(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === "") return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return String(value == null ? "" : value);
  }

  /* ------------------------------------------------------------- sources -- */

  // Titles/slugs are the only stable identifiers both stores agree on.
  function slug(value) {
    return text(value)
      .toLowerCase()
      .replace(/[`*_>#\[\]()]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function notesFrom(store) {
    return asArray(store && store.notes)
      .filter(function (note) { return note && !note.deletedAt; })
      .map(function (note) {
        return {
          store: "notes",
          id: text(note.id),
          title: text(note.title) || "Untitled Note",
          body: text(note.content),
          tags: asArray(note.tags).map(text).filter(Boolean),
          folderId: note.folderId == null ? null : note.folderId,
          pinned: !!note.pinned,
          updatedAt: text(note.updatedAt || note.createdAt)
        };
      })
      .filter(function (note) { return !!note.id; });
  }

  function wikiPagesFrom(store) {
    return asArray(store && store.pages).map(function (page) {
      return {
        store: "wiki",
        id: text(page.id),
        title: text(page.title) || "Untitled Page",
        body: text(page.content),
        categoryId: page.categoryId == null ? null : page.categoryId,
        pinned: !!page.pinned,
        updatedAt: text(page.updatedAt || page.createdAt)
      };
    }).filter(function (page) { return !!page.id; });
  }

  function foldersOf(store) {
    var map = {};
    asArray(store && store.folders).forEach(function (folder) {
      if (folder && folder.id) map[text(folder.id)] = text(folder.name) || "Untitled folder";
    });
    return map;
  }

  function categoriesOf(store) {
    var map = {};
    asArray(store && store.categories).forEach(function (category) {
      if (category && category.id) map[text(category.id)] = text(category.name) || "Untitled category";
    });
    return map;
  }

  /* -------------------------------------------------------------- analysis -- */

  // The wiki's own link syntax: [[Title]] or [[Title|Label]], ignoring code.
  var WIKI_LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  function wikiLinks(body) {
    var stripped = text(body).replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    var out = [];
    var match;
    WIKI_LINK.lastIndex = 0;
    while ((match = WIKI_LINK.exec(stripped))) out.push({ title: text(match[1]).trim(), label: text(match[2] || match[1]).trim() });
    return out;
  }

  function words(body) {
    var found = slug(body).split(" ").filter(function (token) { return token.length > 2; });
    var seen = {};
    return found.filter(function (token) {
      if (seen[token]) return false;
      seen[token] = true;
      return true;
    });
  }

  function jaccard(aTitle, aBody, bTitle, bBody) {
    var a = {}, b = {};
    words(aTitle + " " + aTitle + " " + aBody).forEach(function (word) { a[word] = 1; });
    words(bTitle + " " + bTitle + " " + bBody).forEach(function (word) { b[word] = 1; });
    var keys = Object.keys(a), inter = 0;
    if (!keys.length) return 0;
    keys.forEach(function (word) { if (b[word]) inter += 1; });
    var union = keys.length + Object.keys(b).length - inter;
    return union ? inter / union : 0;
  }

  // A note's title showing up in another entry is the strongest signal, so it
  // is scored above shared vocabulary: that is how people actually link notes.
  function scan() {
    var notesStore = readStore(NOTES_KEY);
    var wikiStore = readStore(WIKI_KEY);
    var notes = notesFrom(notesStore);
    var wiki = wikiPagesFrom(wikiStore);
    var folders = foldersOf(notesStore);
    var categories = categoriesOf(wikiStore);
    var entries = notes.concat(wiki);

    // Links are resolved across BOTH stores: a wiki page may deliberately point
    // at a note ("[[Graphs Revision]]") and that is not a broken link.
    var entryByTitle = {};
    // Wiki pages win when a note and a page share a title, because that is the
    // store the link syntax belongs to.
    // First entry wins, so a duplicated title always resolves to the same
    // original instead of flipping between copies (duplicates are reported
    // separately rather than silently merged).
    function index(entry) {
      var key = slug(entry.title);
      if (key && !entryByTitle[key]) entryByTitle[key] = entry;
    }
    notes.forEach(index);
    wiki.forEach(index);

    var links = [];
    entries.forEach(function (entry) {
      wikiLinks(entry.body).forEach(function (link) {
        var target = entryByTitle[slug(link.title)];
        links.push({
          from: entry.store, fromId: entry.id, fromTitle: entry.title,
          title: link.title, label: link.label,
          exists: !!target,
          targetId: target ? target.id : null,
          targetStore: target ? target.store : null
        });
      });
    });

    var related = {};
    entries.forEach(function (entry) {
      var scored = [];
      entries.forEach(function (other) {
        if (other.store === entry.store && other.id === entry.id) return;
        var score = 0;
        var reason = "";
        var titleSlug = slug(entry.title);
        if (titleSlug && titleSlug.length > 3) {
          var mentions = other.body.toLowerCase().indexOf(entry.title.toLowerCase()) !== -1;
          if (mentions) { score = 60; reason = "mentions this title"; }
        }
        wikiLinks(other.body).forEach(function (link) {
          if (slug(link.title) === titleSlug) { score = Math.max(score, 80); reason = "links here"; }
        });
        wikiLinks(entry.body).forEach(function (link) {
          if (slug(link.title) === slug(other.title)) { score = Math.max(score, 75); reason = reason || "linked from here"; }
        });
        if (!score) {
          var similarity = jaccard(entry.title, entry.body, other.title, other.body);
          if (similarity >= DUP_THRESHOLD) { score = 40 + Math.round(similarity * 20); reason = "near-duplicate"; }
        }
        if (score) scored.push({ store: other.store, id: other.id, title: other.title, reason: reason, score: score });
      });
      scored.sort(function (a, b) { return b.score - a.score || a.title.localeCompare(b.title); });
      related[entry.store + ":" + entry.id] = scored.slice(0, MAX_RELATED);
    });

    var duplicates = [];
    for (var i = 0; i < entries.length; i++) {
      for (var j = i + 1; j < entries.length; j++) {
        var a = entries[i], b = entries[j];
        var sameTitle = slug(a.title) === slug(b.title) && slug(a.title) !== "";
        var similarity = jaccard(a.title, a.body, b.title, b.body);
        if (sameTitle || similarity >= DUP_THRESHOLD) {
          duplicates.push({
            a: { store: a.store, id: a.id, title: a.title },
            b: { store: b.store, id: b.id, title: b.title },
            similarity: Number(similarity.toFixed(2)),
            sameTitle: sameTitle
          });
        }
      }
    }
    duplicates.sort(function (x, y) { return y.similarity - x.similarity; });

    var dangling = links.filter(function (link) { return !link.exists; });
    var orphans = entries.filter(function (entry) {
      var id = entry.store + ":" + entry.id;
      var incoming = links.some(function (link) { return link.exists && link.targetId === entry.id; });
      var outgoing = links.some(function (link) { return link.fromId === entry.id; });
      var backlinks = asArray(related[id]).length > 0;
      return !incoming && !outgoing && !backlinks;
    }).map(function (entry) {
      return {
        store: entry.store, id: entry.id, title: entry.title,
        folder: entry.store === "notes" ? (folders[entry.folderId] || null) : (categories[entry.categoryId] || null),
        updatedAt: entry.updatedAt
      };
    });

    var dated = entries.filter(function (entry) { return !!entry.updatedAt && !isNaN(new Date(entry.updatedAt).getTime()); })
      .map(function (entry) { return { store: entry.store, id: entry.id, title: entry.title, updatedAt: entry.updatedAt }; })
      .sort(function (x, y) { return new Date(y.updatedAt) - new Date(x.updatedAt); });

    return {
      notes: notes,
      wiki: wiki,
      folders: folders,
      categories: categories,
      links: links,
      danglingLinks: dangling,
      related: related,
      duplicates: duplicates,
      orphans: orphans,
      recent: dated.slice(0, 8),
      health: {
        notes: notes.length,
        wikiPages: wiki.length,
        totalLinks: links.length,
        danglingLinks: dangling.length,
        duplicates: duplicates.length,
        orphans: orphans.length,
        taggedNotes: notes.filter(function (note) { return note.tags.length > 0; }).length,
        lastEdited: dated.length ? dated[0] : null
      }
    };
  }

  function relatedTo(options) {
    var opts = options || {};
    if (!opts.store || !opts.id) return [];
    var result = scan();
    return asArray(result.related[opts.store + ":" + opts.id]);
  }

  /* ------------------------------------------------------------------- UI -- */

  var TABS = [
    ["overview", "Overview"],
    ["backlinks", "Backlinks"],
    ["links", "Broken links"],
    ["duplicates", "Duplicates"],
    ["orphans", "Weak spots"]
  ];

  function uiState() {
    var state = readStore(UI_KEY) || {};
    return { tab: TAB_IDS.indexOf(state.tab) === -1 ? "overview" : state.tab };
  }
  var TAB_IDS = TABS.map(function (pair) { return pair[0]; });

  function saveState(next) {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ version: 1, tab: next.tab })); } catch {}
  }

  var lastFocus = null;

  function host() {
    return document.getElementById("ka-panel");
  }

  function snippet(body) {
    var clean = text(body).replace(/```[\s\S]*?```/g, " ").replace(/[#*_>`[\]()]/g, " ").replace(/\s+/g, " ").trim();
    return clean.length > SNIPPET ? clean.slice(0, SNIPPET - 1).trim() + "…" : clean;
  }

  function emptyRow(message) {
    return '<p class="ka-empty">' + esc(message) + "</p>";
  }

  function entryButton(store, id, title, note) {
    return '<button type="button" class="ka-entry" data-ka-goto="' + esc(id) + '" data-ka-store="' + esc(store) + '">' +
      '<span class="ka-entry-title">' + esc(title) + "</span>" +
      (note ? '<span class="ka-entry-note">' + esc(note) + "</span>" : "") +
      "</button>";
  }

  function renderOverview(data) {
    var health = data.health;
    var html = '<div class="ka-grid">' +
      '<div class="ka-stat"><strong>' + health.notes + "</strong><span>notes</span></div>" +
      '<div class="ka-stat"><strong>' + health.wikiPages + "</strong><span>wiki pages</span></div>" +
      '<div class="ka-stat"><strong>' + health.totalLinks + "</strong><span>wiki links</span></div>" +
      '<div class="ka-stat' + (health.danglingLinks ? " ka-warn" : "") + '"><strong>' + health.danglingLinks + "</strong><span>broken</span></div>" +
      '<div class="ka-stat' + (health.duplicates ? " ka-warn" : "") + '"><strong>' + health.duplicates + "</strong><span>duplicates</span></div>" +
      '<div class="ka-stat"><strong>' + health.taggedNotes + "</strong><span>tagged</span></div>" +
      "</div>";
    html += '<h4 class="ka-h">Recently edited</h4>';
    html += data.recent.length ? '<div class="ka-list">' + data.recent.map(function (entry) {
      return entryButton(entry.store, entry.id, entry.title,
        new Date(entry.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    }).join("") + "</div>" : emptyRow("Nothing saved yet — write a note or a wiki page first.");
    html += '<p class="ka-hint">This view only reads the notes and wiki stores. Nothing here rewrites your content.</p>';
    return html;
  }

  function renderBacklinks(data) {
    var seenTitle = {};
    var linked = data.notes.concat(data.wiki).filter(function (entry) {
      var key = slug(entry.title);
      if (seenTitle[key]) return false; // one row per title; copies are reported under Duplicates
      var items = data.related[entry.store + ":" + entry.id];
      if (!items.some(function (item) { return item.reason !== "near-duplicate"; })) return false;
      seenTitle[key] = true;
      return true;
    });
    if (!linked.length) return emptyRow("No cross-references yet. Mention a note title inside a wiki page, or use [[Page Title]] to link pages.");
    return linked.map(function (entry) {
      var items = data.related[entry.store + ":" + entry.id].filter(function (item) { return item.reason !== "near-duplicate"; });
      return '<section class="ka-block"><h4 class="ka-h">' + esc(entry.title) + " <span class=\"ka-tag\">" + esc(entry.store) + "</span></h4>" +
        '<div class="ka-list">' + items.map(function (item) {
          return entryButton(item.store, item.id, item.title, item.reason);
        }).join("") + "</div></section>";
    }).join("");
  }

  function renderLinks(data) {
    if (!data.danglingLinks.length) return emptyRow("Every [[wiki link]] points at a page that exists.");
    return data.danglingLinks.map(function (link) {
      return '<div class="ka-row"><div class="ka-row-main"><span class="ka-entry-title">' + esc(link.title) + "</span>" +
        '<span class="ka-entry-note">linked from ' + esc(link.fromTitle) + " (" + esc(link.from) + ")</span></div>" +
        '<button type="button" class="ka-btn" data-ka-create="' + esc(link.title) + '">Create page</button></div>';
    }).join("");
  }

  function renderDuplicates(data) {
    if (!data.duplicates.length) return emptyRow("No duplicated titles or near-identical pages found.");
    return data.duplicates.map(function (pair) {
      return '<div class="ka-row"><div class="ka-row-main"><span class="ka-entry-title">' + esc(pair.a.title) + " ↔ " + esc(pair.b.title) + "</span>" +
        '<span class="ka-entry-note">' + (pair.sameTitle ? "same title" : "similar wording") + " · " + Math.round(pair.similarity * 100) + "% overlap · " +
        esc(pair.a.store) + " / " + esc(pair.b.store) + "</span></div>" +
        '<div class="ka-row-actions">' + entryButton(pair.a.store, pair.a.id, "Open A") + entryButton(pair.b.store, pair.b.id, "Open B") + "</div></div>";
    }).join("");
  }

  function renderOrphans(data) {
    if (!data.orphans.length) return emptyRow("Every note and page is reachable from at least one other entry.");
    return data.orphans.map(function (entry) {
      return entryButton(entry.store, entry.id, entry.title, [entry.folder, entry.updatedAt ? "edited " + new Date(entry.updatedAt).toLocaleDateString() : ""].filter(Boolean).join(" · ") || "no links in or out");
    }).join("");
  }

  function render() {
    var panel = host();
    if (!panel) return;
    var data = scan();
    var state = uiState();
    var body = panel.querySelector(".ka-body");
    if (body) {
      body.innerHTML = state.tab === "backlinks" ? renderBacklinks(data)
        : state.tab === "links" ? renderLinks(data)
        : state.tab === "duplicates" ? renderDuplicates(data)
        : state.tab === "orphans" ? renderOrphans(data)
        : renderOverview(data);
    }
    Array.prototype.forEach.call(panel.querySelectorAll("[data-ka-tab]"), function (tab) {
      var active = tab.getAttribute("data-ka-tab") === state.tab;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.setAttribute("data-active", active ? "true" : "false");
    });
    var status = panel.querySelector(".ka-status");
    if (status) {
      status.textContent = data.health.danglingLinks + " broken · " + data.health.duplicates + " duplicate" +
        (data.health.duplicates === 1 ? "" : "s") + " · " + data.health.orphans + " weak";
    }
    updateLauncher(data);
  }

  function updateLauncher(data) {
    var launcher = document.getElementById("ka-launcher");
    if (!launcher) return;
    var problems = data ? data.health.danglingLinks + data.health.duplicates : 0;
    var badge = launcher.querySelector(".ka-badge");
    if (badge) {
      badge.textContent = problems > 99 ? "99+" : String(problems);
      badge.hidden = problems === 0;
    }
    var label = "Open knowledge health" + (problems ? " — " + problems + " issue" + (problems === 1 ? "" : "s") : "");
    if (launcher.getAttribute("aria-label") !== label) launcher.setAttribute("aria-label", label);
  }

  function ensureLauncher() {
    if (document.getElementById("ka-launcher") || !document.body) return;
    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "ka-launcher";
    launcher.className = "ka-launcher";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.innerHTML = '<span aria-hidden="true">🧭</span><span class="ka-badge" hidden>0</span>';
    launcher.addEventListener("click", open);
    document.body.appendChild(launcher);
    try { updateLauncher(scan()); } catch {}
  }

  function open() {
    var panel = host();
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ka-panel";
      panel.className = "ka-overlay";
      panel.setAttribute("data-open", "false");
      panel.setAttribute("aria-hidden", "true");
      panel.innerHTML =
        '<div class="ka-dialog" role="dialog" aria-modal="true" aria-labelledby="ka-title">' +
        '<div class="ka-head"><div><h2 id="ka-title">Knowledge health</h2>' +
        '<p class="ka-status" role="status"></p></div>' +
        '<button type="button" class="ka-btn ka-close" data-ka-action="close" aria-label="Close knowledge health">✕</button></div>' +
        '<div class="ka-tabs" role="tablist" aria-label="Knowledge views">' +
        TABS.map(function (pair) {
          return '<button type="button" role="tab" class="ka-tab" data-ka-tab="' + pair[0] + '" aria-selected="false" aria-controls="ka-body">' + pair[1] + "</button>";
        }).join("") + "</div>" +
        '<div class="ka-body" id="ka-body" role="tabpanel" tabindex="0"></div></div>';
      panel.addEventListener("click", onClick);
      document.body.appendChild(panel);
    }
    lastFocus = document.activeElement;
    panel.setAttribute("data-open", "true");
    panel.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeydown, true);
    render();
    var closeBtn = panel.querySelector(".ka-close");
    if (closeBtn) closeBtn.focus();
    return true;
  }

  function close() {
    var panel = host();
    if (!panel || panel.getAttribute("data-open") !== "true") return false;
    document.removeEventListener("keydown", onKeydown, true);
    panel.setAttribute("data-open", "false");
    panel.setAttribute("aria-hidden", "true");
    // Restoring focus into the now-hidden dialog would strand the keyboard
    // user, so fall back to the launcher that opened the panel.
    var previous = lastFocus;
    lastFocus = null;
    if (previous && typeof previous.focus === "function" && previous.isConnected && !panel.contains(previous) && isVisible(previous)) {
      try { previous.focus({ preventScroll: true }); return true; } catch { try { previous.focus(); return true; } catch {} }
    }
    var launcher = document.getElementById("ka-launcher");
    if (launcher && typeof launcher.focus === "function") launcher.focus();
    return true;
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      if (node !== el && node.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  }

  function onKeydown(event) {
    var panel = host();
    if (!panel || panel.getAttribute("data-open") !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      var dialog = panel.querySelector(".ka-dialog");
      var focusable = dialog ? Array.prototype.slice.call(dialog.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")).filter(isVisible) : [];
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  // Widgets are the only writers of their own stores, so re-use their actions
  // instead of duplicating a selector or a storage write here.
  function clickIn(widgetSelector, selector) {
    var root = document.querySelector(widgetSelector);
    var target = root && root.querySelector(selector);
    if (!target) return false;
    target.click();
    return true;
  }

  // Only ever click the entry that matches the id we were asked for. Falling
  // back to "the first item in the list" would silently open the wrong note.
  function byId(selector, id) {
    var safe = String(id).replace(/["\\]/g, "");
    return document.querySelector(selector + '[data-id="' + safe + '"]');
  }

  function goToEntry(store, id) {
    if (store === "wiki") {
      var page = byId(".pw-page-item", id) || byId(".pw-pinned-item", id);
      if (!page) return false;
      page.click();
      return true;
    }
    var note = byId(".na-note-item", id);
    if (!note) return false;
    note.click();
    return true;
  }

  function onClick(event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-ka-action], [data-ka-tab], [data-ka-goto], [data-ka-create]") : null;
    if (!target) return;
    var action = target.getAttribute("data-ka-action");
    if (action === "close") { close(); return; }
    var tab = target.getAttribute("data-ka-tab");
    if (tab) {
      var state = uiState();
      state.tab = tab;
      saveState(state);
      render();
      var bodyEl = host().querySelector(".ka-body");
      if (bodyEl) bodyEl.focus();
      return;
    }
    var gotoId = target.getAttribute("data-ka-goto");
    if (gotoId) {
      var store = target.getAttribute("data-ka-store");
      var jumped = goToEntry(store, gotoId);
      if (jumped) { close(); return; }
      // The widget may be showing its own cached state; say so instead of
      // opening an unrelated note behind the user's back.
      var live = host() && host().querySelector(".ka-status");
      if (live) live.textContent = "Open the " + (store === "wiki" ? "Wiki" : "Notes") + " tab to load that entry.";
      return;
    }
    var create = target.getAttribute("data-ka-create");
    if (create) {
      // The wiki widget owns page creation; ask it to open a blank page for
      // the user rather than writing a page record ourselves.
      var opened = clickIn(".pw-wrap", "[data-action='new-page']");
      var status = host() && host().querySelector(".ka-status");
      if (!opened && status) status.textContent = "Open the Wiki tab to create “" + create + "”.";
      else if (status) status.textContent = "New page started — title it “" + create + "” to satisfy the link.";
    }
  }

  function refresh() {
    try { ensureLauncher(); } catch {}
    if (host() && host().getAttribute("data-open") === "true") render();
    else { try { updateLauncher(scan()); } catch {} }
  }

  /* --------------------------------------------------------------- wiring -- */

  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      refresh();
    }, 260);
  }

  function boot() {
    ensureLauncher();
    refresh();
    if (typeof MutationObserver === "function" && document.body) {
      var observer = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var node = records[i].target;
          if (!node || !node.closest) continue;
          if (node.closest("#ka-launcher, #ka-panel, #anc-launcher, #anc-panel")) continue;
          schedule();
          return;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("storage", schedule);
  }

  window.AriseKnowledge = {
    scan: scan,
    relatedTo: relatedTo,
    open: open,
    close: close,
    refresh: refresh,
    storageKey: UI_KEY
  };

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
