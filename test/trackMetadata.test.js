'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripJunkAnnotations, extractArtistFromTitle, cleanTrackMetadata } = require('../src/trackMetadata');

test('stripJunkAnnotations removes a trailing "(letra)" annotation', () => {
  assert.equal(stripJunkAnnotations('Curao manejo mejor! (letra)'), 'Curao manejo mejor!');
});

test('stripJunkAnnotations removes common English upload annotations', () => {
  assert.equal(stripJunkAnnotations('Bohemian Rhapsody (Official Video)'), 'Bohemian Rhapsody');
  assert.equal(stripJunkAnnotations('Bohemian Rhapsody (Official Music Video)'), 'Bohemian Rhapsody');
  assert.equal(stripJunkAnnotations('Bohemian Rhapsody [HD]'), 'Bohemian Rhapsody');
  assert.equal(stripJunkAnnotations('Bohemian Rhapsody (Lyrics)'), 'Bohemian Rhapsody');
});

test('stripJunkAnnotations removes common Spanish upload annotations', () => {
  assert.equal(stripJunkAnnotations('Curao manejo mejor (video oficial)'), 'Curao manejo mejor');
  assert.equal(stripJunkAnnotations('Curao manejo mejor (con letra)'), 'Curao manejo mejor');
  assert.equal(stripJunkAnnotations('Curao manejo mejor (en vivo)'), 'Curao manejo mejor');
});

test('stripJunkAnnotations strips multiple stacked trailing annotations', () => {
  assert.equal(stripJunkAnnotations('Song (Official Video) (HD)'), 'Song');
});

test('stripJunkAnnotations leaves a meaningful parenthetical alone', () => {
  assert.equal(stripJunkAnnotations('Toxicity (System of a Down song)'), 'Toxicity (System of a Down song)');
  assert.equal(stripJunkAnnotations('Bohemian Rhapsody (Live Aid)'), 'Bohemian Rhapsody (Live Aid)');
});

test('stripJunkAnnotations leaves a title with no trailing parenthetical unchanged', () => {
  assert.equal(stripJunkAnnotations('Just A Normal Title'), 'Just A Normal Title');
});

test('stripJunkAnnotations handles empty/missing input', () => {
  assert.equal(stripJunkAnnotations(''), '');
  assert.equal(stripJunkAnnotations(undefined), '');
  assert.equal(stripJunkAnnotations(null), '');
});

test('extractArtistFromTitle splits an "Artist: Song" pattern', () => {
  assert.deepEqual(extractArtistFromTitle('Los Mox: Curao manejo mejor!'), {
    artist: 'Los Mox',
    title: 'Curao manejo mejor!',
  });
});

test('extractArtistFromTitle splits an "Artist - Song" pattern', () => {
  assert.deepEqual(extractArtistFromTitle('Queen - Bohemian Rhapsody'), {
    artist: 'Queen',
    title: 'Bohemian Rhapsody',
  });
});

test('extractArtistFromTitle returns null when there is no separator', () => {
  assert.equal(extractArtistFromTitle('Just A Normal Title'), null);
});

test('extractArtistFromTitle does not split a hyphenated compound-word title', () => {
  // Real case: SMTC reported this single-word title for a song with no
  // artist prefix, and it was wrongly split into artist "Bling" / title
  // "Bang-Bang-Born" on the first bare hyphen, which then searched for and
  // matched an unrelated fan cover video instead of the real song.
  assert.equal(extractArtistFromTitle('Bling-Bang-Bang-Born'), null);
});

test('extractArtistFromTitle still splits "Artist - Song" when the artist itself contains a hyphen', () => {
  assert.deepEqual(extractArtistFromTitle('X-Ray Spex - Oh Bondage Up Yours!'), {
    artist: 'X-Ray Spex',
    title: 'Oh Bondage Up Yours!',
  });
});

test('extractArtistFromTitle returns null for empty/missing input', () => {
  assert.equal(extractArtistFromTitle(''), null);
  assert.equal(extractArtistFromTitle(undefined), null);
});

test('cleanTrackMetadata fixes the real motivating case (channel-name artist + junk title)', () => {
  const result = cleanTrackMetadata('Los Mox: Curao manejo mejor! (letra)', 'neohex');
  assert.deepEqual(result, { title: 'Curao manejo mejor!', artist: 'Los Mox' });
});

test('cleanTrackMetadata is a no-op for an already-clean title/artist pair', () => {
  const result = cleanTrackMetadata('Bohemian Rhapsody', 'Queen');
  assert.deepEqual(result, { title: 'Bohemian Rhapsody', artist: 'Queen' });
});

test('cleanTrackMetadata keeps the original artist when the title has no extractable artist prefix', () => {
  const result = cleanTrackMetadata('Bohemian Rhapsody (Official Video)', 'Queen');
  assert.deepEqual(result, { title: 'Bohemian Rhapsody', artist: 'Queen' });
});

test('cleanTrackMetadata trims the original artist even when the title is untouched', () => {
  const result = cleanTrackMetadata('Bohemian Rhapsody', '  Queen  ');
  assert.deepEqual(result, { title: 'Bohemian Rhapsody', artist: 'Queen' });
});
