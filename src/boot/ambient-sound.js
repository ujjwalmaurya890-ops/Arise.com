/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
window.AriseBoot.ready.then(function () {
  (function () {
    if (window.__ARISE_AMBIENT_SOUND__) return;
    const SOUNDS = [
      { id: "rain", label: "Rain", src: "./assets/sounds/rain.mp3" },
      { id: "moody", label: "Moody", src: "./assets/sounds/moody.mp3" },
      { id: "relaxing", label: "Relaxing", src: "./assets/sounds/relaxing.mp3" },
      { id: "calming", label: "Calming", src: "./assets/sounds/calming.mp3" },
      { id: "forest", label: "Forest / Nature", src: "./assets/sounds/forest.mp3" },
      { id: "wind", label: "Soft Wind", src: "./assets/sounds/wind.mp3" },
      { id: "night", label: "Night Ambience", src: "./assets/sounds/night.mp3" }
    ];
    const KEY = "ariseAmbientSound:v1";
    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const loadState = () => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const s = JSON.parse(raw);
          return {
            selected: SOUNDS.some(x => x.id === s.selected) ? s.selected : "rain",
            volume: clamp(Number(s.volume) || 0.45, 0, 1),
            muted: !!s.muted,
            playing: false
          };
        }
      } catch (e) {}
      return { selected: "rain", volume: 0.45, muted: false, playing: false };
    };
    const state = loadState();
    let audio = null;
    let loadedId = null;
    let pendingPlay = null;
    let errorMsg = "";
    const save = () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ selected: state.selected, volume: state.volume, muted: state.muted })
        );
      } catch (e) {}
    };
    const current = () => SOUNDS.find(s => s.id === state.selected) || SOUNDS[0];
    const clearError = () => {
      errorMsg = "";
    };
    const showError = msg => {
      errorMsg = msg || "Audio couldn't start. Click Play again or replace sound files if needed.";
    };
    // Explicitly track which sound id is actually loaded into the <audio> element,
    // instead of guessing from resolved src strings (which browsers normalize to
    // absolute URLs and made the old endsWith() comparison unreliable).
    const ensureAudio = forceReload => {
      const s = current();
      if (!audio) {
        audio = new Audio();
        audio.loop = true;
        audio.preload = "auto";
        // Keep `state.playing` truthful by listening to the element's real
        // playback events instead of only trusting what we set on click.
        audio.addEventListener("playing", () => {
          state.playing = true;
          clearError();
          sync();
        });
        audio.addEventListener("pause", () => {
          if (!pendingPlay) {
            state.playing = false;
            sync();
          }
        });
        audio.addEventListener("error", () => {
          state.playing = false;
          showError(
            "Couldn't load \"" + current().label + '". Check the file or try another track.'
          );
          sync();
        });
      }
      if (forceReload || loadedId !== s.id) {
        audio.pause();
        audio.src = s.src;
        loadedId = s.id;
        audio.load();
      }
      audio.volume = state.muted ? 0 : state.volume;
      audio.muted = state.muted;
      audio.loop = true;
      return audio;
    };
    const sync = () => {
      if (audio) {
        audio.volume = state.muted ? 0 : state.volume;
        audio.muted = state.muted;
      }
      document.querySelectorAll(".ambient-sound-controls").forEach(renderInto);
      save();
    };
    const play = () => {
      clearError();
      const el = ensureAudio();
      const req = el.play();
      pendingPlay = req;
      sync(); // reflect "starting..." optimistically, corrected by events/catch below
      Promise.resolve(req)
        .then(() => {
          if (pendingPlay === req) {
            pendingPlay = null;
            state.playing = true;
            clearError();
            sync();
          }
        })
        .catch(err => {
          if (pendingPlay !== req) return; // superseded by a newer play()/setSound() call
          pendingPlay = null;
          state.playing = false;
          // AbortError fires when a play() is interrupted by a follow-up load()/pause()
          // (e.g. quickly switching tracks) — that's expected, not a real failure.
          if (err && err.name === "AbortError") {
            sync();
            return;
          }
          showError();
          sync();
        });
    };
    const pause = () => {
      pendingPlay = null;
      state.playing = false;
      if (audio) audio.pause();
      sync();
    };
    const stop = () => {
      pendingPlay = null;
      state.playing = false;
      if (audio) {
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch (e) {}
      }
      sync();
    };
    const setSound = id => {
      if (!SOUNDS.some(s => s.id === id) || id === state.selected) return;
      const was = state.playing || !!pendingPlay;
      pendingPlay = null;
      state.selected = id;
      if (was) {
        play();
      } else {
        if (audio) {
          audio.pause();
        }
        loadedId = null;
        sync();
      }
    };
    function renderInto(panel) {
      const s = current();
      panel.innerHTML = "";
      const title = document.createElement("div");
      title.className = "ambient-sound-title";
      title.innerHTML =
        '<span class="ambient-sound-label">' +
        (window.AriseIcons ? window.AriseIcons.svg("headphones") : "") +
        'Ambient Sound</span><span class="ambient-sound-now">' +
        (state.playing ? "Playing: " : "Ready: ") +
        s.label +
        "</span>";
      const grid = document.createElement("div");
      grid.className = "ambient-sound-grid";
      const row = document.createElement("div");
      row.className = "ambient-sound-row";
      const select = document.createElement("select");
      select.className = "ambient-sound-select";
      select.setAttribute("aria-label", "Ambient sound");
      SOUNDS.forEach(opt => {
        const o = document.createElement("option");
        o.value = opt.id;
        o.textContent = opt.label;
        o.selected = opt.id === state.selected;
        select.appendChild(o);
      });
      select.onchange = () => setSound(select.value);
      const playBtn = document.createElement("button");
      playBtn.className = "ambient-sound-btn";
      playBtn.type = "button";
      playBtn.textContent = state.playing ? "Pause" : "Play";
      playBtn.onclick = () => (state.playing ? pause() : play());
      const stopBtn = document.createElement("button");
      stopBtn.className = "ambient-sound-btn";
      stopBtn.type = "button";
      stopBtn.textContent = "Stop";
      stopBtn.onclick = stop;
      const muteBtn = document.createElement("button");
      muteBtn.className = "ambient-sound-btn";
      muteBtn.type = "button";
      muteBtn.textContent = state.muted ? "Unmute" : "Mute";
      muteBtn.onclick = () => {
        state.muted = !state.muted;
        sync();
      };
      row.append(select, playBtn, stopBtn, muteBtn);
      const vol = document.createElement("label");
      vol.className = "ambient-sound-volume";
      vol.innerHTML = "<span>Vol</span>";
      const range = document.createElement("input");
      range.type = "range";
      range.min = "0";
      range.max = "100";
      range.value = String(Math.round(state.volume * 100));
      range.oninput = () => {
        state.volume = clamp(Number(range.value) / 100, 0, 1);
        if (audio) audio.volume = state.muted ? 0 : state.volume;
        save();
      };
      const pct = document.createElement("span");
      pct.textContent = Math.round(state.volume * 100) + "%";
      range.addEventListener(
        "input",
        () => (pct.textContent = Math.round(state.volume * 100) + "%")
      );
      vol.append(range, pct);
      const err = document.createElement("div");
      err.className = "ambient-sound-error" + (errorMsg ? " show" : "");
      err.textContent = errorMsg;
      grid.append(row, vol, err);
      panel.append(title, grid);
    }
    function timerRootFromTab(tab) {
      let node = tab.parentElement;
      for (let i = 0; node && i < 6; i++, node = node.parentElement) {
        if (node.querySelector(".timer-ring-container")) return node;
      }
      return null;
    }
    function getFocusOverlay() {
      const focusMode = document.querySelector(".focus-mode");
      if (focusMode && focusMode.querySelector(".timer-ring-container")) return focusMode;
      const rings = document.querySelectorAll(".timer-ring-container");
      for (let i = 0; i < rings.length; i++) {
        const cand = rings[i].closest("div.fixed");
        if (!cand) continue;
        const cls = cand.className || "";
        const highZ =
          cls.includes("z-[9999]") || (parseInt(getComputedStyle(cand).zIndex, 10) || 0) >= 9000;
        if (!highZ) continue;
        if (cand.offsetWidth >= innerWidth * 0.75 && cand.offsetHeight >= innerHeight * 0.75)
          return cand;
      }
      return null;
    }
    function setFocusState(activeRoot) {
      const want = !!activeRoot;
      if (document.documentElement.classList.contains("arise-focus-active") !== want) {
        document.documentElement.classList.toggle("arise-focus-active", want);
      }
      if (document.body && document.body.classList.contains("arise-focus-active") !== want) {
        document.body.classList.toggle("arise-focus-active", want);
      }
      document.querySelectorAll(".arise-active-focus-root").forEach(el => {
        if (el !== activeRoot) el.classList.remove("arise-active-focus-root");
      });
      if (activeRoot && !activeRoot.classList.contains("arise-active-focus-root"))
        activeRoot.classList.add("arise-active-focus-root");
    }
    function installCore() {
      if (!document.getElementById("arise-main") && !document.querySelector(".focus-mode")) return;
      const rings = document.querySelectorAll(".timer-ring-container");
      const hasTimerUI = rings.length > 0;
      const activeRoot = hasTimerUI ? getFocusOverlay() : null;
      setFocusState(activeRoot);
      const scope = activeRoot || document;
      if (activeRoot && activeRoot.classList && activeRoot.classList.contains("focus-mode")) {
        const shell =
          activeRoot.querySelector(".ambient-focus-shell") ||
          activeRoot.querySelector(".relative.z-10");
        if (shell && !shell.classList.contains("ambient-focus-shell"))
          shell.classList.add("ambient-focus-shell");
        const grid =
          activeRoot.querySelector(".ambient-focus-grid") || activeRoot.querySelector(".grid");
        if (grid && !grid.classList.contains("ambient-focus-grid"))
          grid.classList.add("ambient-focus-grid");
        const left =
          activeRoot.querySelector(".ambient-focus-left") ||
          activeRoot.querySelector(".lg\\:col-span-2");
        if (left && !left.classList.contains("ambient-focus-left"))
          left.classList.add("ambient-focus-left");
      }
      document.querySelectorAll(".ambient-sound-controls").forEach(panel => {
        if (activeRoot && !activeRoot.contains(panel)) panel.remove();
        if (!activeRoot && panel.closest(".focus-mode")) panel.remove();
      });
      if (!hasTimerUI) return;
      const tabs = [...scope.querySelectorAll("[data-arise-timer-tab]")].filter(
        b => !b.closest("[hidden]")
      );
      tabs.forEach(tab => {
        if (!tab.getClientRects().length) return;
        const root = timerRootFromTab(tab);
        if (!root || (activeRoot && !activeRoot.contains(root))) return;
        const nested = [...root.querySelectorAll(".ambient-sound-controls")].filter(
          panel => panel.parentElement !== root
        );
        nested.forEach(panel => panel.remove());
        const existing = [...root.querySelectorAll(":scope > .ambient-sound-controls")];
        if (existing.length) {
          existing.slice(1).forEach(panel => panel.remove());
          return;
        }
        const panel = document.createElement("div");
        panel.className = "ambient-sound-controls";
        panel.dataset.ambientSound = "true";
        renderInto(panel);
        const ring = root.querySelector(":scope > .timer-ring-container");
        if (ring && ring.nextSibling) root.insertBefore(panel, ring.nextSibling);
        else if (ring) root.appendChild(panel);
        else root.appendChild(panel);
      });
    }
    function install() {
      const bus = window.__ARISE_MUTATION_BUS__;
      if (bus && bus.mute) bus.mute(installCore);
      else installCore();
    }
    const debounced = records => {
      if (document.hidden) return;
      if (Array.isArray(records) && records.length) {
        let relevant = false;
        for (let i = 0; i < records.length && !relevant; i++) {
          const rec = records[i];
          if (rec.addedNodes && rec.addedNodes.length) {
            for (let j = 0; j < rec.addedNodes.length; j++) {
              if (rec.addedNodes[j] && rec.addedNodes[j].nodeType === 1) {
                relevant = true;
                break;
              }
            }
          }
          if (!relevant && rec.removedNodes && rec.removedNodes.length) {
            for (let k = 0; k < rec.removedNodes.length; k++) {
              if (rec.removedNodes[k] && rec.removedNodes[k].nodeType === 1) {
                relevant = true;
                break;
              }
            }
          }
        }
        if (!relevant) return;
      }
      clearTimeout(debounced.t);
      debounced.t = setTimeout(install, 120);
    };
    document.addEventListener("DOMContentLoaded", install);
    window.addEventListener("load", install);
    setTimeout(install, 500);
    setTimeout(install, 1500);
    // Mutations that arrived while the tab was hidden were skipped above; run
    // install once on visibility regain so the panel is never left un-anchored.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) install();
    });
    var ambObs = new MutationObserver(debounced);
    function startAmbObs() {
      if (window.__ARISE_MUTATION_BUS__) {
        window.__ARISE_MUTATION_BUS__.subscribe(debounced);
        return;
      }
      ambObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
    if (document.body) startAmbObs();
    else document.addEventListener("DOMContentLoaded", startAmbObs, { once: true });
    window.addEventListener(
      "arise:widgets-ready",
      function () {
        if (window.__ARISE_MUTATION_BUS__) {
          try {
            ambObs.disconnect();
          } catch (e) {}
          window.__ARISE_MUTATION_BUS__.subscribe(debounced);
        }
      },
      { once: true }
    );
    window.__ARISE_AMBIENT_SOUND__ = {
      play,
      pause,
      stop,
      state,
      get audio() {
        return audio;
      },
      install
    };
  })();
});
