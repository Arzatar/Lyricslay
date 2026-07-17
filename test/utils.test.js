'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trackKeyFor, anchoredBounds, cycleValue, resizeKeepingTopLeftAnchored } = require('../src/utils');

test('trackKeyFor combines title and artist into a stable key', () => {
  assert.equal(trackKeyFor('Song', 'Artist'), 'Song::Artist');
});

test('trackKeyFor trims whitespace so cosmetic differences do not force a re-fetch', () => {
  assert.equal(trackKeyFor('  Song  ', '  Artist  '), 'Song::Artist');
});

test('trackKeyFor treats missing title/artist as empty strings, not "undefined"', () => {
  assert.equal(trackKeyFor(undefined, undefined), '::');
  assert.equal(trackKeyFor('Song', undefined), 'Song::');
});

test('trackKeyFor changes when either title or artist changes', () => {
  const base = trackKeyFor('Song', 'Artist');
  assert.notEqual(trackKeyFor('Other Song', 'Artist'), base);
  assert.notEqual(trackKeyFor('Song', 'Other Artist'), base);
});

test('anchoredBounds centers both axes for "middle-center"', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1392 };
  const bounds = anchoredBounds('middle-center', workArea, { width: 620, height: 260, margin: 24 });
  assert.equal(bounds.x, Math.round((2560 - 620) / 2));
  assert.equal(bounds.y, Math.round((1392 - 260) / 2));
});

test('anchoredBounds places each of the 9 grid cells at the expected edge/center', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1392 };
  const size = { width: 620, height: 260, margin: 24 };
  const centerX = Math.round((2560 - 620) / 2);
  const centerY = Math.round((1392 - 260) / 2);
  const right = 2560 - 620 - 24;
  const bottom = 1392 - 260 - 24;

  assert.deepEqual(anchoredBounds('top-left', workArea, size), { x: 24, y: 24, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('top-center', workArea, size), { x: centerX, y: 24, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('top-right', workArea, size), { x: right, y: 24, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('middle-left', workArea, size), { x: 24, y: centerY, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('middle-right', workArea, size), { x: right, y: centerY, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('bottom-left', workArea, size), { x: 24, y: bottom, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('bottom-center', workArea, size), { x: centerX, y: bottom, width: 620, height: 260 });
  assert.deepEqual(anchoredBounds('bottom-right', workArea, size), { x: right, y: bottom, width: 620, height: 260 });
});

test('anchoredBounds offsets by a non-zero work area origin (secondary monitor)', () => {
  const workArea = { x: 1920, y: 100, width: 1600, height: 900 };
  const bounds = anchoredBounds('top-center', workArea, { width: 620, height: 260, margin: 24 });
  assert.equal(bounds.x, 1920 + Math.round((1600 - 620) / 2));
  assert.equal(bounds.y, 100 + 24);
});

test('anchoredBounds falls back to sensible defaults when size is omitted', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = anchoredBounds('top-center', workArea);
  assert.equal(bounds.width, Math.round(1920 / 3));
  assert.equal(bounds.height, 260);
});

test('anchoredBounds defaults width to a third of the work area (per-monitor scaling)', () => {
  const workArea = { x: 1920, y: 0, width: 2560, height: 1440 };
  const bounds = anchoredBounds('top-center', workArea);
  assert.equal(bounds.width, Math.round(2560 / 3));
});

const LINE_OPTIONS = [1, 3, 5];

test('cycleValue steps forward and backward through the options', () => {
  assert.equal(cycleValue(LINE_OPTIONS, 3, 1), 5);
  assert.equal(cycleValue(LINE_OPTIONS, 3, -1), 1);
});

test('cycleValue clamps at both ends instead of wrapping', () => {
  assert.equal(cycleValue(LINE_OPTIONS, 5, 1), 5);
  assert.equal(cycleValue(LINE_OPTIONS, 1, -1), 1);
});

test('cycleValue treats a current value not in the list as starting from the beginning', () => {
  assert.equal(cycleValue(LINE_OPTIONS, 4, 1), 3);
});

test('resizeKeepingTopLeftAnchored keeps x and y fixed while applying the new width/height', () => {
  const bounds = { x: 100, y: 500, width: 620, height: 260 };
  const resized = resizeKeepingTopLeftAnchored(bounds, 620, 400);
  assert.equal(resized.x, 100);
  assert.equal(resized.y, 500);
  assert.equal(resized.width, 620);
  assert.equal(resized.height, 400);
});

test('resizeKeepingTopLeftAnchored keeps the top edge in place when shrinking too', () => {
  const bounds = { x: 0, y: 500, width: 620, height: 400 };
  const resized = resizeKeepingTopLeftAnchored(bounds, 620, 200);
  assert.equal(resized.y, 500);
});

test('resizeKeepingTopLeftAnchored changes width independently of height, keeping x fixed', () => {
  const bounds = { x: 100, y: 500, width: 620, height: 260 };
  const resized = resizeKeepingTopLeftAnchored(bounds, 850, 260);
  assert.equal(resized.x, 100);
  assert.equal(resized.width, 850);
  assert.equal(resized.height, 260);
});
