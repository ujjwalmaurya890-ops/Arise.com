/* ==========================================================================
   Backup integrity report (src/backup-integrity.js)
   --------------------------------------------------------------------------
   Restoring a backup is the one operation that can destroy real progress, and
   the only question the restore flow asked before writing anything was
   window.confirm("… belongs to you? Restore its matching stores?"). It could not
   say what was inside the file, how much of the workspace it would replace, or
   whether the file was the one exported here — a truncated download or a
   hand-edited JSON file looked exactly like a valid one until the restore had
   already started.

   This module inspects a parsed backup *before* the confirmation and reports:

     - what it can read (version, exported at, owner, counts of stores/records);
     - whether it contains every store this build knows about, and which of them
       would be replaced by an empty value (the silent-data-loss case);
     - whether the file is internally consistent (declared counts vs actual,
       missing store payloads, malformed entries, oversized files);
     - what it deliberately never touches (another account's data, IndexedDB
       attachment bytes it cannot verify here).

   It only reads: no store is written, and the existing confirm + before-restore
   archive in src/cloud/auth-controller.js stay exactly as they are. The report is
   meant to be shown ahead of that confirmation, not instead of it.

   Public API (window.AriseBackupIntegrity)
   ----------------------------------------
   inspect(snapshot)  -> { ok, severity, blocking[], warnings[], stats{...} }
   summarise(report)  -> plain-text lines for a confirm() prompt
   compare(current, snapshot) -> { replaced[], added[], emptied[] }
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseBackupIntegrity) return;

  var MAX_BYTES = 512 * 1024 * 1024;

  function schema() {
    var s = window.AriseSyncSchema;
    return s && Array.isArray(s.keys) ? s.keys : [];
  }

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function countRecords(stores) {
    var total = 0;
    if (!isPlainObject(stores)) return total;
    Object.keys(stores).forEach(function (name) {
      var value = stores[name];
      if (Array.isArray(value)) total += value.length;
      else if (isPlainObject(value)) total += Object.keys(value).length;
      else if (value != null) total += 1;
    });
    return total;
  }

  function isEmptyValue(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (isPlainObject(value)) return Object.keys(value).length === 0;
    if (typeof value === "string") return value.trim() === "" || value === "null" || value === "[]" || value === "{}";
    return false;
  }

  function bytesOf(snapshot) {
    try {
      return JSON.stringify(snapshot).length * 2; // UTF-16 code units, an upper bound
    } catch {
      return 0;
    }
  }

  /* ------------------------------------------------------------- compare -- */

  function compare(current, snapshot) {
    var known = schema();
    var incoming = isPlainObject(snapshot && snapshot.localStorage) ? snapshot.localStorage : {};
    var existing = isPlainObject(current) ? current : {};
    var replaced = [];
    var added = [];
    var emptied = [];
    known.forEach(function (key) {
      var has = Object.prototype.hasOwnProperty.call(incoming, key);
      if (!has) return;
      if (Object.prototype.hasOwnProperty.call(existing, key)) replaced.push(key);
      else added.push(key);
      if (isEmptyValue(incoming[key]) && !isEmptyValue(existing[key])) emptied.push(key);
    });
    return { replaced: replaced, added: added, emptied: emptied };
  }

  /* ------------------------------------------------------------- inspect -- */

  function inspect(snapshot) {
    var blocking = [];
    var warnings = [];
    var notes = [];
    var known = schema();
    var stats = {
      version: null,
      exportedAt: null,
      owner: null,
      stores: 0,
      knownStores: 0,
      unknownStores: [],
      missingStores: [],
      records: 0,
      attachments: 0,
      attachmentBytes: 0,
      malformedDatabases: 0,
      missingBlobs: 0,
      bytes: 0,
      emptyStores: []
    };

    if (!isPlainObject(snapshot)) {
      return { ok: false, severity: "error", blocking: ["This file is not a readable Arise backup."], warnings: [], notes: [], stats: stats };
    }

    stats.bytes = bytesOf(snapshot);
    if (stats.bytes > MAX_BYTES) blocking.push("This backup is larger than the 512 MB limit and cannot be restored.");

    if (!isPlainObject(snapshot.localStorage)) blocking.push("The backup has no store data (localStorage section).");

    if (!Array.isArray(snapshot.indexedDB)) {
      warnings.push("The backup does not list attachment databases. Files attached to notes or projects may be missing.");
    } else {
      snapshot.indexedDB.forEach(function (database) {
        if (!isPlainObject(database) || typeof database.name !== "string" || (database.stores != null && !isPlainObject(database.stores))) {
          stats.malformedDatabases += 1;
          return;
        }
        var stores = isPlainObject(database.stores) ? database.stores : {};
        Object.keys(stores).forEach(function (storeName) {
          var contents = stores[storeName];
          var records = contents && contents.records;
          if (!Array.isArray(records)) {
            warnings.push("Attachment store " + database.name + "/" + storeName + " has no readable records.");
            return;
          }
          records.forEach(function (entry) {
            stats.attachments += 1;
            var blob = entry && entry.value && entry.value.blob;
            if (!blob || typeof blob !== "object") {
              stats.missingBlobs += 1;
            } else if (typeof blob.data === "string") {
              stats.attachmentBytes += Math.round((blob.data.length * 3) / 4);
            }
          });
        });
      });
    }

    if (stats.missingBlobs) {
      warnings.push(stats.missingBlobs + " attachment record" + (stats.missingBlobs === 1 ? " has" : "s have") +
        " no file bytes and cannot be restored from this file.");
    }
    if (stats.malformedDatabases) {
      warnings.push(stats.malformedDatabases + " attachment database entr" + (stats.malformedDatabases === 1 ? "y is" : "ies are") +
        " malformed and will be skipped.");
    }

    var meta = isPlainObject(snapshot.meta) ? snapshot.meta : null;
    if (meta) {
      stats.version = meta.version == null ? null : String(meta.version);
      stats.exportedAt = typeof meta.exportedAt === "string" ? meta.exportedAt : null;
      stats.owner = typeof meta.ownerUid === "string" ? meta.ownerUid : null;
      if (!meta.ownerUid) {
        notes.push("This file does not name an owner, so it is a legacy export. The account must confirm ownership before it is restored.");
      }
      if (typeof meta.counts === "object" && meta.counts) {
        // A truncated download keeps its header but loses stores: compare.
        if (typeof meta.counts.localStorage === "number" && isPlainObject(snapshot.localStorage)) {
          var actualStores = Object.keys(snapshot.localStorage).filter(function (name) { return !isEmptyValue(snapshot.localStorage[name]); }).length;
          if (meta.counts.localStorage !== actualStores) {
            blocking.push("The backup says it contains " + meta.counts.localStorage + " stores but only " + actualStores +
              " are present. The file is incomplete — export it again rather than restoring it.");
          }
        }
      }
    } else {
      notes.push("This file has no metadata header; export time cannot be verified and the account must confirm ownership before it is restored.");
    }

    if (isPlainObject(snapshot.localStorage)) {
      var incoming = snapshot.localStorage;
      var names = Object.keys(incoming);
      stats.stores = names.length;
      names.forEach(function (key) {
        if (known.indexOf(key) === -1) stats.unknownStores.push(key);
        if (isEmptyValue(incoming[key])) stats.emptyStores.push(key);
      });
      stats.records = countRecords(incoming);
      stats.knownStores = names.filter(function (key) { return known.indexOf(key) !== -1; }).length;
      stats.missingStores = known.filter(function (key) { return names.indexOf(key) === -1; });
      if (stats.emptyStores.length) {
        warnings.push(stats.emptyStores.length + " store" + (stats.emptyStores.length === 1 ? " is" : "s are") +
          " empty in this backup (" + stats.emptyStores.slice(0, 4).join(", ") +
          (stats.emptyStores.length > 4 ? ", …" : "") + "). Restoring will replace what you have with nothing.");
      }
      if (stats.unknownStores.length) {
        notes.push(stats.unknownStores.length + " store" + (stats.unknownStores.length === 1 ? " is" : "s are") +
          " not part of this build's audited schema and will be ignored (" + stats.unknownStores.slice(0, 4).join(", ") +
          (stats.unknownStores.length > 4 ? ", …" : "") + ").");
      }
      if (!stats.stores) blocking.push("The backup contains no stores.");
    }

    var severity = blocking.length ? "error" : (warnings.length ? "warning" : "ok");
    return {
      ok: blocking.length === 0,
      severity: severity,
      blocking: blocking,
      warnings: warnings,
      notes: notes,
      stats: stats
    };
  }

  function summarise(report) {
    if (!report) return [];
    var lines = [];
    var s = report.stats;
    lines.push(s.knownStores + " of " + schema().length + " audited stores · " + s.records + " records" +
      (s.attachments ? " · " + s.attachments + " attachment" + (s.attachments === 1 ? "" : "s") : ""));
    if (s.exportedAt) lines.push("Exported " + s.exportedAt);
    if (s.owner) lines.push("Owned by account " + s.owner.slice(0, 8) + "…");
    report.blocking.forEach(function (line) { lines.push("STOP: " + line); });
    report.warnings.forEach(function (line) { lines.push("Careful: " + line); });
    return lines;
  }

  /* ------------------------------------------------------------------- UI -- */

  var CARD_SELECTOR = ".bkc-wrap, [data-backup-center], #backup-center";
  var mounted = null;
  var lastReport = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function listHtml(items, tone) {
    if (!items || !items.length) return "";
    return '<ul class="bki-list" data-tone="' + tone + '">' + items.map(function (line) {
      return "<li>" + escapeHtml(line) + "</li>";
    }).join("") + "</ul>";
  }

  function reportHtml(report, name) {
    var s = report.stats;
    var chips = [
      s.knownStores + "/" + schema().length + " stores",
      s.records + " records",
      s.attachments + " attachments",
      Math.max(1, Math.round(s.bytes / 1024)) + " KB"
    ];
    return '<div class="bki-body"><h3 class="bki-title">Backup check — ' + escapeHtml(name || "selected file") + "</h3>" +
      '<div class="bki-stats">' + chips.map(function (chip) {
        return '<span class="bki-stat">' + escapeHtml(chip) + "</span>";
      }).join("") + "</div>" +
      listHtml(report.blocking, "error") +
      listHtml(report.warnings, "warning") +
      listHtml(report.notes, "note") +
      '<p class="bki-foot">Nothing has been restored. The restore still asks for your confirmation and keeps a before-restore copy.</p></div>';
  }

  function card() {
    return document.querySelector(CARD_SELECTOR);
  }

  function clear() {
    lastReport = null;
    if (mounted && mounted.parentNode) mounted.parentNode.removeChild(mounted);
    mounted = null;
    return true;
  }

  // Renders (or replaces) the report inside the existing backup card. Kept
  // separate from inspect() so a caller can inspect without touching the DOM.
  function show(report, name) {
    var host = card();
    if (!host) return false;
    lastReport = report;
    if (!mounted || !mounted.isConnected) {
      mounted = document.createElement("section");
      mounted.id = "bki-report";
      mounted.className = "bki-report";
      mounted.setAttribute("role", "status");
      mounted.setAttribute("aria-live", "polite");
    }
    mounted.setAttribute("data-severity", report.severity);
    mounted.innerHTML = reportHtml(report, name);
    // Above the restore controls, below the card heading: append as the first
    // child that is not the heading itself.
    var heading = host.querySelector("h1, h2");
    if (mounted.parentElement !== host) {
      if (heading && heading.parentElement === host) host.insertBefore(mounted, heading.nextSibling);
      else host.insertBefore(mounted, host.firstChild || null);
    }
    return true;
  }

  window.AriseBackupIntegrity = {
    inspect: inspect,
    summarise: summarise,
    compare: compare,
    maxBytes: MAX_BYTES,
    schemaKeys: schema,
    show: show,
    clear: clear,
    last: function () { return lastReport; }
  };
})();
