'use strict';

// Pure playback-position -> active-line logic shared by renderer.js and its tests.
// Kept dependency-free (no DOM) so it can run under both the browser (via a plain
// <script> tag, hence the dual export below) and Node's test runner.

// `timedLines` must be sorted ascending by `timeMs` (renderer.js sorts once on load).
// Returns -1 if playback hasn't reached the first line yet, or `timedLines` is empty.
function findActiveLineIndex(timedLines, positionMs) {
  if (!timedLines || timedLines.length === 0) return -1;

  let index = -1;
  for (let i = 0; i < timedLines.length; i++) {
    if (timedLines[i].timeMs <= positionMs) index = i;
    else break;
  }
  return index;
}

// Interpolates the live playback position between now-playing ticks (which arrive
// only every ~800ms) so the UI can animate smoothly at 60fps in between.
function interpolatePositionMs(lastKnownPositionMs, lastTickWallClockMs, nowMs) {
  const elapsed = nowMs - lastTickWallClockMs;
  return lastKnownPositionMs + Math.max(0, elapsed);
}

// Fraction (0..1) of the track elapsed, used to drive proportional auto-scroll for
// plain (untimed) lyrics. Clamped so a slightly-stale duration can't overshoot.
function scrollRatio(positionMs, durationMs) {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, positionMs / durationMs));
}

const lyricsSyncApi = { findActiveLineIndex, interpolatePositionMs, scrollRatio };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = lyricsSyncApi;
}
if (typeof window !== 'undefined') {
  window.lyricsSync = lyricsSyncApi;
}
