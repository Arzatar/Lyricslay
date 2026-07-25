'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, dropDuplicatedSecondPass } = require('../src/lrclib');

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

test('parseLrc drops a full second pass concatenated onto the same file (LRCLIB id 2116394)', () => {
  // Real case: this exact LRC (YOASOBI's "アイドル") contains the whole
  // song's Japanese lyrics once, then restarts from 00:00 with a
  // line-by-line romaji transliteration of the same song — every real
  // moment ends up with two entries once naively parsed and sorted.
  const lrc = [
    '[00:00.87]無敵の笑顔で荒らすメディア',
    '[00:03.78]知りたいその秘密ミステリアス',
    '[03:10.71]これは絶対嘘じゃない',
    '[03:13.14]愛してる',
    '[00:00.87]Muteki no egao de arasu media',
    '[00:03.78]Shiritai sono himitsu misuteriasu',
    '[03:10.71]Kore wa zettai uso janai',
    '[03:13.14]Aishiteru',
  ].join('\n');
  const lines = parseLrc(lrc);
  assert.equal(lines.length, 4);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['無敵の笑顔で荒らすメディア', '知りたいその秘密ミステリアス', 'これは絶対嘘じゃない', '愛してる']
  );
});

test('parseLrc keeps every repeat of a legitimately hyper-repetitive song intact', () => {
  // Real case: Daft Punk's "Around the World" (LRCLIB id 22027192) repeats
  // one line ~74 times over 6+ minutes with strictly increasing timestamps
  // the whole way through — nothing here should ever look like a restart.
  const lrc = [
    '[01:04.96]Around the world, around the world',
    '[01:08.29]Around the world, around the world',
    '[04:54.40]',
    '[05:09.56]Around the world, around the world',
    '[05:13.33]Around the world, around the world',
    '[06:27.84]Around the world, around the world',
  ].join('\n');
  const lines = parseLrc(lrc);
  assert.equal(lines.length, 5);
});

test('dropDuplicatedSecondPass leaves a single out-of-order early line alone (not a restart)', () => {
  // Same shape as the existing "out of order" parseLrc test above — a
  // single mistimed line a few seconds in, nowhere near the
  // deep-into-the-song threshold a real second pass needs to trigger on.
  const pairs = [
    { timeMs: 220, text: 'First line' },
    { timeMs: 5330, text: 'Second line' },
    { timeMs: 1000, text: 'Out of order line' },
  ];
  assert.deepEqual(dropDuplicatedSecondPass(pairs), pairs);
});

test('dropDuplicatedSecondPass requires both a deep runningMax and a near-zero drop', () => {
  // A drop that's proportionally big but doesn't land near zero, and one
  // that's near zero but not yet deep into the song, should both be left
  // alone -- only the combination is a real restart signature.
  const partialDrop = [
    { timeMs: 100_000, text: 'a' },
    { timeMs: 15_000, text: 'b' }, // 15% of 100_000 -- not under the 10% ratio
  ];
  assert.deepEqual(dropDuplicatedSecondPass(partialDrop), partialDrop);

  const tooEarly = [
    { timeMs: 10_000, text: 'a' },
    { timeMs: 200, text: 'b' }, // near-zero, but runningMax never reached 60s
  ];
  assert.deepEqual(dropDuplicatedSecondPass(tooEarly), tooEarly);
});
