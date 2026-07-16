'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc } = require('../src/lrclib');

test('parseLrc returns null for empty or missing input', () => {
  assert.equal(parseLrc(''), null);
  assert.equal(parseLrc(null), null);
  assert.equal(parseLrc(undefined), null);
});

test('parseLrc converts [mm:ss.xx] tags into sorted millisecond timestamps', () => {
  const lrc = '[00:00.22]First line\n[00:05.33]Second line\n[00:01.00]Out of order line';
  const lines = parseLrc(lrc);
  assert.deepEqual(
    lines.map((l) => l.timeMs),
    [220, 1000, 5330]
  );
  assert.equal(lines[0].text, 'First line');
});

test('parseLrc handles timestamps without a fractional part', () => {
  const lines = parseLrc('[01:02]No fraction');
  assert.equal(lines[0].timeMs, 62000);
});

test('parseLrc ignores metadata tags like [ar:], [ti:], [al:]', () => {
  const lrc = '[ar:Some Artist]\n[ti:Some Title]\n[00:10.00]Actual lyric line';
  const lines = parseLrc(lrc);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Actual lyric line');
});

test('parseLrc drops lines that have a timestamp but no text', () => {
  const lines = parseLrc('[00:01.00]\n[00:02.00]Real line');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Real line');
});

test('parseLrc returns null when no line has a valid timestamp', () => {
  assert.equal(parseLrc('just plain text\nno timestamps here'), null);
});

test('parseLrc supports multiple timestamps sharing one line of text', () => {
  const lines = parseLrc('[00:01.00][00:10.00]Repeated chorus line');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'Repeated chorus line');
  assert.equal(lines[1].text, 'Repeated chorus line');
});
