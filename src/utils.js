'use strict';

// Pure helpers factored out of main.js so they're testable without an Electron
// runtime (main.js itself can't be `require`-d outside Electron since it touches
// `app`/`BrowserWindow` at module scope).

// Identifies "the same track" across now-playing ticks so we don't re-fetch lyrics
// on every ~800ms poll — only when the title or artist actually changes.
function trackKeyFor(title, artist) {
  return `${(title || '').trim()}::${(artist || '').trim()}`;
}

// The 9 positions of a standard 3x3 anchor grid (top/middle/bottom x
// left/center/right), each computed from a display's work area (the area
// excluding the taskbar) rather than its full bounds. A "center" x/y centers
// the window itself there — its center lands on the work area's center, not
// just offset from a corner — so it stays centered regardless of what
// width/height it ends up at; edge anchors sit `margin` in from that edge.
const ANCHOR_X = {
  left: (workArea, margin) => workArea.x + margin,
  center: (workArea, margin, width) => workArea.x + Math.round((workArea.width - width) / 2),
  right: (workArea, margin, width) => workArea.x + workArea.width - width - margin,
};
const ANCHOR_Y = {
  top: (workArea, margin) => workArea.y + margin,
  middle: (workArea, margin, width, height) => workArea.y + Math.round((workArea.height - height) / 2),
  bottom: (workArea, margin, width, height) => workArea.y + workArea.height - height - margin,
};

// `anchor` is "<top|middle|bottom>-<left|center|right>", e.g. "top-center" or
// "bottom-right" — matching the 9-cell grid the tray's position picker shows.
function anchoredBounds(anchor, workArea, size = {}) {
  const [vertical, horizontal] = anchor.split('-');
  const width = size.width ?? Math.round(workArea.width / 3);
  const height = size.height ?? 260;
  const margin = size.margin ?? 24;
  return {
    x: ANCHOR_X[horizontal](workArea, margin, width),
    y: ANCHOR_Y[vertical](workArea, margin, width, height),
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

module.exports = { trackKeyFor, anchoredBounds, cycleValue, resizeKeepingTopLeftAnchored };
