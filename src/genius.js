'use strict';

// Last-resort lyrics fallback: searches Genius's public, keyless search endpoint —
// the same one that backs the search box on genius.com, used without a token by
// several well-known open-source lyrics tools (e.g. the `genius-lyrics` npm
// package) — then scrapes the lyrics text out of the matched song page's HTML.
//
// This is intentionally last in the fallback chain: unlike the API-based sources,
// scraping a page's markup has no versioning guarantee and breaks the moment
// Genius changes their HTML. Fine for personal, occasional, last-resort use like
// this; not something to hammer at high volume.

const { pickBestMatch } = require('./textMatch');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// Pure — exported for unit testing against hand-built fixtures.
function extractSongCandidates(json) {
  const sections = json?.response?.sections || [];
  const songSection = sections.find((s) => s.type === 'song');
  const hits = songSection?.hits || [];
  return hits
    .map((h) => h.result)
    .filter((r) => r && r.url)
    .map((r) => ({
      url: r.url,
      title: r.title || '',
      artist: r.primary_artist?.name || '',
    }));
}

// Given the index right after some div's opening `<div ...>` tag (i.e. depth is
// already 1 for that div), walks forward counting nested <div>/</div> tags until
// depth returns to 0 — correct regardless of what's nested inside, without pulling
// in a full HTML parser for this one page shape. Returns the index of that div's
// content end (right before its own closing tag) and the index right after that
// closing tag (where scanning for the *next*, sibling thing should resume).
function findMatchingDivClose(html, contentStart) {
  const innerTag = /<div\b[^>]*>|<\/div>/g;
  innerTag.lastIndex = contentStart;
  let depth = 1;
  let match;
  let lastScanned = contentStart;
  while (depth > 0 && (match = innerTag.exec(html)) !== null) {
    if (match[0] === '</div>') {
      depth--;
      if (depth === 0) return { contentEnd: match.index, afterClose: innerTag.lastIndex };
    } else {
      depth++;
    }
    lastScanned = innerTag.lastIndex;
  }
  // Unbalanced/malformed HTML — fall back to wherever the scan got to rather than
  // throwing, since a scrape failing gracefully just means "try the next source."
  return { contentEnd: lastScanned, afterClose: lastScanned };
}

// Genius marks page chrome that isn't actual lyrics — the contributor count and
// song title repeated above the lyrics, in particular — with
// `data-exclude-from-selection="true"` on its own wrapping div (the same attribute
// Genius's own frontend uses to keep that chrome out of a real "select all" on the
// page). Cutting those blocks removes it the same way, wherever they appear and
// however deeply nested, rather than special-casing the specific header we've seen.
function removeExcludedSections(html) {
  const excludeStart = /<div[^>]*data-exclude-from-selection="true"[^>]*>/g;
  let result = '';
  let lastIndex = 0;
  let match;
  while ((match = excludeStart.exec(html)) !== null) {
    result += html.slice(lastIndex, match.index);
    const { afterClose } = findMatchingDivClose(html, match.index + match[0].length);
    lastIndex = afterClose;
    excludeStart.lastIndex = afterClose;
  }
  return result + html.slice(lastIndex);
}

// Genius renders lyrics inside one or more `data-lyrics-container="true"` divs,
// which can have arbitrary nested <div>s inside them (line/annotation wrappers,
// and the excluded header above) — a non-greedy regex can't safely find the
// matching close tag for those, hence the depth-counting scan above.
function extractLyricsFromHtml(html) {
  const blocks = [];
  const startTag = /<div[^>]*data-lyrics-container="true"[^>]*>/g;
  let startMatch;
  while ((startMatch = startTag.exec(html)) !== null) {
    const contentStart = startMatch.index + startMatch[0].length;
    const { contentEnd, afterClose } = findMatchingDivClose(html, contentStart);
    blocks.push(removeExcludedSections(html.slice(contentStart, contentEnd)));
    startTag.lastIndex = afterClose;
  }

  if (blocks.length === 0) return null;

  const text = blocks
    .join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text.length > 0 ? text : null;
}

async function searchSong(title, artist) {
  const query = artist ? `${title} ${artist}` : title;
  const res = await fetch(`https://genius.com/api/search/multi?q=${encodeURIComponent(query)}`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`Genius search HTTP ${res.status}`);
  const json = await res.json();

  const candidates = extractSongCandidates(json);
  if (candidates.length === 0) return null;
  return pickBestMatch(candidates, title, artist, (c) => c.title, (c) => c.artist);
}

async function fetchLyrics(title, artist) {
  const match = await searchSong(title, artist);
  if (!match) return null;

  const res = await fetch(match.url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Genius page HTTP ${res.status}`);
  const html = await res.text();

  const plain = extractLyricsFromHtml(html);
  return plain ? { plain, matchedTitle: match.title, matchedArtist: match.artist } : null;
}

module.exports = {
  fetchLyrics,
  searchSong,
  extractSongCandidates,
  extractLyricsFromHtml,
  removeExcludedSections,
};
