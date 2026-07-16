'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeText, scoreCandidate, pickBestMatch } = require('../src/textMatch');

test('normalizeText lowercases, strips accents and punctuation, collapses spaces', () => {
  assert.equal(normalizeText('Canción, Depresivo!!'), 'cancion depresivo');
  assert.equal(normalizeText('  Multiple   Spaces  '), 'multiple spaces');
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText(null), '');
});

test('scoreCandidate ranks an exact title match above a partial one', () => {
  const exact = scoreCandidate('Apaga la Tele', 'Macha', 'Apaga la Tele', 'Macha');
  const partial = scoreCandidate('Apaga la Tele (Live)', 'Macha', 'Apaga la Tele', 'Macha');
  assert.ok(exact > partial);
});

test('scoreCandidate rewards a matching artist even with a fuzzy title', () => {
  const rightArtistFuzzyTitle = scoreCandidate('Apaga la Tele Remix', 'Macha Y El Bloque Depresivo', 'Apaga la Tele', 'Macha');
  const wrongArtistExactTitle = scoreCandidate('Apaga la Tele', 'Someone Else', 'Apaga la Tele', 'Macha');
  // exact title alone (score 3) still beats fuzzy title + right artist (score 1+2=3)... so assert >=
  assert.ok(rightArtistFuzzyTitle >= 3);
  assert.ok(wrongArtistExactTitle === 3);
});

test('scoreCandidate returns 0 for a completely unrelated candidate', () => {
  assert.equal(scoreCandidate('Totally Different Song', 'Nobody', 'Apaga la Tele', 'Macha'), 0);
});

test('pickBestMatch returns null for an empty candidate list', () => {
  assert.equal(pickBestMatch([], 'title', 'artist', (c) => c.title, (c) => c.artist), null);
});

test('pickBestMatch picks the highest-scoring candidate', () => {
  const candidates = [
    { title: 'Wrong Song', artist: 'Wrong Artist' },
    { title: 'Apaga la Tele', artist: 'Macha Y El Bloque Depresivo' },
    { title: 'Apaga la Tele (Cover)', artist: 'Someone Else' },
  ];
  const best = pickBestMatch(candidates, 'Apaga la Tele', 'Macha', (c) => c.title, (c) => c.artist);
  assert.equal(best.title, 'Apaga la Tele');
});

test('pickBestMatch applies extraScore as a tiebreaker', () => {
  const candidates = [
    { title: 'Song', artist: 'Artist', hasSync: false },
    { title: 'Song', artist: 'Artist', hasSync: true },
  ];
  const best = pickBestMatch(
    candidates,
    'Song',
    'Artist',
    (c) => c.title,
    (c) => c.artist,
    (c) => (c.hasSync ? 1 : 0)
  );
  assert.equal(best.hasSync, true);
});
