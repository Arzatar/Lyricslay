'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { correctSecondsMistakenForMs, parseTimedLyrics } = require('../src/geminiLyrics');

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
