'use strict';

// Pure helpers factored out of main.js so they're testable without an Electron
// runtime (main.js itself can't be `require`-d outside Electron since it touches
// `app`/`BrowserWindow` at module scope).

// Identifies "the same track" across now-playing ticks so we don't re-fetch lyrics
// on every ~800ms poll — only when the title or artist actually changes.
function trackKeyFor(title, artist) {
  return `${(title || '').trim()}::${(artist || '').trim()}`;
}

// Top-center placement for the overlay window, computed from a display's work area
// (the area excluding the taskbar) rather than its full bounds. Width defaults to a
// third of the work area's own width (rather than a fixed pixel value) so the overlay
// scales with whatever display it's actually on, per-monitor. Horizontally centers the
// window itself (its center lands on the work area's center), not just offsetting it
// from a corner — so it stays centered regardless of what width it ends up at.
function topCenterBounds(workArea, size = {}) {
  const width = size.width ?? Math.round(workArea.width / 3);
  const height = size.height ?? 260;
  const margin = size.margin ?? 24;
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + margin,
    width,
    height,
  };
}

// Steps `current` forward/backward through `options` by `direction` steps (usually
// ±1), clamped to the array's ends. Used for cycling settings like visible-line
// count through a fixed set of allowed values (1/3/5) via tray menu clicks.
function cycleValue(options, current, direction) {
  const at = options.indexOf(current);
  const from = at === -1 ? 0 : at;
  const next = Math.max(0, Math.min(options.length - 1, from + direction));
  return options[next];
}

// Resizes a window while keeping its top-left corner in the same place — so
// growing/shrinking the overlay (more/fewer lyric lines, a taller wrap-buffer
// reservation, or matching a different display's width) never moves where its
// top edge already was. An earlier bottom-anchored version grew *upward*
// instead, which could push the top edge off the top of the screen entirely
// once the wrap-buffer height reservation made the window much taller.
function resizeKeepingTopLeftAnchored(bounds, newWidth, newHeight) {
  return {
    x: bounds.x,
    y: bounds.y,
    width: newWidth,
    height: newHeight,
  };
}

module.exports = { trackKeyFor, topCenterBounds, cycleValue, resizeKeepingTopLeftAnchored };
