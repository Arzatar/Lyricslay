'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseUserLyrics, lyricsToEditableText, formatTimeTag } = require('../src/manualLyrics');

test('parseUserLyrics reads LRC lines into sorted timed lyrics', () => {
  const text = '[ar:Los Mox]\n[ti:La tabla del cero]\n\n[00:25.00]Second\n[00:22.5]First\n[Chorus]\n[01:02:34]Third';
  assert.deepEqual(parseUserLyrics(text), {
    timed: [
      { timeMs: 22500, text: 'First' },
      { timeMs: 25000, text: 'Second' },
      { timeMs: 62340, text: 'Third' },
    ],
  });
});

test('parseUserLyrics repeats a line with several time tags at each of them', () => {
  assert.deepEqual(parseUserLyrics('[00:10.00][01:20.00]Chorus line'), {
    timed: [
      { timeMs: 10000, text: 'Chorus line' },
      { timeMs: 80000, text: 'Chorus line' },
    ],
  });
});

test('parseUserLyrics keeps the user\'s own timestamps even when they jump backwards', () => {
  // lrclib.js would treat a big jump back as a duplicated second pass and drop it.
  const out = parseUserLyrics('[02:00.00]Late\n[00:01.00]Early');
  assert.equal(out.timed.length, 2);
});

test('parseUserLyrics treats text with no timestamps as plain/static lyrics', () => {
  assert.deepEqual(parseUserLyrics('  Line one  \nLine two\n\n'), { static: 'Line one\nLine two' });
});

test('parseUserLyrics returns null for empty input', () => {
  assert.equal(parseUserLyrics(''), null);
  assert.equal(parseUserLyrics('   \n  '), null);
  assert.equal(parseUserLyrics(undefined), null);
});

test('formatTimeTag writes [mm:ss.cc]', () => {
  assert.equal(formatTimeTag(0), '[00:00.00]');
  assert.equal(formatTimeTag(62345), '[01:02.34]');
  assert.equal(formatTimeTag(600000), '[10:00.00]');
});

test('lyricsToEditableText round-trips timed lyrics through LRC', () => {
  const lyrics = { timed: [{ timeMs: 22000, text: 'No sé de sumas' }, { timeMs: 25500, text: 'ni menos de restas' }] };
  const text = lyricsToEditableText(lyrics);
  assert.equal(text, '[00:22.00]No sé de sumas\n[00:25.50]ni menos de restas');
  assert.deepEqual(parseUserLyrics(text), { timed: lyrics.timed });
});

test('lyricsToEditableText falls back to static text, or empty when there is nothing', () => {
  assert.equal(lyricsToEditableText({ timed: null, static: 'plain' }), 'plain');
  assert.equal(lyricsToEditableText({ timed: null, static: null, source: 'none' }), '');
  assert.equal(lyricsToEditableText(null), '');
});
