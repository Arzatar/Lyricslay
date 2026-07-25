'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  correctSecondsMistakenForMs,
  dropLinesPastKnownDuration,
  parseTimedLyrics,
  parseGroundedTimedLyrics,
  splitKnownLyricsLines,
} = require('../src/geminiLyrics');

test('correctSecondsMistakenForMs multiplies by 1000 when the model answered in seconds', () => {
  // Real case: a 238.492s song came back with every line under 220 "ms".
  const timed = [
    { timeMs: 0, text: 'a' },
    { timeMs: 3, text: 'b' },
    { timeMs: 217, text: 'c' },
  ];
  const corrected = correctSecondsMistakenForMs(timed, 238492);
  assert.deepEqual(corrected, [
    { timeMs: 0, text: 'a' },
    { timeMs: 3000, text: 'b' },
    { timeMs: 217000, text: 'c' },
  ]);
});

test('correctSecondsMistakenForMs leaves already-correct millisecond timestamps alone', () => {
  const timed = [
    { timeMs: 0, text: 'a' },
    { timeMs: 65000, text: 'b' },
    { timeMs: 230000, text: 'c' },
  ];
  const corrected = correctSecondsMistakenForMs(timed, 238492);
  assert.deepEqual(corrected, timed);
});

test('correctSecondsMistakenForMs is a no-op without a known duration', () => {
  const timed = [{ timeMs: 3, text: 'a' }];
  assert.deepEqual(correctSecondsMistakenForMs(timed, null), timed);
  assert.deepEqual(correctSecondsMistakenForMs(timed, NaN), timed);
  assert.deepEqual(correctSecondsMistakenForMs(timed, 0), timed);
});

test('correctSecondsMistakenForMs is a no-op on an empty array', () => {
  assert.deepEqual(correctSecondsMistakenForMs([], 238492), []);
});

test('correctSecondsMistakenForMs does not misfire on a normal short song', () => {
  // A short (~90s) song correctly reported in ms shouldn't trip the
  // seconds-heuristic just because the ratio happens to drift a bit.
  const timed = [
    { timeMs: 0, text: 'a' },
    { timeMs: 45000, text: 'b' },
    { timeMs: 88000, text: 'c' },
  ];
  const corrected = correctSecondsMistakenForMs(timed, 90000);
  assert.deepEqual(corrected, timed);
});

test('dropLinesPastKnownDuration drops a hallucinated tail block past the real song length', () => {
  // Real case: a grounded response for "Victim or Survivor" (Citizen
  // Soldier), a 175071ms track per both LRCLIB and SMTC, repeated an entire
  // bridge+chorus block a second time with timestamps stretching to
  // ~249678ms — 75s past the song's actual end.
  const timed = [
    { timeMs: 159398, text: 'I’m the survivor' },
    { timeMs: 204368, text: 'I’m not I’m not I’m not the victim' },
    { timeMs: 249678, text: 'Victim or survivor' },
  ];
  assert.deepEqual(dropLinesPastKnownDuration(timed, 175071), [{ timeMs: 159398, text: 'I’m the survivor' }]);
});

test('dropLinesPastKnownDuration keeps a natural fade-out tail within a few seconds of the known duration', () => {
  const timed = [
    { timeMs: 100000, text: 'a' },
    { timeMs: 178000, text: 'b' },
  ];
  assert.deepEqual(dropLinesPastKnownDuration(timed, 175071), timed);
});

test('dropLinesPastKnownDuration is a no-op without a known duration', () => {
  const timed = [{ timeMs: 999999, text: 'a' }];
  assert.deepEqual(dropLinesPastKnownDuration(timed, null), timed);
  assert.deepEqual(dropLinesPastKnownDuration(timed, 0), timed);
});

test('parseTimedLyrics parses a valid Gemini response into sorted timed lines', () => {
  const json = {
    candidates: [{ content: { parts: [{ text: '[{"timeMs":5000,"text":"b"},{"timeMs":1000,"text":"a"}]' }] } }],
  };
  assert.deepEqual(parseTimedLyrics(json), [
    { timeMs: 1000, text: 'a' },
    { timeMs: 5000, text: 'b' },
  ]);
});

test('parseTimedLyrics returns null for an empty array (instrumental track)', () => {
  const json = { candidates: [{ content: { parts: [{ text: '[]' }] } }] };
  assert.equal(parseTimedLyrics(json), null);
});

test('parseTimedLyrics returns null for malformed JSON', () => {
  const json = { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
  assert.equal(parseTimedLyrics(json), null);
});

test('splitKnownLyricsLines strips blank lines and pure section markers', () => {
  const text = '[Chorus]\nHello world\n\n(Verse 2)\nGoodbye\n[Bridge] extra';
  assert.deepEqual(splitKnownLyricsLines(text), ['Hello world', 'Goodbye', '[Bridge] extra']);
});

test('splitKnownLyricsLines strips bracket-free section labels (LRCLIB style)', () => {
  // Real case: LRCLIB's plainLyrics for "Victim or Survivor" by Citizen
  // Soldier spells section headers as bare all-caps lines with no
  // brackets/parens at all ("VERSE 1", "CHORUS 2", "BRIDGE"). Left in, these
  // were handed to Gemini as if they were real numbered lyric lines needing
  // a timestamp, which produced a bogus/duplicated timing block running
  // well past the song's actual (LRCLIB- and SMTC-agreed) 175s duration.
  const text = 'VERSE 1\nHello world\nPRE-CHORUS 1\nCHORUS\nGoodbye\nCHORUS 2\nBRIDGE\nCHORUS 3.\nOne more line';
  assert.deepEqual(splitKnownLyricsLines(text), ['Hello world', 'Goodbye', 'One more line']);
});

test('splitKnownLyricsLines returns [] for empty/missing input', () => {
  assert.deepEqual(splitKnownLyricsLines(''), []);
  assert.deepEqual(splitKnownLyricsLines(null), []);
  assert.deepEqual(splitKnownLyricsLines(undefined), []);
});

test('parseGroundedTimedLyrics maps indices back to the original known-line text', () => {
  const knownLines = ['Hello world', 'Goodbye'];
  const json = {
    candidates: [{ content: { parts: [{ text: '[{"timeMs":5000,"index":2},{"timeMs":1000,"index":1}]' }] } }],
  };
  assert.deepEqual(parseGroundedTimedLyrics(json, knownLines), [
    { timeMs: 1000, text: 'Hello world' },
    { timeMs: 5000, text: 'Goodbye' },
  ]);
});

test('parseGroundedTimedLyrics drops out-of-range or non-integer indices', () => {
  const knownLines = ['Hello world', 'Goodbye'];
  const json = {
    candidates: [{
      content: {
        parts: [{
          text: '[{"timeMs":1000,"index":1},{"timeMs":2000,"index":0},{"timeMs":3000,"index":3},{"timeMs":4000,"index":1.5}]',
        }],
      },
    }],
  };
  assert.deepEqual(parseGroundedTimedLyrics(json, knownLines), [{ timeMs: 1000, text: 'Hello world' }]);
});

test('parseGroundedTimedLyrics returns null when nothing valid survives', () => {
  const json = { candidates: [{ content: { parts: [{ text: '[]' }] } }] };
  assert.equal(parseGroundedTimedLyrics(json, ['a']), null);
});
