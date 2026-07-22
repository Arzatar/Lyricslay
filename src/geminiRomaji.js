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

// Lines are sent tagged with their own index (rather than a bare array of
// strings) and asked to come back the same way, one output object per
// input index — not because the model reliably honors that (see below), but
// so a partial/imperfect response is still usable: parseLinesResponse keeps
// whatever indices it got a valid answer for, and fetchRomajiLines falls
// back to each missing line's original (Japanese) text rather than throwing
// the whole conversion away over a handful of dropped lines.
const LINES_PROMPT = `The following is a JSON array of objects, each with an
index "i" and a song lyric line "t", some or all of which are in Japanese.
Convert every line's "t" to its romaji (Hepburn-style Latin-script phonetic
reading) — leave any line that's already non-Japanese (e.g. an English
chorus) unchanged. Return ONLY a JSON array of objects, one per input
object, in the same shape but with "t" replaced by "r" holding the romaji:
[{"i": <the same index>, "r": "<romaji>"}, ...]. Every index in the input
must appear exactly once in the output, even when two lines have identical
or very similar text — do not merge, skip, or deduplicate by index:

`;

const TEXT_PROMPT = `The following is a block of song lyrics, some or all of
which are in Japanese. Convert it to romaji (Hepburn-style Latin-script
phonetic reading), keeping the same line breaks and leaving any
non-Japanese lines (e.g. an English chorus) unchanged. Return ONLY the
converted text — no markdown, no commentary, no extra explanation:

`;

// Returns a Map<index, romajiText> of whatever indices the model actually
// returned a valid answer for — deliberately not all-or-nothing on length,
// since verified directly that models don't reliably preserve every index
// for long/repetitive line lists (a 151-line song came back short even when
// explicitly told not to merge anything). null only if literally nothing
// usable came back at all.
function parseLinesResponse(json) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const byIndex = new Map();
  for (const item of parsed) {
    if (item && Number.isInteger(item.i) && typeof item.r === 'string' && item.r.length > 0) {
      byIndex.set(item.i, item.r);
    }
  }
  return byIndex.size > 0 ? byIndex : null;
}

function parseTextResponse(json) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}

// lines: string[] -> romaji string[], same length/order (so a timed-lyrics
// line's timeMs alignment survives untouched). Never fully null just because
// a few lines didn't come back — any line the model didn't return a valid
// answer for keeps its original (Japanese) text instead, so one dropped
// line doesn't cost the whole song's conversion. Only actually null if the
// model returned nothing usable at all.
async function fetchRomajiLines(lines, apiKey, onAttempt) {
  if (!apiKey || !Array.isArray(lines) || lines.length === 0) return null;

  // Dedupe before sending: repeated lines (choruses) are extremely common in
  // song lyrics, and sending only unique ones is both cheaper and reduces
  // (without fully eliminating — see parseLinesResponse) the model's own
  // tendency to collapse near-identical lines despite being told not to.
  const uniqueLines = [...new Set(lines)];
  const indexed = uniqueLines.map((t, i) => ({ i, t }));

  const outcome = await tryModels(
    apiKey,
    () => ({
      contents: [{ parts: [{ text: LINES_PROMPT + JSON.stringify(indexed) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    (json) => parseLinesResponse(json),
    onAttempt
  );
  if (!outcome) return null;

  const byIndex = outcome.result;
  const romajiByLine = new Map(uniqueLines.map((line, i) => [line, byIndex.get(i) ?? line]));
  return lines.map((line) => romajiByLine.get(line));
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
