'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractSongCandidates, extractLyricsFromHtml, removeExcludedSections } = require('../src/genius');

function searchResponseFixture(hits) {
  return {
    response: {
      sections: [
        { type: 'top_hit', hits: [] },
        { type: 'song', hits },
      ],
    },
  };
}

function songHit({ url, title, artist }) {
  return { type: 'song', result: { url, title, primary_artist: { name: artist } } };
}

test('extractSongCandidates reads url/title/artist out of the song section', () => {
  const json = searchResponseFixture([
    songHit({ url: 'https://genius.com/a', title: 'Apaga la Tele', artist: 'Macha' }),
  ]);
  const candidates = extractSongCandidates(json);
  assert.deepEqual(candidates, [{ url: 'https://genius.com/a', title: 'Apaga la Tele', artist: 'Macha' }]);
});

test('extractSongCandidates skips hits with no url', () => {
  const json = searchResponseFixture([songHit({ url: undefined, title: 'X', artist: 'Y' })]);
  assert.deepEqual(extractSongCandidates(json), []);
});

test('extractSongCandidates returns [] when there is no song section', () => {
  const json = { response: { sections: [{ type: 'top_hit', hits: [] }] } };
  assert.deepEqual(extractSongCandidates(json), []);
});

test('extractSongCandidates returns [] for a malformed/empty response', () => {
  assert.deepEqual(extractSongCandidates({}), []);
  assert.deepEqual(extractSongCandidates(null), []);
});

test('extractLyricsFromHtml pulls text out of a single lyrics container', () => {
  const html = '<div data-lyrics-container="true">Line one<br>Line two</div>';
  assert.equal(extractLyricsFromHtml(html), 'Line one\nLine two');
});

test('extractLyricsFromHtml strips inline annotation wrappers without losing line breaks', () => {
  // Genius wraps annotated words in inline tags (a/span) *within* a line, with
  // real line breaks still marked by <br> — not nested block-level divs.
  const html =
    '<div data-lyrics-container="true">Line one<br><a href="#" class="ReferentFragment">Line two</a><br>Line three</div>';
  assert.equal(extractLyricsFromHtml(html), 'Line one\nLine two\nLine three');
});

test('extractLyricsFromHtml correctly finds the end of a container that has nested block-level divs', () => {
  // Regardless of how the divs affect line breaks, the depth-counting scan must
  // still find *this* container's true closing tag and not stop at the nested one's.
  const html =
    '<div data-lyrics-container="true">Before<div class="Nested">Inside</div>After</div><div>unrelated</div>';
  const text = extractLyricsFromHtml(html);
  assert.ok(text.includes('Before'));
  assert.ok(text.includes('Inside'));
  assert.ok(text.includes('After'));
  assert.ok(!text.includes('unrelated'));
});

test('extractLyricsFromHtml joins multiple containers (verse/chorus split across divs)', () => {
  const html =
    '<div data-lyrics-container="true">First verse</div><p>ad</p><div data-lyrics-container="true">Second verse</div>';
  assert.equal(extractLyricsFromHtml(html), 'First verse\nSecond verse');
});

test('extractLyricsFromHtml decodes common HTML entities', () => {
  const html = '<div data-lyrics-container="true">Rock &amp; Roll &quot;baby&quot;</div>';
  assert.equal(extractLyricsFromHtml(html), 'Rock & Roll "baby"');
});

test('extractLyricsFromHtml collapses 3+ blank lines down to one', () => {
  const html = '<div data-lyrics-container="true">A<br><br><br><br>B</div>';
  assert.equal(extractLyricsFromHtml(html), 'A\n\nB');
});

test('extractLyricsFromHtml returns null when no container is present', () => {
  assert.equal(extractLyricsFromHtml('<div>no lyrics container here</div>'), null);
  assert.equal(extractLyricsFromHtml(''), null);
});

test('extractLyricsFromHtml drops the contributor-count/title header Genius marks as excluded', () => {
  // Real shape seen on genius.com: a data-exclude-from-selection header (contributor
  // count, song title + "Lyrics", a share button, ...) sits *inside* the lyrics
  // container, directly before the actual lyrics — with no whitespace between them,
  // which previously glued onto the first real line ("1 ContributorSong Lyrics<first line>").
  const html =
    '<div data-lyrics-container="true">' +
    '<div data-exclude-from-selection="true" class="LyricsHeader">' +
    '<button class="ContributorsCredit">1 Contributor</button>Song Title Lyrics</div>' +
    'No se de sumas ni menos de restas<br>Pero lo tuyo es lo mismo en las fiestas' +
    '</div>';
  assert.equal(extractLyricsFromHtml(html), 'No se de sumas ni menos de restas\nPero lo tuyo es lo mismo en las fiestas');
});

test('removeExcludedSections strips a data-exclude-from-selection block and its nested content', () => {
  const html = '<div data-exclude-from-selection="true"><button>x</button>header junk</div>real content';
  assert.equal(removeExcludedSections(html), 'real content');
});

test('removeExcludedSections leaves html with no excluded section untouched', () => {
  assert.equal(removeExcludedSections('just some text'), 'just some text');
});

test('removeExcludedSections handles multiple excluded sections', () => {
  const html = '<div data-exclude-from-selection="true">A</div>keep1<div data-exclude-from-selection="true">B</div>keep2';
  assert.equal(removeExcludedSections(html), 'keep1keep2');
});
