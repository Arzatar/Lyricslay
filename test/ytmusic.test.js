'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractSongCandidates, extractStaticLyrics, extractTimedLyrics } = require('../src/ytmusic');

function searchResponseFixture(items) {
  return {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [{ musicShelfRenderer: { contents: items } }],
                },
              },
            },
          },
        ],
      },
    },
  };
}

function songItem({ videoId, title, artist }) {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: artist }] } } },
      ],
    },
  };
}

test('extractSongCandidates reads videoId/title/artist out of a search response', () => {
  const json = searchResponseFixture([
    songItem({ videoId: 'abc123', title: 'Apaga la Tele', artist: 'Macha Y El Bloque Depresivo' }),
  ]);
  const candidates = extractSongCandidates(json);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0], {
    videoId: 'abc123',
    title: 'Apaga la Tele',
    artist: 'Macha Y El Bloque Depresivo',
  });
});

test('extractSongCandidates falls back to the play-button overlay videoId when playlistItemData is absent', () => {
  const json = searchResponseFixture([
    {
      musicResponsiveListItemRenderer: {
        overlay: {
          musicItemThumbnailOverlayRenderer: {
            content: {
              musicPlayButtonRenderer: {
                playNavigationEndpoint: { watchEndpoint: { videoId: 'xyz789' } },
              },
            },
          },
        },
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Title' }] } } },
        ],
      },
    },
  ]);
  const candidates = extractSongCandidates(json);
  assert.equal(candidates[0].videoId, 'xyz789');
});

test('extractSongCandidates skips items with no resolvable videoId', () => {
  const json = searchResponseFixture([{ musicResponsiveListItemRenderer: { flexColumns: [] } }]);
  assert.deepEqual(extractSongCandidates(json), []);
});

test('extractSongCandidates returns [] for a malformed/empty response', () => {
  assert.deepEqual(extractSongCandidates({}), []);
  assert.deepEqual(extractSongCandidates(null), []);
});

test('extractStaticLyrics joins description runs into one string', () => {
  const json = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            musicDescriptionShelfRenderer: {
              description: { runs: [{ text: 'Line one\n' }, { text: 'Line two' }] },
            },
          },
        ],
      },
    },
  };
  assert.equal(extractStaticLyrics(json), 'Line one\nLine two');
});

test('extractStaticLyrics returns null when there is no description shelf', () => {
  assert.equal(extractStaticLyrics({ contents: { sectionListRenderer: { contents: [] } } }), null);
  assert.equal(extractStaticLyrics({}), null);
});

// NOTE: YT Music's authenticated timed-lyrics renderer shape is undocumented and this
// parser's exact JSON path is best-effort (mirrored from ytmusicapi-style reverse
// engineering) — it has not yet been validated against a real authenticated response,
// since that requires a logged-in Premium session. This test locks down the parser's
// own contract so future edits don't silently break it; if real responses turn out to
// use a different shape, update both `extractTimedLyrics` and this fixture together.
test('extractTimedLyrics converts cueRange timestamps into sorted timed lines', () => {
  const json = {
    contents: {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: {
                timedLyricsModel: {
                  lyricsData: {
                    timedLyricsData: [
                      { cueRange: { startTimeMilliseconds: '5000', endTimeMilliseconds: '8000' }, lyricLine: 'Second' },
                      { cueRange: { startTimeMilliseconds: '0', endTimeMilliseconds: '4000' }, lyricLine: 'First' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const timed = extractTimedLyrics(json);
  assert.deepEqual(timed.map((l) => l.text), ['First', 'Second']);
  assert.equal(timed[0].timeMs, 0);
  assert.equal(timed[1].timeMs, 5000);
});

test('extractTimedLyrics filters out lines with no text or an invalid timestamp', () => {
  const json = {
    contents: {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: {
                timedLyricsModel: {
                  lyricsData: {
                    timedLyricsData: [
                      { cueRange: { startTimeMilliseconds: '0' }, lyricLine: '' },
                      { cueRange: {}, lyricLine: 'No timestamp' },
                      { cueRange: { startTimeMilliseconds: '100' }, lyricLine: 'Valid' },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const timed = extractTimedLyrics(json);
  assert.equal(timed.length, 1);
  assert.equal(timed[0].text, 'Valid');
});

test('extractTimedLyrics returns null when the renderer is absent', () => {
  assert.equal(extractTimedLyrics({}), null);
  assert.equal(extractTimedLyrics(null), null);
});
