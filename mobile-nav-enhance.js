/* ═══════════════════════════════════════════════════════════════════
   ARISE · Mobile nav drawer enhance
   The off-canvas sidebar drawer (see index.html's "Sidebar fullscreen
   fix" comment for the exact selectors) only closed via tapping its
   backdrop. This adds the two gestures people actually reach for on a
   phone: Escape and a left-swipe on the open drawer. Both just click
   the existing backdrop element — no new close logic, no new state,
   so it can't drift out of sync with however the app itself decides
   the drawer is open.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__AriseMobileNavEnhance) return;
  window.__AriseMobileNavEnhance = true;

  var DRAWER_SEL = '.fixed.left-0.top-0.bottom-0.w-64.glass-strong.z-50';
  var BACKDROP_SEL = '.fixed.inset-0.bg-black\\/70.backdrop-blur-sm.z-40';

  function visible(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function closeDrawer() {
    var backdrop = document.querySelector(BACKDROP_SEL);
    if (visible(backdrop)) { backdrop.click(); return true; }
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var drawer = document.querySelector(DRAWER_SEL);
    if (visible(drawer)) closeDrawer();
  });

  var sx = 0, sy = 0, tracking = false;
  document.addEventListener('touchstart', function (e) {
    var drawer = document.querySelector(DRAWER_SEL);
    if (!visible(drawer) || !e.touches || e.touches.length !== 1 || !drawer.contains(e.target)) {
      tracking = false;
      return;
    }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy;
    /* swipe left (toward the hidden edge) closes; ignore mostly-vertical drags */
    if (dx < -64 && Math.abs(dx) > Math.abs(dy) * 1.6) closeDrawer();
  }, { passive: true });
})();
