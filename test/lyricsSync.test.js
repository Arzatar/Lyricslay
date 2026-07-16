'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findActiveLineIndex, interpolatePositionMs, scrollRatio } = require('../src/renderer/lyricsSync');

const LINES = [
  { timeMs: 0, text: 'first' },
  { timeMs: 1000, text: 'second' },
  { timeMs: 5000, text: 'third' },
];

test('findActiveLineIndex returns -1 before playback reaches the first line', () => {
  assert.equal(findActiveLineIndex(LINES, -1), -1);
});

test('findActiveLineIndex returns -1 for an empty or missing line list', () => {
  assert.equal(findActiveLineIndex([], 1000), -1);
  assert.equal(findActiveLineIndex(null, 1000), -1);
});

test('findActiveLineIndex picks the last line whose timestamp has passed', () => {
  assert.equal(findActiveLineIndex(LINES, 0), 0);
  assert.equal(findActiveLineIndex(LINES, 500), 0);
  assert.equal(findActiveLineIndex(LINES, 1000), 1);
  assert.equal(findActiveLineIndex(LINES, 4999), 1);
  assert.equal(findActiveLineIndex(LINES, 5000), 2);
  assert.equal(findActiveLineIndex(LINES, 999999), 2);
});

test('interpolatePositionMs advances position by wall-clock elapsed time', () => {
  assert.equal(interpolatePositionMs(1000, 0, 500), 1500);
});

test('interpolatePositionMs never goes backwards on a negative/clock-skew delta', () => {
  assert.equal(interpolatePositionMs(1000, 500, 100), 1000);
});

test('scrollRatio is 0 with no duration and clamps to [0, 1]', () => {
  assert.equal(scrollRatio(1000, 0), 0);
  assert.equal(scrollRatio(-500, 1000), 0);
  assert.equal(scrollRatio(500, 1000), 0.5);
  assert.equal(scrollRatio(5000, 1000), 1);
});
