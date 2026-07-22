'use strict';

const fs = require('fs');
const path = require('path');

// Persists lyrics lookups to disk, one JSON file per song, so the same song never
// needs a fresh API lookup twice. Keyed by normalized title+artist rather than
// videoId — different YouTube uploads of the same song (re-uploads, duplicate
// rips, live vs. studio) all share one cache entry.
//
// Filenames are human-readable ("<title> - <artist>.json") on purpose: there is
// no automatic expiration, so if a cached result is wrong or goes stale, the fix
// is to find and delete that file by hand, not wait it out.
//
// `offsetMs` is a per-song manual sync offset (see adjustOffset/resetOffset),
// for nudging timing when a source's timestamps don't quite line up with the
// YouTube upload — defaults to 0 until the user adjusts it via a hotkey/tray.

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const MAX_FILENAME_LENGTH = 150;

function sanitizeFilename(name) {
  const cleaned = name.replace(INVALID_FILENAME_CHARS, '_').replace(/\.+$/, '').trim();
  return cleaned.slice(0, MAX_FILENAME_LENGTH) || 'untitled';
}

// Deliberately distinct from textMatch's normalizeText: that one strips every
// non a-z0-9 character for fuzzy search scoring, which collapses any title
// written entirely in a non-Latin script (Japanese, Korean, Cyrillic, ...) down
// to an empty string. Reusing it here made every such title from the same
// artist share one cache file. This folds case/width variants, whitespace, and
// Latin diacritics (so "Télé" and "Tele" share a cache entry), but — unlike
// normalizeText — never strips a character just for being outside a-z0-9, so
// non-Latin scripts stay intact and distinct instead of collapsing to "".
function normalizeForKey(str) {
  return (str || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics after NFKD split
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function cacheFileNameFor(title, artist) {
  const key = `${normalizeForKey(title)} - ${normalizeForKey(artist)}`;
  return `${sanitizeFilename(key)}.json`;
}

class LyricsCache {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
  }

  _pathFor(title, artist) {
    return path.join(this.cacheDir, cacheFileNameFor(title, artist));
  }

  get(title, artist) {
    try {
      const raw = fs.readFileSync(this._pathFor(title, artist), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null; // no cache file yet, or it's unreadable/corrupt — treat as a miss
    }
  }

  set(title, artist, lyrics) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const entry = {
        title,
        artist,
        ...lyrics,
        offsetMs: lyrics.offsetMs ?? 0,
        cachedAtMs: Date.now(),
      };
      fs.writeFileSync(this._pathFor(title, artist), JSON.stringify(entry, null, 2), 'utf8');
    } catch {
      // best-effort persistence; a failed write just means we re-fetch next time
    }
  }

  delete(title, artist) {
    try {
      fs.unlinkSync(this._pathFor(title, artist));
    } catch {
      // nothing to delete — fine
    }
  }

  // Nudges a song's manual sync offset by deltaMs (positive = lyrics show later,
  // negative = earlier — see renderer.js's updateActiveLine) and persists it.
  // Returns the new offset, or null if the song has no cache entry yet (still
  // loading) — there's nothing to nudge until a lookup has actually completed.
  adjustOffset(title, artist, deltaMs) {
    const entry = this.get(title, artist);
    if (!entry) return null;
    const offsetMs = (entry.offsetMs || 0) + deltaMs;
    this.set(title, artist, { ...entry, offsetMs });
    return offsetMs;
  }

  resetOffset(title, artist) {
    const entry = this.get(title, artist);
    if (!entry) return null;
    this.set(title, artist, { ...entry, offsetMs: 0 });
    return 0;
  }
}

module.exports = { LyricsCache, sanitizeFilename, cacheFileNameFor };
