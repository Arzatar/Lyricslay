'use strict';

// lyrics.ovh — a free, keyless, plain-text-only lyrics API. No sync, but decent
// (community-sourced) coverage and zero setup; tried after YT Music's own plain
// text, before resorting to scraping Genius.

const BASE = 'https://api.lyrics.ovh/v1';

// Pure — exported for unit testing without a network call.
function parseLyricsOvhResponse(json) {
  const text = (json?.lyrics || '').trim();
  return text.length > 0 ? text : null;
}

async function fetchLyrics(title, artist) {
  if (!title || !artist) return null;

  const url = `${BASE}/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lyrics.ovh HTTP ${res.status}`);

  const json = await res.json();
  const plain = parseLyricsOvhResponse(json);
  return plain ? { plain } : null;
}

module.exports = { fetchLyrics, parseLyricsOvhResponse };
