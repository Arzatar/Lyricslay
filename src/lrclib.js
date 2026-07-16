'use strict';

// LRCLIB (https://lrclib.net) is a free, keyless, crowd-sourced database of
// line-synced (LRC) lyrics. YT Music's own timed-lyrics renderer requires an
// authenticated session, so we use this as the primary source for real
// timestamped karaoke-style highlighting, and fall back to YT Music's plain
// lyrics text (ytmusic.js) only when LRCLIB has no match.

const { pickBestMatch } = require('./textMatch');

const BASE = 'https://lrclib.net/api';
const HEADERS = {
  'User-Agent': 'lyrics-overlay (personal, non-commercial overlay app)',
};

// "[01:02.34]Some text" -> { timeMs: 62340, text: 'Some text' }
function parseLrc(lrc) {
  if (!lrc) return null;
  const lines = lrc.split(/\r?\n/);
  const out = [];
  const timeTag = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    timeTag.lastIndex = 0;
    const tags = [...rawLine.matchAll(timeTag)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(timeTag, '').trim();
    if (!text) continue;
    for (const m of tags) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      const timeMs = min * 60000 + sec * 1000 + frac;
      out.push({ timeMs, text });
    }
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

async function apiGet(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/get?${qs}`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib /get HTTP ${res.status}`);
  return res.json();
}

async function apiSearch(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/search?${qs}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`lrclib /search HTTP ${res.status}`);
  return res.json();
}

async function fetchSyncedLyrics(title, artist, durationSec) {
  if (!title) return null;

  // 1) Exact-ish lookup: fast path, requires duration to be within ~2s of the real track.
  if (durationSec && Number.isFinite(durationSec)) {
    try {
      const exact = await apiGet({
        track_name: title,
        artist_name: artist || '',
        duration: String(Math.round(durationSec)),
      });
      if (exact?.syncedLyrics) {
        const timed = parseLrc(exact.syncedLyrics);
        if (timed) return { timed, plain: exact.plainLyrics || null };
      }
      if (exact?.plainLyrics && !exact.syncedLyrics) {
        return { timed: null, plain: exact.plainLyrics };
      }
    } catch {
      // fall through to search
    }
  }

  // 2) Fuzzy search fallback, picking the best title/artist match with a synced result.
  try {
    const results = await apiSearch({ track_name: title, artist_name: artist || '' });
    if (!Array.isArray(results) || results.length === 0) return null;

    // Candidates with synced lyrics get a tiebreaker bump over otherwise-equal matches.
    const best = pickBestMatch(
      results,
      title,
      artist,
      (r) => r.trackName,
      (r) => r.artistName,
      (r) => (r.syncedLyrics ? 1 : 0)
    );
    if (!best) return null;

    if (best.syncedLyrics) {
      const timed = parseLrc(best.syncedLyrics);
      if (timed) return { timed, plain: best.plainLyrics || null };
    }
    if (best.plainLyrics) {
      return { timed: null, plain: best.plainLyrics };
    }
  } catch {
    // no network / API down — caller falls back to YT Music
  }

  return null;
}

module.exports = { fetchSyncedLyrics, parseLrc };
