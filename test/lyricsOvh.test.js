'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLyricsOvhResponse } = require('../src/lyricsOvh');

test('parseLyricsOvhResponse returns the trimmed lyrics text when present', () => {
  assert.equal(parseLyricsOvhResponse({ lyrics: '  Some lyrics\n\n' }), 'Some lyrics');
});

test('parseLyricsOvhResponse returns null when lyrics field is missing', () => {
  assert.equal(parseLyricsOvhResponse({}), null);
  assert.equal(parseLyricsOvhResponse(null), null);
  assert.equal(parseLyricsOvhResponse(undefined), null);
});

test('parseLyricsOvhResponse returns null for whitespace-only lyrics', () => {
  assert.equal(parseLyricsOvhResponse({ lyrics: '   \n\n  ' }), null);
});

test('parseLyricsOvhResponse returns null for an empty string', () => {
  assert.equal(parseLyricsOvhResponse({ lyrics: '' }), null);
});
