/* ==========================================================================
   Accessible-name patch (src/a11y-label-patch.js)
   --------------------------------------------------------------------------
   PROBLEM
   An audit of the actually-rendered widget DOM (every src/*.js widget mounted
   in jsdom with a valid store) found 22 interactive controls with no
   accessible name: text inputs whose only hint was a `placeholder`, and
   `type="file"` inputs driven by a separate visible button.

   A placeholder is not a label:
     - it disappears as soon as the user types;
     - several screen readers do not announce it as the field name;
     - it usually fails WCAG 2.2 AA 1.3.1/3.3.2 (name, role, value).
   A hidden file input with no name is a control that announces nothing when it
   receives focus, and it is still focusable.

   WHAT THIS DOES
   Fixes those two patterns in the rendered DOM, additively:
     1. a control with no name whose placeholder carries the question gets that
        placeholder as aria-label ("Company name");
     2. a focusable input with no name and no placeholder gets a name derived
        from its `name`/`data-role`/`data-action` attribute, de-kebab-cased;
     3. a hidden file input gets the name of the button that opens it.

   It never overwrites an existing accessible name, never touches disabled,
   readonly or aria-hidden controls, and never changes layout, ids or JS
   behaviour. Every rule is idempotent and marked on the element, so repeated
   mutation bursts are free.

   WHY A DOM PATCH
   The same reason src/a11y-color-patch.js and src/a11y-toast-patch.js exist:
   ~100 independently authored widget files. A single observer keeps the fix
   correct for markup rendered later, and a per-widget edit would have to be
   repeated (and re-verified) in each one.

   WIRING
   Loaded from index.html's SCRIPTS list, after the other a11y patches. It uses
   the shared __ARISE_MUTATION_BUS__ and falls back to its own observer.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__ARISE_A11Y_LABEL_PATCH__) return;
  window.__ARISE_A11Y_LABEL_PATCH__ = true;

  var MARK = "data-uxa-name";
  var CONTROL_SELECTOR =
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),textarea,select";
  var FILE_SELECTOR = "input[type=file]";

  /**
   * Sentence-case a machine attribute ("bunk-custom-skip" -> "Bunk custom
   * skip"). Placeholder text is NOT passed through this: it is already
   * human-authored prose and re-casing it mangles abbreviations
   * ("e.g." -> "E G", "SBI FD" -> "Sbi Fd").
   */
  function humanise(raw) {
    var text = String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_\-.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** True when the element already exposes a name to assistive technology. */
  function hasAccessibleName(el) {
    if (!el) return true;
    if (el.getAttribute("aria-label")) return true;
    if (el.getAttribute("aria-labelledby")) {
      var ids = el.getAttribute("aria-labelledby").split(/\s+/);
      for (var i = 0; i < ids.length; i++) {
        var target = ids[i] && document.getElementById(ids[i]);
        if (target && (target.textContent || "").trim()) return true;
      }
    }
    if (el.getAttribute("title")) return true;
    if (el.labels && el.labels.length) {
      for (var j = 0; j < el.labels.length; j++) {
        if ((el.labels[j].textContent || "").trim()) return true;
      }
    }
    return false;
  }

  function isExcluded(el) {
    if (el.disabled || el.readOnly) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (el.closest && el.closest("[aria-hidden='true']")) return true;
    return false;
  }

  /** Import/restore verbs that identify the control which opens a file picker. */
  var FILE_TRIGGER_RE = /import|upload|choose file|select file|browse|restore|attach|pick file/i;

  /**
   * Name for a hidden file input, taken from the control that actually opens
   * the picker. A blind "nearest following button" is wrong - it would label
   * the import input after an unrelated "+ Add semester" button - so candidates
   * are scored by their verb, and an accept-type fallback is used when the
   * markup gives no reliable hint.
   */
  function fileInputLabel(el) {
    // 1. An explicit wrapping label wins.
    var wrapper = el.closest ? el.closest("label") : null;
    if (wrapper) {
      var wrapperText = (wrapper.textContent || "").trim();
      if (wrapperText) return wrapperText;
    }
    // 2. Scan the surrounding form/panel for a button with a file-picker verb.
    var scope = (el.closest && (el.closest("form") || el.closest("[class]") || el.parentElement)) || el.parentElement;
    if (scope) {
      var candidates = scope.querySelectorAll("button,[role=button],label");
      for (var i = 0; i < candidates.length; i++) {
        var text = (candidates[i].getAttribute("aria-label") || candidates[i].textContent || "").trim();
        if (text && FILE_TRIGGER_RE.test(text)) return humanise(text.replace(/\u2026|\.\.\.$/, ""));
      }
    }
    // 3. Derive from what the picker actually accepts.
    var accept = (el.getAttribute("accept") || "").toLowerCase();
    if (accept.indexOf("zip") !== -1) return "Import backup archive";
    if (accept.indexOf("json") !== -1) return "Import backup data";
    if (accept.indexOf("image") !== -1) return "Choose image file";
    if (accept.indexOf("pdf") !== -1) return "Choose PDF file";
    return "Choose file";
  }

  /**
   * Visible text of a label that visually belongs to this control but is not
   * programmatically associated (no `for`, no wrapping). Only unambiguous
   * cases are accepted: the immediately preceding sibling label, or the single
   * label inside the control's own container. A sibling label for a different
   * field in the same form group is never borrowed.
   */
  var FIELD_TAGS = { INPUT: 1, SELECT: 1, TEXTAREA: 1 };

  function nearbyLabelText(el) {
    // Only the immediately preceding element is considered, and only a label
    // that is the *first* thing in the control's own inline group qualifies.
    // If another field sits between them, the label belongs to that field, and
    // borrowing it would mislabel this one.
    var previous = el.previousElementSibling;
    if (previous && previous.tagName === "LABEL") {
      var before = previous.previousElementSibling;
      if (!before || !FIELD_TAGS[before.tagName]) return (previous.textContent || "").trim();
    }
    var parent = el.parentElement;
    if (parent) {
      var labels = parent.querySelectorAll(":scope > label");
      var fields = parent.querySelectorAll(":scope > input, :scope > select, :scope > textarea");
      if (labels.length === 1 && fields.length === 1) return (labels[0].textContent || "").trim();
    }
    return "";
  }

  /** A placeholder that only shows an example is an example, not a name. */
  function isExampleOnly(text) {
    return /^(?:e\.?g\.?|for example|example|i\.?e\.?)\b/i.test(String(text || "").trim());
  }

  function nameFor(el) {
    // 1. A visible label that visually belongs to this control beats a
    //    placeholder: the label is the real question, the placeholder is a hint.
    var nearby = nearbyLabelText(el);
    if (nearby) return humanise(nearby);
    // 2. Keep the author's placeholder prose and casing; only drop a trailing
    //    ellipsis, and never use a bare "e.g. ..." example as the field name.
    var placeholder = (el.getAttribute("placeholder") || "").replace(/\u2026|\.\.\.$/, "").trim();
    if (placeholder && !isExampleOnly(placeholder)) return placeholder;
    // 3. Fall back to the semantic attribute the widget already authorises on.
    var raw = el.getAttribute("name") || el.getAttribute("data-role") || el.getAttribute("data-action") || "";
    return raw ? humanise(raw) : "";
  }

  function labelControl(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.hasAttribute(MARK)) return;
    if (isExcluded(el)) return;
    if (hasAccessibleName(el)) {
      el.setAttribute(MARK, "kept");
      return;
    }
    var name = el.matches && el.matches(FILE_SELECTOR) ? fileInputLabel(el) : nameFor(el);
    if (!name) return; // leave it alone rather than invent meaningless text
    el.setAttribute("aria-label", name);
    el.setAttribute(MARK, "added");
  }

  function scan(root) {
    if (!root || (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11)) return;
    var scope = root.querySelectorAll ? root : null;
    if (!scope) return;
    var controls = scope.querySelectorAll(CONTROL_SELECTOR);
    for (var i = 0; i < controls.length; i++) labelControl(controls[i]);
    if (root.nodeType === 1 && root.matches && root.matches(CONTROL_SELECTOR)) labelControl(root);
  }

  function boot() {
    scan(document);

    var queued = false;
    var pendingRoots = [];
    var sawBurst = false;

    function flush() {
      queued = false;
      if (document.hidden) {
        pendingRoots = [];
        sawBurst = false;
        return;
      }
      var roots = pendingRoots;
      var burst = sawBurst;
      pendingRoots = [];
      sawBurst = false;
      var bus = window.__ARISE_MUTATION_BUS__;
      function run() {
        if (burst || roots.length > 40) {
          // A big burst means many new subtrees; one scoped pass over the
          // document is cheaper than 41 overlapping subtree queries.
          scan(document);
          return;
        }
        for (var i = 0; i < roots.length; i++) {
          if (roots[i].isConnected !== false) scan(roots[i]);
        }
      }
      if (bus && bus.mute) bus.mute(run);
      else run();
    }

    function schedule() {
      if (queued) return;
      queued = true;
      setTimeout(flush, 250);
    }

    var bus = window.__ARISE_MUTATION_BUS__;
    if (bus && typeof bus.subscribe === "function") {
      bus.subscribe(function (records) {
        for (var i = 0; i < records.length; i++) {
          var record = records[i];
          if (record.type === "attributes") {
            sawBurst = true;
            continue;
          }
          var added = record.addedNodes;
          if (!added) continue;
          for (var j = 0; j < added.length; j++) {
            if (added[j] && added[j].nodeType === 1) pendingRoots.push(added[j]);
          }
        }
        if (sawBurst || pendingRoots.length) schedule();
      });
    } else if (typeof MutationObserver === "function") {
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j] && added[j].nodeType === 1) pendingRoots.push(added[j]);
          }
        }
        if (pendingRoots.length) schedule();
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // Placeholders/labels can be set after the node is inserted.
    document.addEventListener(
      "focusin",
      function (event) {
        if (event.target && event.target.nodeType === 1) labelControl(event.target);
      },
      true
    );
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // Test/debug surface: the same pure helpers the patch uses.
  window.__ARISE_A11Y_LABEL_PATCH_API__ = {
    humanise: humanise,
    nameFor: nameFor,
    hasAccessibleName: hasAccessibleName,
    scan: scan,
    labelControl: labelControl
  };
})();
