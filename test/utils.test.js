'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trackKeyFor, topCenterBounds, cycleValue, resizeKeepingTopLeftAnchored } = require('../src/utils');

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

test('topCenterBounds horizontally centers the window in the given work area', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1392 };
  const bounds = topCenterBounds(workArea, { width: 620, height: 260, margin: 24 });
  assert.equal(bounds.x, Math.round((2560 - 620) / 2));
  assert.equal(bounds.y, 24);
  assert.equal(bounds.width, 620);
  assert.equal(bounds.height, 260);
});

test('topCenterBounds offsets by a non-zero work area origin (secondary monitor)', () => {
  const workArea = { x: 1920, y: 100, width: 1600, height: 900 };
  const bounds = topCenterBounds(workArea, { width: 620, height: 260, margin: 24 });
  assert.equal(bounds.x, 1920 + Math.round((1600 - 620) / 2));
  assert.equal(bounds.y, 100 + 24);
});

test('topCenterBounds falls back to sensible defaults when size is omitted', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = topCenterBounds(workArea);
  assert.equal(bounds.width, Math.round(1920 / 3));
  assert.equal(bounds.height, 260);
});

test('topCenterBounds defaults width to a third of the work area (per-monitor scaling)', () => {
  const workArea = { x: 1920, y: 0, width: 2560, height: 1440 };
  const bounds = topCenterBounds(workArea);
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
