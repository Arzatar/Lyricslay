'use strict';

// LRCLIB (https://lrclib.net) is a free, keyless, crowd-sourced database of
// line-synced (LRC) lyrics. YT Music's own timed-lyrics renderer requires an
// authenticated session, so we use this as the primary source for real
// timestamped karaoke-style highlighting, and fall back to YT Music's plain
// lyrics text (ytmusic.js) only when LRCLIB has no match.

const { pickBestMatch } = require('./textMatch');

const BASE = 'https://lrclib.net/api';
const HEADERS = {
  'User-Agent': 'lyricslay (personal, non-commercial overlay app)',
};

// Some LRCLIB submissions concatenate a full second copy of the song into
// the same .lrc file — confirmed directly on YOASOBI's "アイドル" (LRCLIB id
// 2116394): the file has the real Japanese lyrics from 00:00 to 03:29, then
// immediately starts over at 00:00 again with a line-by-line romaji
// transliteration of the exact same song, timestamps and all. Parsed
// naively, every real moment in the song ends up with two entries — the
// Japanese line and, right next to it after sorting, its romaji restated —
// which displays as every lyric appearing twice in a row.
//
// The distinguishing signature is the clock itself jumping backward by a
// huge margin after already reaching deep into the song — not merely a
// repeated line (a real chorus repeats forward in time, never backward) and
// not a single mistimed line either (an isolated out-of-order submission
// error stays close to its neighbors, it doesn't reset all the way back
// near zero). Both thresholds below matter: MIN_RUNNING_MAX_MS keeps this
// from firing on the first few seconds of a song (where small submission
// errors are least consequential and most likely to be a single mistimed
// line, not a whole restart), and RESTART_DROP_RATIO requires the drop to
// land back near the very beginning, not just earlier. Verified this
// doesn't misfire on a legitimately hyper-repetitive song: Daft Punk's
// "Around the World" repeats one line ~74 times over 6+ minutes with
// strictly increasing timestamps throughout (LRCLIB id 22027192) — nothing
// here ever looks like a restart, so every repeat survives untouched.
const MIN_RUNNING_MAX_MS = 60_000;
const RESTART_DROP_RATIO = 0.1;

// Pure — exported for unit testing. Expects `pairs` in the file's original
// order (before sorting by time), since the restart signature is about
// where the clock goes next in the file, not about final chronological
// order.
function dropDuplicatedSecondPass(pairs) {
  let runningMax = 0;
  for (let i = 0; i < pairs.length; i++) {
    const { timeMs } = pairs[i];
    if (runningMax >= MIN_RUNNING_MAX_MS && timeMs < runningMax * RESTART_DROP_RATIO) {
      return pairs.slice(0, i);
    }
    if (timeMs > runningMax) runningMax = timeMs;
  }
  return pairs;
}

// "[01:02.34]Some text" -> { timeMs: 62340, text: 'Some text' }
function parseLrc(lrc) {
  if (!lrc) return null;
  const lines = lrc.split(/\r?\n/);
  const raw = [];
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
      raw.push({ timeMs, text });
    }
  }
  if (raw.length === 0) return null;
  const out = dropDuplicatedSecondPass(raw);
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

module.exports = { fetchSyncedLyrics, parseLrc, dropDuplicatedSecondPass };
