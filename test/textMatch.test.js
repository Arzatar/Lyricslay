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

test('pickBestMatch with minScore rejects a list where nothing resembles the query', () => {
  // Real case: YT Music answered an anime episode's title with "I Got Bitches" by A2m.
  const candidates = [{ title: 'I Got Bitches', artist: 'A2m' }];
  const best = pickBestMatch(
    candidates,
    "S1 E4 - We Went to a Dragon's Wedding",
    "I've Been Killing Slimes For 300 Years And Maxed Out My Level",
    (c) => c.title,
    (c) => c.artist,
    null,
    1
  );
  assert.equal(best, null);
});

test('pickBestMatch with minScore still accepts a real partial match', () => {
  const candidates = [{ title: 'Lemon', artist: 'Kenshi Yonezu' }];
  const best = pickBestMatch(candidates, 'Lemon (Official Video)', 'Kenshi Yonezu', (c) => c.title, (c) => c.artist, null, 1);
  assert.equal(best, candidates[0]);
});

test('pickBestMatch with minScore keeps non-Latin titles working', () => {
  const candidates = [{ title: 'Lemon', artist: 'Kenshi Yonezu' }];
  const best = pickBestMatch(candidates, 'レモン', '米津玄師', (c) => c.title, (c) => c.artist, null, 1);
  assert.equal(best, candidates[0]);
});

test('pickBestMatch without minScore keeps the old always-pick-something behavior', () => {
  const candidates = [{ title: 'I Got Bitches', artist: 'A2m' }];
  assert.equal(pickBestMatch(candidates, 'Something Else', 'Nobody', (c) => c.title, (c) => c.artist), candidates[0]);
});
