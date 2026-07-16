'use strict';

// Third-party YouTube re-uploads (common for less-mainstream/niche artists whose
// original uploads get taken down repeatedly — the exact reason this exists) often
// have title/artist metadata that's close to useless for a lyrics search: the
// media session's *artist* field is frequently just the uploader's channel name,
// while the *title* repeats the real artist name followed by junk annotations
// ("(letra)", "(official video)", ...) instead of being just the song name. This
// cleans both up before they're used as a search query or cache key.
//
// Real example that motivated this: SMTC reported title
// "Los Mox: Curao manejo mejor! (letra)" / artist "neohex" (the uploader's channel)
// for a Chilean band's song — every lyrics source failed on that pair verbatim.
// Cleaned, it becomes title "Curao manejo mejor!" / artist "Los Mox".

// Trailing "(...)"/"[...]" groups are stripped only when their *entire* inner text
// matches one of these — not a substring match — so a song legitimately titled
// with a parenthetical like "(Live Aid)" or "(System of a Down song)" is untouched.
const JUNK_ANNOTATION =
  /^(letra|lyrics?|con\s*letra|official\s*(video|audio|music\s*video)?|video\s*oficial|audio\s*oficial|en\s*vivo|live|hd|4k|remaster(ed)?|visualizer|full\s*song|video|audio)$/i;

function stripJunkAnnotations(title) {
  let cleaned = (title || '').trim();
  let prev;
  do {
    prev = cleaned;
    cleaned = cleaned
      .replace(/[([]([^()[\]]*)[)\]]\s*$/, (whole, inner) => (JUNK_ANNOTATION.test(inner.trim()) ? '' : whole))
      .trim();
  } while (cleaned !== prev);
  return cleaned;
}

// Common YouTube upload convention: "Artist: Song" or "Artist - Song". Worth
// pulling back out because the *artist* field is frequently just the uploader's
// channel name for these re-uploads, not the actual artist — while the title
// reliably repeats the real one.
function extractArtistFromTitle(title) {
  const match = (title || '').match(/^(.{1,40}?)\s*[:\-–—]\s*(.+)$/);
  if (!match) return null;
  const artist = match[1].trim();
  const songTitle = match[2].trim();
  if (!artist || !songTitle) return null;
  return { artist, title: songTitle };
}

// Combines both: strip junk suffixes first, then check whether what's left starts
// with an "Artist: Song" pattern. For a normal, already-clean title/artist pair
// (the common case), this is a no-op — the regexes simply don't match anything.
function cleanTrackMetadata(rawTitle, rawArtist) {
  const strippedTitle = stripJunkAnnotations(rawTitle);
  const extracted = extractArtistFromTitle(strippedTitle);
  if (extracted) {
    return { title: stripJunkAnnotations(extracted.title), artist: extracted.artist };
  }
  return { title: strippedTitle, artist: (rawArtist || '').trim() };
}

module.exports = { stripJunkAnnotations, extractArtistFromTitle, cleanTrackMetadata };
