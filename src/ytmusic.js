'use strict';

// Minimal InnerTube (YouTube Music web client) client used only for:
//   1) searching a song by title/artist to resolve a videoId
//   2) fetching that video's lyrics (timed if YT Music has them, otherwise static)
//
// This talks to the same public endpoints music.youtube.com's web app itself calls
// (no OAuth / no official Data API key required), the same approach used by the
// well-known open-source ytmusicapi project.

const { pickBestMatch } = require('./textMatch');

const YTM_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const YTM_BASE = 'https://music.youtube.com/youtubei/v1';
const CLIENT_VERSION = '1.20240101.01.00';

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'X-Goog-Api-Format-Version': '1',
  'X-YouTube-Client-Name': '67',
  'X-YouTube-Client-Version': CLIENT_VERSION,
  Origin: 'https://music.youtube.com',
  Referer: 'https://music.youtube.com/',
};

function baseContext() {
  return {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: CLIENT_VERSION,
        hl: 'en',
        gl: 'US',
      },
      user: {},
    },
  };
}

async function ytFetch(endpoint, body, authHeaders) {
  const res = await fetch(`${YTM_BASE}/${endpoint}?key=${YTM_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: authHeaders ? { ...BASE_HEADERS, ...authHeaders } : BASE_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`YT Music ${endpoint} HTTP ${res.status}`);
  }
  return res.json();
}

// Walks a MusicResponsiveListItemRenderer search result into a flat candidate.
function extractSongCandidates(json) {
  const candidates = [];
  const contents =
    json?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.sectionListRenderer?.contents || [];

  for (const section of contents) {
    const items = section?.musicShelfRenderer?.contents;
    if (!items) continue;
    for (const item of items) {
      const r = item?.musicResponsiveListItemRenderer;
      if (!r) continue;
      const videoId =
        r.playlistItemData?.videoId ||
        r.overlay?.musicItemThumbnailOverlayRenderer?.content
          ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
      if (!videoId) continue;

      const flexColumns = r.flexColumns || [];
      const title =
        flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
          ?.map((x) => x.text)
          .join('') || '';
      const subtitleRuns =
        flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artist = subtitleRuns.map((x) => x.text).join('');

      candidates.push({ videoId, title, artist });
    }
  }
  return candidates;
}

async function searchSong(title, artist, authHeaders) {
  const query = artist ? `${title} ${artist}` : title;
  const body = { ...baseContext(), query, params: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D' }; // filter: Songs
  let candidates = [];
  try {
    const json = await ytFetch('search', body, authHeaders);
    candidates = extractSongCandidates(json);
  } catch {
    // Some accounts/sessions reject the "Songs" filter outright (HTTP 400)
    // instead of just returning an empty shelf — fall through to the
    // unfiltered retry below rather than failing the whole search over it.
  }

  if (candidates.length === 0) {
    // Retry without the "Songs" filter param in case YT Music returned a different shelf layout.
    const json2 = await ytFetch('search', { ...baseContext(), query }, authHeaders);
    candidates = extractSongCandidates(json2);
  }

  if (candidates.length === 0) return null;

  return pickBestMatch(candidates, title, artist, (c) => c.title, (c) => c.artist);
}

// Parses the (undocumented) timed-lyrics renderer YT Music uses in its own web client.
function extractTimedLyrics(browseJson) {
  const contents =
    browseJson?.contents?.elementRenderer?.newElement?.type?.componentType
      ?.model?.timedLyricsModel?.lyricsData?.timedLyricsData;
  if (!Array.isArray(contents) || contents.length === 0) return null;

  return contents
    .map((line) => ({
      timeMs: Number(line?.cueRange?.startTimeMilliseconds ?? NaN),
      endMs: Number(line?.cueRange?.endTimeMilliseconds ?? NaN),
      text: line?.lyricLine || '',
    }))
    .filter((l) => Number.isFinite(l.timeMs) && l.text.trim().length > 0)
    .sort((a, b) => a.timeMs - b.timeMs);
}

function extractStaticLyrics(browseJson) {
  const shelf = browseJson?.contents?.sectionListRenderer?.contents?.[0]
    ?.musicDescriptionShelfRenderer;
  const text = shelf?.description?.runs?.map((r) => r.text).join('');
  return text && text.trim().length > 0 ? text.trim() : null;
}

async function findLyricsBrowseId(videoId, authHeaders) {
  const body = { ...baseContext(), videoId, isAudioOnly: true };
  const json = await ytFetch('next', body, authHeaders);

  const tabs =
    json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs || [];

  for (const tab of tabs) {
    const renderer = tab?.tabRenderer;
    if (!renderer) continue;
    const title = (renderer.title || '').toLowerCase();
    const browseId = renderer.endpoint?.browseEndpoint?.browseId;
    if (title.includes('lyrics') && browseId) {
      return browseId;
    }
  }
  return null;
}

async function getLyrics(videoId, authHeaders) {
  const browseId = await findLyricsBrowseId(videoId, authHeaders);
  if (!browseId) return null;

  const browseJson = await ytFetch('browse', { ...baseContext(), browseId }, authHeaders);
  const timed = extractTimedLyrics(browseJson);
  if (timed && timed.length > 0) {
    return { videoId, timed, static: null, source: 'ytmusic-timed' };
  }
  const staticText = extractStaticLyrics(browseJson);
  if (staticText) {
    return { videoId, timed: null, static: staticText, source: 'ytmusic-static' };
  }
  return null;
}

async function fetchLyricsForTrack(title, artist, authHeaders) {
  const match = await searchSong(title, artist, authHeaders);
  if (!match) return null;
  const lyrics = await getLyrics(match.videoId, authHeaders);
  if (!lyrics) return { videoId: match.videoId, timed: null, static: null, source: 'none', matchedTitle: match.title, matchedArtist: match.artist };
  return { ...lyrics, matchedTitle: match.title, matchedArtist: match.artist };
}

module.exports = {
  searchSong,
  getLyrics,
  fetchLyricsForTrack,
  // exported for unit testing (pure JSON-shape parsers, no network calls)
  extractSongCandidates,
  extractStaticLyrics,
  extractTimedLyrics,
};
