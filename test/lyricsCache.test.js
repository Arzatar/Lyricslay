'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { LyricsCache, sanitizeFilename, cacheFileNameFor } = require('../src/lyricsCache');

function tempCacheDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-cache-test-'));
}

test('sanitizeFilename strips characters that are invalid on Windows', () => {
  assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('sanitizeFilename trims trailing dots (reserved on Windows)', () => {
  assert.equal(sanitizeFilename('trailing...'), 'trailing');
});

test('sanitizeFilename falls back to "untitled" for an empty result', () => {
  assert.equal(sanitizeFilename(''), 'untitled');
  assert.equal(sanitizeFilename('...'), 'untitled'); // all-dots strips to nothing
});

test('sanitizeFilename caps very long names', () => {
  const long = 'x'.repeat(300);
  assert.ok(sanitizeFilename(long).length <= 150);
});

test('cacheFileNameFor is case/accent-insensitive (matches by name, not exact text)', () => {
  const a = cacheFileNameFor('Apaga la Tele', 'Macha');
  const b = cacheFileNameFor('APAGA LA TELE', 'macha');
  const c = cacheFileNameFor('Apaga La Télé', 'Macha');
  assert.equal(a, b);
  assert.equal(a, c);
});

test('cacheFileNameFor produces a readable "title - artist.json" name', () => {
  assert.equal(cacheFileNameFor('Song', 'Artist'), 'song - artist.json');
});

test('LyricsCache.get returns null for a song that was never cached', () => {
  const cache = new LyricsCache(tempCacheDir());
  assert.equal(cache.get('Nonexistent', 'Nobody'), null);
});

test('LyricsCache.set then .get round-trips the lyrics and adds cachedAtMs/offsetMs', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Song', 'Artist', { timed: [{ timeMs: 0, text: 'la' }], static: null, source: 'lrclib-synced' });

  const entry = cache.get('Song', 'Artist');
  assert.equal(entry.title, 'Song');
  assert.equal(entry.artist, 'Artist');
  assert.equal(entry.source, 'lrclib-synced');
  assert.deepEqual(entry.timed, [{ timeMs: 0, text: 'la' }]);
  assert.equal(entry.offsetMs, 0);
  assert.ok(Number.isFinite(entry.cachedAtMs));
});

test('LyricsCache matches by normalized title+artist regardless of videoId or exact casing', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Apaga la Tele', 'Macha Y El Bloque Depresivo', {
    videoId: 'first-upload-id',
    timed: [{ timeMs: 0, text: 'la' }],
    static: null,
    source: 'lrclib-synced',
  });

  // A different YouTube re-upload of the exact same song (different videoId, same
  // name) must hit the same cache entry rather than triggering a fresh lookup.
  const hit = cache.get('APAGA LA TELE', 'macha y el bloque depresivo');
  assert.ok(hit);
  assert.equal(hit.videoId, 'first-upload-id');
});

test('LyricsCache never expires — a "not found" result stays cached until deleted', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Obscure Song', 'Unknown Artist', { timed: null, static: null, source: 'none' });

  // Simulate an old cache file (would have expired under a TTL scheme) — still a hit.
  const filePath = cache._pathFor('Obscure Song', 'Unknown Artist');
  const entry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  entry.cachedAtMs = 0; // as old as it gets
  fs.writeFileSync(filePath, JSON.stringify(entry));

  assert.ok(cache.get('Obscure Song', 'Unknown Artist'));
});

test('LyricsCache.delete removes the entry so the next get() is a miss', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Song', 'Artist', { timed: null, static: 'lyrics text', source: 'ytmusic-static' });
  assert.ok(cache.get('Song', 'Artist'));

  cache.delete('Song', 'Artist');
  assert.equal(cache.get('Song', 'Artist'), null);
});

test('LyricsCache.delete on a non-existent entry does not throw', () => {
  const cache = new LyricsCache(tempCacheDir());
  assert.doesNotThrow(() => cache.delete('Never Cached', 'Nobody'));
});

test('LyricsCache creates the cache directory lazily on first set()', () => {
  const dir = path.join(tempCacheDir(), 'nested', 'cache-dir');
  const cache = new LyricsCache(dir);
  assert.equal(fs.existsSync(dir), false);
  cache.set('Song', 'Artist', { timed: null, static: 'x', source: 'ytmusic-static' });
  assert.equal(fs.existsSync(dir), true);
});

test('adjustOffset nudges an existing entry by delta and persists it', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Song', 'Artist', { timed: [{ timeMs: 0, text: 'la' }], static: null, source: 'lrclib-synced' });

  assert.equal(cache.adjustOffset('Song', 'Artist', 100), 100);
  assert.equal(cache.adjustOffset('Song', 'Artist', 100), 200);
  assert.equal(cache.adjustOffset('Song', 'Artist', -50), 150);

  assert.equal(cache.get('Song', 'Artist').offsetMs, 150);
});

test('adjustOffset returns null and does nothing for a song with no cache entry', () => {
  const cache = new LyricsCache(tempCacheDir());
  assert.equal(cache.adjustOffset('Nonexistent', 'Nobody', 100), null);
  assert.equal(cache.get('Nonexistent', 'Nobody'), null);
});

test('adjustOffset preserves the rest of the cached entry', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Song', 'Artist', { timed: [{ timeMs: 0, text: 'la' }], static: null, source: 'lrclib-synced' });

  cache.adjustOffset('Song', 'Artist', 100);
  const entry = cache.get('Song', 'Artist');
  assert.equal(entry.source, 'lrclib-synced');
  assert.deepEqual(entry.timed, [{ timeMs: 0, text: 'la' }]);
});

test('resetOffset zeroes an existing entry\'s offset', () => {
  const cache = new LyricsCache(tempCacheDir());
  cache.set('Song', 'Artist', { timed: null, static: 'x', source: 'ytmusic-static' });
  cache.adjustOffset('Song', 'Artist', 300);

  assert.equal(cache.resetOffset('Song', 'Artist'), 0);
  assert.equal(cache.get('Song', 'Artist').offsetMs, 0);
});

test('resetOffset returns null for a song with no cache entry', () => {
  const cache = new LyricsCache(tempCacheDir());
  assert.equal(cache.resetOffset('Nonexistent', 'Nobody'), null);
});
