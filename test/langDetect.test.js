'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isJapaneseText, lyricsAreJapanese } = require('../src/langDetect');

test('isJapaneseText detects hiragana', () => {
  assert.equal(isJapaneseText('こんにちは'), true);
});

test('isJapaneseText detects katakana', () => {
  assert.equal(isJapaneseText('コンビニ'), true);
});

test('isJapaneseText detects mixed kanji/kana', () => {
  assert.equal(isJapaneseText('私は元気です'), true);
});

test('isJapaneseText returns false for kanji-only text (ambiguous with Chinese, not checked)', () => {
  assert.equal(isJapaneseText('中国'), false);
});

test('isJapaneseText returns false for English/Spanish text', () => {
  assert.equal(isJapaneseText('Hello world'), false);
  assert.equal(isJapaneseText('Hola, cómo estás'), false);
});

test('isJapaneseText handles non-string input without throwing', () => {
  assert.equal(isJapaneseText(null), false);
  assert.equal(isJapaneseText(undefined), false);
  assert.equal(isJapaneseText(42), false);
});

test('lyricsAreJapanese detects Japanese in a timed lyrics array', () => {
  const lyrics = { timed: [{ timeMs: 0, text: 'Hello' }, { timeMs: 100, text: 'ありがとう' }] };
  assert.equal(lyricsAreJapanese(lyrics), true);
});

test('lyricsAreJapanese returns false when no timed line is Japanese', () => {
  const lyrics = { timed: [{ timeMs: 0, text: 'Hello' }, { timeMs: 100, text: 'Goodbye' }] };
  assert.equal(lyricsAreJapanese(lyrics), false);
});

test('lyricsAreJapanese detects Japanese in static text', () => {
  assert.equal(lyricsAreJapanese({ static: 'これはテストです' }), true);
});

test('lyricsAreJapanese returns false for null/empty lyrics', () => {
  assert.equal(lyricsAreJapanese(null), false);
  assert.equal(lyricsAreJapanese({ timed: null, static: null }), false);
});
