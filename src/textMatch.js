'use strict';

// Shared fuzzy title/artist matching used to pick the best search result out of a
// list of candidates (both ytmusic.js and lrclib.js need this, since neither the
// InnerTube search nor the LRCLIB search API guarantee the first hit is correct).

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics after NFKD split
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Higher score = better match. Exact title match outweighs a fuzzy artist match,
// which outweighs a fuzzy title match, so a wrong-artist exact-title hit doesn't
// beat a right-artist partial-title hit by accident.
function scoreCandidate(candidateTitle, candidateArtist, queryTitle, queryArtist) {
  const cTitle = normalizeText(candidateTitle);
  const cArtist = normalizeText(candidateArtist);
  const qTitle = normalizeText(queryTitle);
  const qArtist = normalizeText(queryArtist);

  let score = 0;
  if (cTitle === qTitle) score += 3;
  else if (cTitle.includes(qTitle) || qTitle.includes(cTitle)) score += 1;

  if (qArtist && (cArtist.includes(qArtist) || qArtist.includes(cArtist))) score += 2;

  return score;
}

// Picks the highest-scoring candidate for (queryTitle, queryArtist). `getTitle`/
// `getArtist` extract the comparable strings from each candidate shape, and
// `extraScore` (optional) lets callers break ties on criteria unrelated to text
// similarity (e.g. lrclib.js preferring candidates that actually have synced lyrics).
function pickBestMatch(candidates, queryTitle, queryArtist, getTitle, getArtist, extraScore) {
  if (!candidates || candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    let score = scoreCandidate(getTitle(candidate), getArtist(candidate), queryTitle, queryArtist);
    if (extraScore) score += extraScore(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

module.exports = { normalizeText, scoreCandidate, pickBestMatch };
