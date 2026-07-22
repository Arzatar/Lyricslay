'use strict';

// Converts Japanese lyrics to romaji (Latin-script phonetic reading) via
// Gemini, once per song, so someone who can't read hiragana/katakana/kanji
// can still follow along and sing. AI rather than a local dictionary-based
// library (e.g. kuroshiro/kuromoji) on purpose: that combo ships a ~40MB
// morphological dictionary just for this one feature, and dictionary lookups
// routinely get kanji readings wrong for song lyrics specifically, where
// artists commonly use stylized/non-standard furigana for artistic effect —
// something a fixed dictionary can't know but a model with broad exposure to
// real lyrics has a much better shot at. Shares the same model-fallback list
// as geminiLyrics.js (see geminiClient.js) — this call is pure text, no
// video ingestion, so it's far cheaper against the same daily quota.

const { tryModels } = require('./geminiClient');

const LINES_PROMPT = `The following is a JSON array of song lyric lines, some
or all of which are in Japanese. Convert every line to its romaji
(Hepburn-style Latin-script phonetic reading) — leave any line that's
already non-Japanese (e.g. an English chorus) unchanged. Return ONLY a JSON
array of strings, the same length and order as the input, one romaji string
per input line, no markdown or commentary:

`;

const TEXT_PROMPT = `The following is a block of song lyrics, some or all of
which are in Japanese. Convert it to romaji (Hepburn-style Latin-script
phonetic reading), keeping the same line breaks and leaving any
non-Japanese lines (e.g. an English chorus) unchanged. Return ONLY the
converted text — no markdown, no commentary, no extra explanation:

`;

function parseLinesResponse(json, expectedLength) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedLength) return null;
  if (!parsed.every((l) => typeof l === 'string')) return null;
  return parsed;
}

function parseTextResponse(json) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}

// lines: string[] -> romaji string[], same length/order (so a timed-lyrics
// line's timeMs alignment survives untouched), or null if nothing usable.
async function fetchRomajiLines(lines, apiKey, onAttempt) {
  if (!apiKey || !Array.isArray(lines) || lines.length === 0) return null;

  const outcome = await tryModels(
    apiKey,
    () => ({
      contents: [{ parts: [{ text: LINES_PROMPT + JSON.stringify(lines) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    (json) => parseLinesResponse(json, lines.length),
    onAttempt
  );

  return outcome ? outcome.result : null;
}

// text: full static lyrics block -> romaji string, or null.
async function fetchRomajiText(text, apiKey, onAttempt) {
  if (!apiKey || typeof text !== 'string' || !text.trim()) return null;

  const outcome = await tryModels(
    apiKey,
    () => ({ contents: [{ parts: [{ text: TEXT_PROMPT + text }] }] }),
    (json) => parseTextResponse(json),
    onAttempt
  );

  return outcome ? outcome.result : null;
}

module.exports = { fetchRomajiLines, fetchRomajiText };
