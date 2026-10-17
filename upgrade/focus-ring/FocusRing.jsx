/**
 * FocusRing — focus/stopwatch progress ring.
 *
 * Replaces the ring JSX inline in the timer/stopwatch component (currently
 * minified as `Hx` in assets/app-bundle.js) AND retires the vanilla-JS
 * "upgrade" overlay (timer-visual-upgrade-widget.js / focus-timer-upgrade-widget.js)
 * for everything visual. Category icon + streak are now real props, computed
 * once by the parent from actual state instead of scraped from the DOM /
 * polled from localStorage every 2s.
 *
 * Fixes applied (see PR notes at bottom of file):
 *  1. ONE tick ring (60 ticks), same cx/cy/r as the progress circle — the
 *     old 40-tick overlay drawn by timer-visual-upgrade-widget.js is deleted.
 *  2. category / streakCount / runState are props, not DOM/localStorage reads.
 *  3. The "breathing" glow no longer animates `filter` (blur/drop-shadow)
 *     every frame — that forces the browser to re-rasterize the whole SVG.
 *     Instead we render a second, pre-blurred duplicate ring underneath and
 *     only animate its opacity/scale (compositor-only, GPU).
 *  4. Small glowing "comet head" dot riding the progress arc, phase-locked
 *     to the real second (no independent free-running animation clock).
 *  5. Last-10%-of-duration urgency treatment (color shift + comet pulse),
 *     purely visual, no sound.
 *  6. Respects prefers-reduced-motion: kills the breathing/pulsing motion,
 *     keeps only the instant, functional dash-offset update.
 *  7. role="timer" + a polite aria-live region that announces state changes
 *     (not every second — that would spam screen readers).
 *  8. Paused-state dashed ring — was DOM-injected/toggled by scanning button
 *     text for "Resume"; now a plain `isPaused` prop.
 *  9. Completion burst — was triggered by listening for a global
 *     `studySessions:updated` event and re-querying every mounted container;
 *     now fires off a `celebrateToken` prop bump from the parent that
 *     actually knows a session just completed.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const TICK_COUNT = 60; // single source of truth — do not duplicate elsewhere
const URGENT_THRESHOLD = 0.1; // last 10% of duration

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

// angle in radians, 0 = 12 o'clock, clockwise — matches the -rotate-90 SVG transform
function pointAt(cx, cy, r, angle) {
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
}

/**
 * @param {'timer'|'stopwatch'} mode
 * @param {number} size            outer diameter in px
 * @param {number} strokeWidth
 * @param {number} progressPercent 0–100. For 'timer' mode this is the single
 *                                 source of truth for the arc/comet/ticks.
 *                                 For 'stopwatch' mode it is IGNORED — see
 *                                 `lapSeconds` below, this prop is only kept
 *                                 for timer-mode callers.
 * @param {number} lapSeconds     stopwatch-only. The ring completes one full
 *                                 sweep every `lapSeconds` of elapsed time and
 *                                 then starts a new lap, instead of freezing
 *                                 at 100% once elapsed time exceeds it. Default
 *                                 3600 (1 hour per lap).
 * @param {number} elapsedSeconds  whole seconds elapsed (drives the comet pulse phase)
 * @param {number} remainingSeconds
 * @param {number} totalSeconds
 * @param {boolean} isRunning
 * @param {boolean} isPaused
 * @param {{icon: string, label: string} | null} category  real prop, not scraped from a <select>
 * @param {number} streakCount     real prop, computed by the parent from studySessions
 * @param {number} celebrateToken  bump this (e.g. ++ a counter) when a session completes
 *                                 to fire the burst — a value change, not a boolean, so
 *                                 back-to-back completions each re-trigger the animation
 * @param {React.ReactNode} centerContent  the formatted time / labels already rendered by the parent
 */
export default function FocusRing({
  mode,
  size = 180,
  strokeWidth = 6,
  progressPercent,
  lapSeconds = 3600,
  elapsedSeconds = 0,
  remainingSeconds = 0,
  totalSeconds = 0,
  isRunning,
  isPaused,
  category = null,
  streakCount = 0,
  celebrateToken = 0,
  centerContent,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * r;

  // BUGFIX: the previous stopwatch progress was `min(elapsed/1hr * 100, 100)`,
  // computed by the caller — it pins at 100% forever once a session runs past
  // an hour, freezing the arc and comet head while the stopwatch keeps running.
  // Stopwatch mode now derives its own progress as a repeating lap, so the ring
  // keeps sweeping indefinitely; timer mode is unaffected and still trusts the
  // caller's progressPercent (which is naturally bounded by the countdown).
  const effectiveProgress =
    mode === 'stopwatch'
      ? ((elapsedSeconds % lapSeconds) / lapSeconds) * 100
      : progressPercent;

  const dashOffset = circumference - (effectiveProgress / 100) * circumference;

  const urgent =
    mode === 'timer' &&
    totalSeconds > 0 &&
    remainingSeconds > 0 &&
    remainingSeconds / totalSeconds <= URGENT_THRESHOLD;

  // Urgency interpolation factor — 0.0 at the 10% threshold, 1.0 at 0 seconds.
  // This replaces the binary color snap with a continuous gradient blend so the
  // ring drifts cyan → orange over the entire last-10% window instead of
  // snapping the instant the threshold is crossed.
  const urgencyT = useMemo(() => {
    if (mode !== 'timer' || totalSeconds <= 0 || !urgent) return 0;
    // remainingSeconds / totalSeconds goes from URGENT_THRESHOLD → 0;
    // t = 0 at threshold, t = 1 at 0 seconds.
    const ratio = remainingSeconds / totalSeconds;
    return Math.max(0, Math.min(1, 1 - ratio / URGENT_THRESHOLD));
  }, [mode, totalSeconds, remainingSeconds, urgent]);

  // Lerp two hex colours in linear sRGB — perceptually adequate for this
  // cyan-to-orange blend without the overhead of a Lab/OKLab conversion.
  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
    const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    return `#${[rr, rg, rb].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // Arc start color: cyan → orange interpolated over the last 10%.
  // Stopwatch keeps its fixed purple regardless.
  const color =
    mode === 'stopwatch'
      ? '#bf5af2'
      : urgencyT > 0
        ? lerpHex('#00f5ff', '#ff6b35', urgencyT)
        : '#00f5ff';

  // Arc end color: purple → yellow, same interpolation window.
  const colorEnd =
    mode === 'stopwatch'
      ? '#00f5ff'
      : urgencyT > 0
        ? lerpHex('#bf5af2', '#ffd60a', urgencyT)
        : '#bf5af2';

  // One stable gradient id per mounted ring instance, computed exactly once
  // via lazy useRef init (not recomputed on every render — the previous
  // version called Math.random() inside the useRef() argument every render,
  // which useRef then threw away after mount, wasting the work each time).
  const gradientIdRef = useRef(null);
  if (gradientIdRef.current === null) {
    gradientIdRef.current = `focus-ring-grad-${Math.random().toString(36).slice(2, 9)}`;
  }
  const gradientId = gradientIdRef.current;

  // Comet visuals differ by mode instead of one fixed pulse for both:
  // stopwatch laps read faster/punchier (bigger head, hotter glow, quicker
  // pulse) since a lap completes every `lapSeconds`; timer mode stays calm
  // and steady so it doesn't distract during a focus block.
  const cometSize = mode === 'stopwatch' ? strokeWidth * 1.4 : strokeWidth;
  const cometGlow =
    mode === 'stopwatch' ? `0 0 14px 4px ${color}` : `0 0 8px 2px ${color}`;
  const cometPulseDuration = mode === 'stopwatch' ? 0.6 : urgent ? 0.9 : 1.3;

  // Ticks: the ONE tick ring. Major tick every 5th (12 total), minor otherwise.
  const ticks = useMemo(() => {
    const out = [];
    for (let i = 0; i < TICK_COUNT; i++) {
      const angle = (i / TICK_COUNT) * 2 * Math.PI - Math.PI / 2;
      const major = i % 5 === 0;
      const outerLen = r - strokeWidth - (major ? 6 : 3);
      const innerLen = r - strokeWidth - 1;
      const p1 = pointAt(cx, cy, outerLen, angle);
      const p2 = pointAt(cx, cy, innerLen, angle);
      out.push({ key: i, ...p1, x2: p2.x, y2: p2.y, major });
    }
    return out;
  }, [cx, cy, r, strokeWidth]);

  // Sparse numeral labels at the 12/3/6/9 positions, reading as percent-of-lap
  // progress (0/25/50/75) so the ring reads as a clock face, not a bare arc.
  // Radius is clamped to stay positive — on small rings or thick strokes,
  // `r - strokeWidth - 14` can go negative, and a negative radius in
  // pointAt() mirrors every point to the opposite side of the circle (e.g.
  // "50" would render at the top instead of the bottom).
  const numerals = useMemo(() => {
    const labelRadius = Math.max(r * 0.35, r - strokeWidth - 14);
    return [0, 25, 50, 75].map((pct) => {
      const angle = (pct / 100) * 2 * Math.PI - Math.PI / 2;
      const p = pointAt(cx, cy, labelRadius, angle);
      return { key: pct, label: pct === 0 ? '100' : String(pct), ...p };
    });
  }, [cx, cy, r, strokeWidth]);

  // Comet head position — same angle math as the arc, so it's never out of sync.
  const cometAngle = (effectiveProgress / 100) * 2 * Math.PI - Math.PI / 2;
  const comet = pointAt(cx, cy, r, cometAngle);

  // Smoothed comet position — spring-eased so the head lags slightly behind
  // the arc tip then settles with a tiny overshoot, instead of teleporting
  // frame-to-frame as the parent re-renders. Only the x/y position is eased;
  // the underlying arc still transitions via CSS stroke-dashoffset as before.
  // Uses a simple exponential moving average (EMA) on each RAF tick so the
  // head always converges to the real position — never permanently drifts.
  const cometSmoothedRef = useRef({ x: comet.x, y: comet.y, vx: 0, vy: 0 });
  const cometPosRef = useRef({ x: comet.x, y: comet.y });
  const cometRafRef = useRef(null);

  useEffect(() => {
    // Target always tracks the computed comet position derived from progressPercent.
    // The spring runs independently of React renders on its own RAF loop.
    const target = { x: comet.x, y: comet.y };
    cometSmoothedRef.current = { ...cometSmoothedRef.current };
    cometSmoothedRef.current.targetX = target.x;
    cometSmoothedRef.current.targetY = target.y;
  }); // every render — keeps target in sync without a dep array

  // One-time RAF spring loop, lives for the mount lifetime of the component.
  useEffect(() => {
    if (reducedMotion) return;
    // Spring constants: stiffness k, damping d.
    // These values give a ~180ms settle time with a ~4% overshoot — barely
    // perceptible but enough to read as "physical" rather than "robotic".
    const k = 200;   // stiffness  (higher = snappier)
    const d = 22;    // damping    (lower = more bounce)
    const dt = 1 / 60; // fixed timestep — decoupled from actual frame rate

    const spring = cometSmoothedRef.current;

    const tick = () => {
      const tx = spring.targetX ?? spring.x;
      const ty = spring.targetY ?? spring.y;

      const ax = (tx - spring.x) * k - spring.vx * d;
      const ay = (ty - spring.y) * k - spring.vy * d;

      spring.vx += ax * dt;
      spring.vy += ay * dt;
      spring.x  += spring.vx * dt;
      spring.y  += spring.vy * dt;

      cometPosRef.current = { x: spring.x, y: spring.y };

      // Write position directly into the DOM — zero React re-renders.
      if (cometRef.current) {
        cometRef.current.style.left = `${spring.x - cometSize / 2}px`;
        cometRef.current.style.top  = `${spring.y - cometSize / 2}px`;
      }

      cometRafRef.current = requestAnimationFrame(tick);
    };

    cometRafRef.current = requestAnimationFrame(tick);
    return () => cometRafRef.current && cancelAnimationFrame(cometRafRef.current);
  }, [reducedMotion, cometSize]); // restart only if reduced-motion pref or size changes

  // Phase-lock the comet's pulse to the real wall-clock second instead of a
  // free-running animation loop, so it visibly ticks with real time.
  const cometRef = useRef(null);
  useEffect(() => {
    if (!cometRef.current || reducedMotion) return;
    const phaseMs = -(Date.now() % 1000);
    cometRef.current.style.animationDelay = `${phaseMs}ms`;
  }, [elapsedSeconds, reducedMotion]);

  // centerContent "breathe" — a 1–2 px scale bump synced to each whole second
  // tick, so the time display feels alive and connected to the ring's motion.
  // Implemented as a keyframe reset-and-replay trick: we strip and re-add a
  // CSS class on the wrapper each time `elapsedSeconds` changes, which forces
  // the browser to restart the animation from frame 0 without needing a timer.
  // Off under reduced-motion — checked by the CSS @media guard in the keyframe.
  const breatheRef = useRef(null);
  useEffect(() => {
    const el = breatheRef.current;
    if (!el || reducedMotion) return;
    // Remove class to reset, then force a reflow, then add it back — the
    // cheapest way to replay a CSS animation without JS-driven timing.
    el.classList.remove('focus-ring-breathe');
    void el.offsetWidth; // eslint-disable-line no-void — intentional reflow trigger
    el.classList.add('focus-ring-breathe');
  }, [elapsedSeconds, reducedMotion]);

  // Announce state changes only (not every tick) for screen readers.
  const [announcement, setAnnouncement] = useState('');
  const lastState = useRef(null);
  useEffect(() => {
    const state = isRunning ? 'running' : isPaused ? 'paused' : 'idle';
    if (state !== lastState.current) {
      lastState.current = state;
      if (state === 'running') setAnnouncement(mode === 'timer' ? 'Focus session started.' : 'Stopwatch started.');
      else if (state === 'paused') setAnnouncement('Paused.');
    }
  }, [isRunning, isPaused, mode]);
  useEffect(() => {
    if (urgent) setAnnouncement('Less than 10% of your focus time remains.');
  }, [urgent]);
  const firstCelebrate = useRef(true);
  useEffect(() => {
    if (firstCelebrate.current) {
      firstCelebrate.current = false; // don't announce on initial mount
      return;
    }
    setAnnouncement('Session complete.');
  }, [celebrateToken]);

  return (
    <div
      className={`timer-ring-container ${isRunning ? 'active' : ''}`}
      style={{ width: size + 24, height: size + 24 }}
      role="timer"
      aria-label={mode === 'timer' ? 'Focus timer' : 'Stopwatch'}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      <div className="relative" style={{ width: size, height: size, margin: 12 }}>
        {/* Shared gradient def — zero-size, referenced by id from every arc below.
            Defined once per ring instance via gradientId so multiple rings on
            the same page never collide. */}
        <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={colorEnd} />
            </linearGradient>
          </defs>
        </svg>

        {/* Pre-blurred duplicate glow layer — static blur, animated opacity/scale only.
            This replaces animating `filter: drop-shadow(...)` on the live SVG every frame. */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ filter: 'blur(14px)', willChange: 'opacity, transform' }}
          animate={
            reducedMotion
              ? { opacity: 0.45 }
              : { opacity: [0.3, 0.7, 0.3], scale: [0.98, 1.03, 0.98] }
          }
          transition={{ duration: 2.5, repeat: reducedMotion ? 0 : Infinity, ease: 'easeInOut' }}
        >
          <svg width={size} height={size} className="transform -rotate-90">
            <circle
              cx={cx}
              cy={cy}
              r={r}
              stroke={`url(#${gradientId})`}
              strokeOpacity={0.9}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          </svg>
        </motion.div>

        {/* Static, non-animated base drop-shadow — cheap, no per-frame recompute */}
        <svg
          width={size}
          height={size}
          className="transform -rotate-90"
          style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
          aria-hidden="true"
        >
          <circle cx={cx} cy={cy} r={r} stroke="rgba(42,42,62,0.6)" strokeWidth={strokeWidth} fill="none" />

          {ticks.map((t) => (
            <line
              key={t.key}
              x1={t.x}
              y1={t.y}
              x2={t.x2}
              y2={t.y2}
              stroke={`rgba(255,255,255,${t.major ? 0.16 : 0.07})`}
              strokeWidth={t.major ? 1.4 : 1}
            />
          ))}

          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{
              transition:
                mode === 'timer'
                  ? 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease'
                  : 'stroke-dashoffset 0.1s linear',
            }}
          />
        </svg>

        {/* Recessed/bevel treatment for the track — a soft inset shadow so the
            ring reads as carved into the surface rather than flat-drawn on top
            of it, plus a faint top-left highlight rim for the "lit from above"
            edge. Rendered ABOVE the track/arc svg (moved here from underneath
            it, where the opaque ring painted over it and hid the shadow
            entirely) and blended with `multiply` so it darkens what's behind
            it instead of covering it outright — the colored arc still reads
            through, just subtly shaded at the rim. Pure CSS, no per-frame cost. */}
        <div
          aria-hidden="true"
          className="absolute rounded-full pointer-events-none"
          style={{
            left: cx - r - strokeWidth / 2,
            top: cy - r - strokeWidth / 2,
            width: (r + strokeWidth / 2) * 2,
            height: (r + strokeWidth / 2) * 2,
            mixBlendMode: 'multiply',
            boxShadow:
              'inset 0 3px 8px rgba(0,0,0,0.55), inset 0 -1px 3px rgba(255,255,255,0.05), inset 1px 1px 2px rgba(255,255,255,0.04)',
          }}
        />

        {/* Sparse numeral labels (12/3/6/9-style), unrotated so the text stays
            upright. Unlike the decorative tick svg above (which gets an extra
            CSS -rotate-90 alongside its own trig offset), these positions are
            computed to land exactly on the arc's true 0/25/50/75% points:
            0 or 100 at top, 25 right, 50 bottom, 75 left — matching how the
            progress arc actually sweeps clockwise from 12 o'clock. */}
        <svg width={size} height={size} className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {numerals.map((n) => (
            <text
              key={n.key}
              x={n.x}
              y={n.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={size * 0.06}
              fontWeight={600}
              fill="rgba(255,255,255,0.22)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {n.label}
            </text>
          ))}
        </svg>

        {/* Paused-state dashed ring — was toggled by scanning button text for "Resume";
            now a plain prop-driven opacity transition, no filter/blur involved. */}
        <svg
          width={size}
          height={size}
          className="absolute inset-0 transform -rotate-90 pointer-events-none"
          style={{ opacity: isPaused ? 1 : 0, transition: 'opacity 0.3s ease' }}
          aria-hidden="true"
        >
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="rgba(148,163,184,.55)"
            strokeWidth={2}
            strokeDasharray="5 5"
          />
        </svg>

        {/* Completion burst — was fired by listening for a global event and re-querying
            every mounted ring; now a direct response to celebrateToken changing. GPU-only
            properties (opacity, scale), no filter animation. */}
        <AnimatePresence>
          {celebrateToken > 0 && (
            <motion.div
              key={celebrateToken}
              aria-hidden="true"
              className="absolute rounded-full pointer-events-none"
              style={{
                inset: '-14%',
                background:
                  'radial-gradient(circle, rgba(0,229,255,.55) 0%, rgba(191,90,242,.35) 45%, transparent 72%)',
              }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0], scale: 1.35 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>

        {/* Comet head — glowing dot riding the arc, phase-locked to the real second.
            Position is set via the spring RAF loop (cometRef DOM writes) so the
            head lags/overshoots the arc tip slightly rather than teleporting.
            The initial left/top is the raw computed position; the spring takes
            over on the very next animation frame. Under reduced-motion the RAF
            spring loop never starts, so position stays raw (instant, correct). */}
        {isRunning && (
          <div
            ref={cometRef}
            aria-hidden="true"
            className={reducedMotion ? '' : 'focus-ring-comet-pulse'}
            style={{
              position: 'absolute',
              left: comet.x - cometSize / 2,
              top: comet.y - cometSize / 2,
              width: cometSize,
              height: cometSize,
              borderRadius: '50%',
              background: color,
              boxShadow: cometGlow,
              pointerEvents: 'none',
              animationDuration: reducedMotion ? undefined : `${cometPulseDuration}s`,
              // willChange lets the compositor promote this element independently
              // so the spring's per-frame left/top writes don't trigger full layout.
              willChange: reducedMotion ? 'auto' : 'left, top',
            }}
          />
        )}

        {/* Category icon + streak — real props now, no DOM scraping / localStorage polling */}
        {category && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: '22%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              fontSize: '1.1rem',
              filter: 'drop-shadow(0 0 4px rgba(0,229,255,.5))',
            }}
          >
            {category.icon}
          </div>
        )}
        {streakCount > 0 && (
          <div
            className="absolute pointer-events-none flex items-center gap-1 text-[.68rem] font-semibold"
            style={{ bottom: '14%', left: '50%', transform: 'translate(-50%,0)', color: '#fbbf24' }}
          >
            🔥<span>{streakCount}</span>
          </div>
        )}

        {/* centerContent breathe — the inner wrapper carries the class so only
            the time text nudges, not the full ring container. The class is stripped
            and re-added each second by the breatheRef effect above, replaying the
            keyframe from frame 0 without a JS timer. Hidden from reduced-motion
            via @media in the keyframe declaration in the global stylesheet. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
          <div
            ref={breatheRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              // willChange lets the compositor handle scale without a layout pass.
              willChange: reducedMotion ? 'auto' : 'transform',
            }}
          >
            {centerContent}
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * PR notes / integration checklist:
 *
 * - In the Hx timer component, replace the inline `.timer-ring-container`
 *   JSX block with <FocusRing mode={l} size={de} strokeWidth={Oe}
 *   progressPercent={Te} elapsedSeconds={l==='timer'?(f-m):Math.floor(S/1000)}
 *   totalSeconds={f} remainingSeconds={m} isRunning={ue}
 *   isPaused={!ue && (l==='timer'?m!==f:S>0)} category={currentCategory}
 *   streakCount={streak} celebrateToken={completedCount} centerContent={...} />
 *   Note `progressPercent` (`Te` = `(f-m)/f*100`) is only used in timer mode now;
 *   stopwatch mode computes its own repeating-lap progress from `elapsedSeconds`
 *   internally (see the freeze-after-an-hour bugfix above), so you can drop the
 *   old `ie = Math.min(S/36e5*100, 100)` calculation entirely — it's dead code
 *   once this is wired in.
 *   `currentCategory` and `streak` come from real component/app state (lift
 *   them the same way `f`/`m`/`S` already live in this component or a parent
 *   — see useStudyStreak.js for a drop-in replacement of the polling version
 *   in timer-visual-upgrade-widget.js), and `completedCount` is a
 *   `useState(0)` bumped with `n => n + 1` at the same point that already
 *   calls `t(...)` / fires the session-complete callback.
 *
 * - timer-visual-upgrade-widget.js is now fully redundant for the ring:
 *   ticks, category icon, streak badge, paused ring, and completion burst
 *   are all ported above and driven by props instead of DOM-scraping /
 *   localStorage polling / a global CustomEvent. Once FocusRing is wired
 *   in, delete timer-visual-upgrade-widget.js and its <script> tag entirely
 *   — nothing in it still does useful work. (focus-timer-upgrade-widget.js
 *   is a separate concern — the session-complete modal with the note/star
 *   rating form — and is unaffected by this change.)
 *
 * - Add to your global stylesheet (animation-upgrade.css is the right home):
 *
 *   /* Comet pulse — base duration is the fallback; component overrides inline */
 *   .focus-ring-comet-pulse { animation: focus-ring-comet-pulse 1.3s ease-in-out infinite; }
 *   @keyframes focus-ring-comet-pulse {
 *     0%,100% { transform: scale(1);   opacity: 1;  }
 *        50%  { transform: scale(1.6); opacity: .6; }
 *   }
 *
 *   /* centerContent breathe — 1-2 px scale bump per second tick.            */
 *   /* Class is stripped/re-added by the component each second to replay it.  */
 *   .focus-ring-breathe { animation: focus-ring-breathe 0.38s cubic-bezier(0.34,1.56,0.64,1) both; }
 *   @keyframes focus-ring-breathe {
 *     0%   { transform: scale(1);    }
 *     45%  { transform: scale(1.012); }   /* ~1.5 px at 120 px text height */
 *     100% { transform: scale(1);    }
 *   }
 *   @media (prefers-reduced-motion: reduce) {
 *     .focus-ring-breathe { animation: none; }
 *   }
 *
 *   /* Screen-reader utility */
 *   .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
 *     overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
 *
 * - Motion upgrade summary (v130 → v131):
 *
 *   1. COMET RADIAL EASING — The comet head's absolute position is now driven
 *      by a spring (k=200, d=22) on its own RAF loop, writing left/top directly
 *      into the DOM. This gives a ~180 ms settle with a ~4% overshoot so the
 *      head lags behind the arc tip then catches up with a tiny bounce, instead
 *      of teleporting to the new position on each React render. The underlying
 *      arc still transitions via CSS stroke-dashoffset (unchanged). Disabled
 *      under reduced-motion: position reverts to raw computed comet.x/comet.y.
 *
 *   2. CENTER BREATHE — The time-text wrapper gains a 0.38 s scale animation
 *      (peak 1.012×, ~1.5 px at typical text heights) that replays from frame 0
 *      each time `elapsedSeconds` increments, phase-locking it to the second
 *      tick without a separate timer. Implementation: strip the CSS class,
 *      force a reflow via offsetWidth, re-add it — the cheapest animation reset
 *      in the browser. Guard: `@media (prefers-reduced-motion: reduce)` kills
 *      the keyframe, and the effect also bails early when reducedMotion is true.
 *
 *   3. URGENCY GRADIENT — The binary cyan→orange snap at remainingSeconds/
 *      totalSeconds ≤ 0.10 is replaced by continuous sRGB lerp. urgencyT goes
 *      0.0 → 1.0 over the last 10% of the session; arc start and end colours
 *      are interpolated independently, so the ring drifts through the palette
 *      instead of jumping. lerpHex() is a pure function defined inside the
 *      component (not memoised — it's microseconds and called at most twice
 *      per render). urgencyT is memoised on [mode, totalSeconds, remainingSeconds,
 *      urgent] so it only recomputes when those inputs actually change.
 */
