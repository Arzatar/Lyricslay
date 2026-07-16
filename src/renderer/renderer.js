'use strict';

const root = document.getElementById('root');
const topRow = document.getElementById('top-row');
const trackLabel = document.getElementById('track-label');
const colorSwatch = document.getElementById('color-swatch');
const lyricsEl = document.getElementById('lyrics');
const lyricsInner = document.getElementById('lyrics-inner');
const colorInput = document.getElementById('color-input');

const PLACEHOLDER_LABEL = 'Lyrics Overlay';

let state = {
  timed: null, // sorted [{timeMs, endMs, text}]
  staticText: null,
  // null = "never computed yet", distinct from -1, which findActiveLineIndex()
  // legitimately returns when playback hasn't reached the first line yet. If this
  // used -1 as its own initial/reset value, updateActiveLine() would see idx === -1
  // === state.activeIndex on that first call and skip re-applying line classes —
  // leaving every line at its just-rendered default (visible) state instead of
  // hiding everything outside the visible-line window.
  activeIndex: null,
  positionMs: 0,
  durationMs: 0,
  status: 'Stopped',
  lastTickWallClock: 0,
  lastTickPositionMs: 0,
  visibleLines: 3,
  // Per-song manual sync nudge: positive = lyrics show later (delay them), negative
  // = earlier. Applied by subtracting it from the real position before comparing
  // against each line's timestamp — see updateActiveLine().
  offsetMs: 0,
};

// Lyrics are top-aligned (see updateActiveLine) rather than vertically centered,
// so a long line that wraps to 2+ visual rows never has to shrink to survive —
// it just pushes the following (invisible, off-window) rows further down. To
// make that safe, the window reserves 3x the configured visible-line count in
// actual row budget (e.g. "show 3 lines" reserves room for 9) so wrapping is
// absorbed by empty, transparent space below instead of clipping anything.
// Genuinely extreme wraps (a single line spanning 4+ rows) can still clip — an
// accepted tradeoff for never shrinking text to force everything onto one row.
// Reads --font-size/--line-height-em rather than hardcoding them so this can
// never drift out of sync with the actual CSS.
const WRAP_BUFFER_MULTIPLIER = 3;

function computeDesiredHeight() {
  const rootStyle = getComputedStyle(document.documentElement);
  const fontSizePx = parseFloat(rootStyle.getPropertyValue('--font-size')) || 22;
  const lineHeightEm = parseFloat(rootStyle.getPropertyValue('--line-height-em')) || 1.2;
  const lineHeightPx = fontSizePx * lineHeightEm;

  const topRowHeight = topRow.getBoundingClientRect().height;
  const lyricsStyle = getComputedStyle(lyricsEl);
  const verticalPadding = parseFloat(lyricsStyle.paddingTop) + parseFloat(lyricsStyle.paddingBottom);

  return Math.ceil(
    topRowHeight + verticalPadding + state.visibleLines * WRAP_BUFFER_MULTIPLIER * lineHeightPx
  );
}

function syncWindowHeight() {
  window.overlay.setDesiredHeight(computeDesiredHeight());
}

function setHint(text) {
  lyricsInner.parentElement.classList.remove('static-scroll-host');
  lyricsInner.style.transform = 'none';
  lyricsInner.innerHTML = `<p class="hint">${escapeHtml(text)}</p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderTimedLyrics() {
  lyricsInner.parentElement.classList.remove('static-scroll-host');
  lyricsInner.innerHTML = '';
  const frag = document.createDocumentFragment();
  state.timed.forEach((line, i) => {
    const p = document.createElement('p');
    p.className = 'lyrics-line';
    p.textContent = line.text;
    p.dataset.index = String(i);
    frag.appendChild(p);
  });
  lyricsInner.appendChild(frag);
  state.activeIndex = null; // see comment on the state object — must not be -1
}

function renderStaticLyrics(text) {
  lyricsInner.innerHTML = '';
  lyricsInner.style.transform = 'none';
  lyricsInner.parentElement.classList.add('static-scroll-host');
  const div = document.createElement('div');
  div.className = 'static-block';
  div.textContent = text;
  lyricsInner.appendChild(div);
}

function updateActiveLine() {
  if (!state.timed || state.timed.length === 0) return;
  const idx = window.lyricsSync.findActiveLineIndex(state.timed, state.positionMs - state.offsetMs);

  if (idx === state.activeIndex) return;
  state.activeIndex = idx;

  // Lines further than this from the active one are force-hidden (see
  // .outside-window in style.css) so "show N lines" holds even when a long
  // line wraps to 2+ visual rows and would otherwise throw off the centering.
  const halfWindow = Math.floor(state.visibleLines / 2);

  const nodes = lyricsInner.querySelectorAll('.lyrics-line');
  nodes.forEach((node, i) => {
    node.classList.remove('active', 'near');
    const distance = Math.abs(i - idx);
    if (i === idx) node.classList.add('active');
    else if (distance === 1) node.classList.add('near');
    node.classList.toggle('outside-window', distance > halfWindow);
  });

  // Top-aligned, not centered: the earliest visible line's top edge lands at the
  // top of the lyrics area, and the block flows downward from there — instead of
  // centering the active line, which required assuming every line is exactly one
  // line-height tall (false the moment a long line wraps to 2+ visual rows).
  // Using the real .offsetTop of the first visible node means this stays correct
  // regardless of how tall any individual (possibly wrapped) line actually is.
  const firstVisibleIdx = Math.max(0, idx - halfWindow);
  const firstVisible = nodes[firstVisibleIdx];
  if (firstVisible) {
    lyricsInner.style.transform = `translateY(${-firstVisible.offsetTop}px)`;
  }
}

function updateStaticScroll() {
  if (!state.staticText || !state.durationMs) return;
  const container = lyricsInner.parentElement;
  if (!container.classList.contains('static-scroll-host')) return;
  const block = lyricsInner.querySelector('.static-block');
  if (!block) return;

  const ratio = window.lyricsSync.scrollRatio(state.positionMs, state.durationMs);
  const maxScroll = block.scrollHeight - block.clientHeight;
  if (maxScroll > 0) block.scrollTop = ratio * maxScroll;
}

function tick() {
  if (state.status === 'Playing' && (state.timed || state.staticText)) {
    state.positionMs = window.lyricsSync.interpolatePositionMs(
      state.lastTickPositionMs,
      state.lastTickWallClock,
      Date.now()
    );
    updateActiveLine();
    updateStaticScroll();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.overlay.onNowPlaying((data) => {
  if (!data || !data.active) {
    root.classList.remove('paused');
    trackLabel.textContent = PLACEHOLDER_LABEL;
    return;
  }

  trackLabel.textContent = `${data.title || ''} — ${data.artist || ''}`;
  state.status = data.status || 'Playing';
  root.classList.toggle('paused', state.status !== 'Playing');

  if (Number.isFinite(data.durationMs) && data.durationMs > 0) {
    state.durationMs = data.durationMs;
  }

  if (Number.isFinite(data.positionMs)) {
    state.lastTickPositionMs = data.positionMs;
    state.lastTickWallClock = Date.now();
    state.positionMs = data.positionMs;
    updateActiveLine();
    updateStaticScroll();
  }
});

window.overlay.onLyricsLoading(() => {
  state.timed = null;
  state.staticText = null;
  state.offsetMs = 0;
  setHint('Searching for lyrics…');
});

window.overlay.onLyricsResult(({ lyrics, error }) => {
  if (error || !lyrics || lyrics.source === 'none') {
    state.timed = null;
    state.staticText = null;
    setHint('Lyrics not available for this song.');
    return;
  }

  state.offsetMs = lyrics.offsetMs || 0;

  if (lyrics.timed && lyrics.timed.length > 0) {
    state.timed = lyrics.timed;
    state.staticText = null;
    renderTimedLyrics();
    updateActiveLine();
  } else if (lyrics.static) {
    state.timed = null;
    state.staticText = lyrics.static;
    renderStaticLyrics(lyrics.static);
  } else {
    setHint('Lyrics not available for this song.');
  }
});

window.overlay.onFontSizeChanged((size) => {
  document.documentElement.style.setProperty('--font-size', `${size}px`);
  syncWindowHeight();
  // A bigger/smaller font changes every line's height, which shifts where the
  // (still-)active line sits — but since its *index* didn't change, updateActiveLine()
  // would otherwise skip recomputing the top-aligned transform and leave lyrics
  // positioned for the old font size (looking like they'd vanished off-window).
  state.activeIndex = null;
  updateActiveLine();
});

window.overlay.onOpacityChanged((op) => {
  document.documentElement.style.setProperty('--opacity', op);
});

window.overlay.onLockedChanged((locked) => {
  root.classList.toggle('locked', locked);
});

// The window is always click-through except this hover-activated hole: while
// unlocked, moving the cursor over the top row (the track-label drag handle and
// the color swatch — no header bar anymore) briefly makes the window interactive
// so it can be dragged or the swatch clicked; leaving it hands mouse events
// straight back to whatever's behind the overlay. main.js ignores this entirely
// while locked, so locked always stays fully click-through with no exceptions.
// Hit-tested by hand against raw mousemove (rather than relying on the browser's
// derived mouseenter/mouseleave) because a click-through window's hover state
// machinery isn't guaranteed to run the same way as a normal, fully-interactive one.
let isOverTopRow = false;
// While the row is pressed, an OS-level window drag may be in progress (started
// via -webkit-app-region: drag) — re-evaluating hover mid-drag based on viewport
// coordinates fought with that native drag loop and made moving the overlay feel
// jumpy/erratic, so hover tracking is suspended for the duration of the press.
let isPressed = false;

topRow.addEventListener('mousedown', () => {
  isPressed = true;
});
window.addEventListener('mouseup', () => {
  isPressed = false;
});
// Safety net: if a native drag swallows the mouseup (observed to happen
// occasionally), don't leave hover tracking stuck off — the next time the
// window loses focus, it's a safe point to assume any drag has ended.
window.addEventListener('blur', () => {
  isPressed = false;
});

document.addEventListener('mousemove', (e) => {
  if (isPressed) return;
  const rect = topRow.getBoundingClientRect();
  const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (over === isOverTopRow) return;
  isOverTopRow = over;
  window.overlay.setInteractive(over);
});

// The one thing on screen the user genuinely clicks (as opposed to drags) — a
// real click here carries real user-activation, so unlike the tray-menu path,
// this reliably opens the native color picker.
colorSwatch.addEventListener('click', () => {
  window.overlay.setPickerOpen(true);
  colorInput.click();
});

window.overlay.onVisibleLinesChanged((count) => {
  state.visibleLines = count;
  syncWindowHeight();
  state.activeIndex = null; // force updateActiveLine() to redo outside-window classes
  updateActiveLine();
});

window.overlay.onColorSwatchVisibleChanged((visible) => {
  colorSwatch.style.display = visible ? '' : 'none';
});

window.overlay.onOffsetChanged((offsetMs) => {
  state.offsetMs = offsetMs;
  state.activeIndex = null; // force a recompute — positionMs itself didn't change
  updateActiveLine();
});

// 'input' fires live while the native picker is open (instant preview); 'change'
// fires once on commit, which is when we bother persisting it via IPC. 'blur' is
// the only signal we get that the picker closed (whether committed or cancelled),
// which is what un-pauses main.js's always-on-top re-assert.
colorInput.addEventListener('input', () => {
  document.documentElement.style.setProperty('--lyrics-color-rgb', window.colorUtils.hexToRgbString(colorInput.value));
});
colorInput.addEventListener('change', () => {
  window.overlay.setLyricsColor(colorInput.value);
});
colorInput.addEventListener('blur', () => {
  window.overlay.setPickerOpen(false);
});

window.overlay.getInitState().then((s) => {
  document.documentElement.style.setProperty('--font-size', `${s.fontSize}px`);
  document.documentElement.style.setProperty('--opacity', s.opacity);
  document.documentElement.style.setProperty('--lyrics-color-rgb', window.colorUtils.hexToRgbString(s.lyricsColor));
  colorInput.value = s.lyricsColor;
  colorSwatch.style.display = s.colorSwatchVisible ? '' : 'none';
  root.classList.toggle('locked', s.locked);
  state.visibleLines = s.visibleLines;
  syncWindowHeight();
});
