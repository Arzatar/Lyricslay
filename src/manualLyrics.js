'use strict';

// Pure helpers for "Use my own lyrics…" (see openOwnLyricsWindow in main.js):
// the user pastes/loads lyrics they wrote or found themselves, for songs no
// source has (e.g. a SoundCloud-only upload whose uploader's name is what
// Windows reports as the "artist"), and it's stored straight into the cache
// for the song currently playing — no search, no source involved at all.

// [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx] and the [mm:ss:xx] variant
// some LRC editors write. Minutes may exceed 99 for very long tracks.
const TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

// Returns { timed } if any line carries an LRC timestamp, { static } for
// plain text, or null for empty input. Unlike lrclib.js's parseLrc, nothing
// is second-guessed or dropped here (no duplicated-second-pass heuristic) —
// this is the user's own deliberate input. In a timed paste, lines without a
// timestamp (blank lines, [Chorus] headers, [ar:...] metadata tags) are
// skipped; a line with several tags ("[00:10.00][01:20.00]Chorus line") is
// repeated at each time, per the LRC convention.
function parseUserLyrics(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = text.split(/\r?\n/);

  const timed = [];
  for (const rawLine of lines) {
    TIME_TAG.lastIndex = 0;
    const tags = [...rawLine.matchAll(TIME_TAG)];
    if (tags.length === 0) continue;
    const lineText = rawLine.replace(TIME_TAG, '').trim();
    if (!lineText) continue;
    for (const m of tags) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      timed.push({ timeMs: Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac, text: lineText });
    }
  }
  if (timed.length > 0) return { timed: timed.sort((a, b) => a.timeMs - b.timeMs) };

  const plain = lines.map((l) => l.trimEnd()).join('\n').trim();
  return plain ? { static: plain } : null;
}

function formatTimeTag(timeMs) {
  const total = Math.max(0, Math.round(timeMs));
  const min = Math.floor(total / 60000);
  const sec = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

// The opposite direction, used to prefill the window with whatever lyrics
// the song already has, so fixing a few wrong lines/timestamps is an edit,
// not a rewrite from scratch. Always the original lyrics, never romaji.
function lyricsToEditableText(lyrics) {
  if (!lyrics) return '';
  if (Array.isArray(lyrics.timed) && lyrics.timed.length > 0) {
    return lyrics.timed.map((l) => `${formatTimeTag(l.timeMs)}${l.text}`).join('\n');
  }
  return typeof lyrics.static === 'string' ? lyrics.static : '';
}

module.exports = { parseUserLyrics, lyricsToEditableText, formatTimeTag };
