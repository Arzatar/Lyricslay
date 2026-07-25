'use strict';

// Last-resort lyrics source: hands Gemini a YouTube URL directly (its API can
// ingest a YouTube link as video/audio input, no download/audio-capture on
// our end) and asks it to transcribe the song with per-line timestamps in
// our own {timeMs, text} shape, when nothing else in the chain found
// anything synced. Requires the user's own API key — see geminiKeyStore.js
// and the "AI lyrics fallback" section of ARCHITECTURE.md for why this can't
// ship with a key embedded/shared across installs. Model selection/fallback
// is shared with geminiRomaji.js — see geminiClient.js.

const { tryModels } = require('./geminiClient');

// Confirms the video is actually still up before ever handing its URL to
// Gemini. Caught a real failure mode directly: a removed/private video
// ("This video isn't available anymore") was still passed to Gemini as a
// fileData.fileUri, and rather than surfacing an error, the model complied
// with the forced JSON response shape anyway and fabricated a plausible-
// looking but entirely made-up transcription — nothing in tryModels' HTTP-
// status/parse checks catches that, since the API call itself succeeds and
// returns well-formed JSON. YouTube's oEmbed endpoint is a free, keyless,
// single GET that 404s for anything removed/private/region-blocked, so it's
// used as a cheap pre-flight check rather than trusting Gemini to notice.
async function isVideoAvailable(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    );
    return res.ok;
  } catch {
    // A network hiccup here shouldn't be the reason the AI fallback never
    // runs — if oEmbed itself is unreachable, let the actual Gemini call be
    // the thing that fails (or not).
    return true;
  }
}

// Bracket-free section labels: confirmed directly against LRCLIB's
// plainLyrics for "Victim or Survivor" by Citizen Soldier, which spells out
// "VERSE 1", "PRE-CHORUS 1", "CHORUS", "CHORUS 2", "BRIDGE", "CHORUS 3" as
// bare all-caps lines with no brackets/parens at all — the bracket-only
// filter below let all of those through as if they were real sung lines.
// With them left in, Gemini was asked to find a timestamp for a label like
// "CHORUS 3" that has no distinct sung text of its own (the actual words
// only appear once, under the first "CHORUS"), which produced a bogus/
// duplicated final timestamp block running to ~250s on a song that
// LRCLIB (and SMTC) both agree is 175s long. Matched by keyword so this
// only strips known section-label vocabulary, not any real lyric line that
// happens to be short.
const SECTION_LABEL_RE =
  /^(?:intro|outro|verse|chorus|pre-chorus|post-chorus|bridge|hook|refrain|interlude|breakdown|instrumental)\s*\d*\.?:?$/i;

// Strips section headers ("[Chorus]", "(Verse 2)", or bare "CHORUS 2") and
// blank lines out of a plain-text lyrics blob — those aren't actually sung,
// so asking Gemini to time them as if they were a line would either produce
// a bogus timestamp or tempt it to skip/renumber entries, throwing off the
// index-based mapping splitKnownLyricsLines is used for in
// buildPrompt/parseGroundedTimedLyrics.
function splitKnownLyricsLines(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[[(].*[)\]]$/.test(l) && !SECTION_LABEL_RE.test(l));
}

function buildPrompt(title, artist, knownLines) {
  const known = title
    ? `The song is "${title}"${artist ? ` by ${artist}` : ''} — use this to confirm you're
watching/hearing the right track.`
    : '';

  // Grounded mode: we already have verified-correct lyrics text (from a
  // lyrics database) but no timing for it. Rather than have Gemini
  // transcribe the song blind — which risks mishearing lines the database
  // already got right — hand it the known lines and ask only for *when*
  // each is sung, referenced by index so the exact wording it returns is
  // never in question (we substitute the original text back in ourselves;
  // see parseGroundedTimedLyrics).
  if (knownLines && knownLines.length > 0) {
    const numbered = knownLines.map((l, i) => `${i + 1}. ${l}`).join('\n');
    return `You are given a YouTube video of a song, and that song's already-verified
lyrics below as a numbered list of lines (no timestamps yet).

${known}

Known lyrics:
${numbered}

Watch/listen to the video and, for each line above that is actually sung,
report the timestamp (in milliseconds from the start of the video) at which
it begins. If a line repeats later in the song (e.g. a chorus), report every
occurrence. Do not invent lines that aren't in the numbered list above, and
do not renumber or reorder the list.

If you cannot actually access/watch the video, or what you can access clearly
isn't this song (wrong track, removed/unavailable video, silent/blank video,
etc.), return [] instead of guessing.

Return ONLY a JSON array (no markdown, no commentary), in chronological order:
[{"timeMs": <integer MILLISECONDS from the start of the video — NOT seconds, e.g. a line starting at 1 minute 5 seconds in is timeMs: 65000, not 65>, "index": <the line's 1-based number from the list above>}, ...]`;
  }

  return `You are given a YouTube video of a song. Watch/listen to it and
transcribe its lyrics.

${known}

If you cannot actually access/watch the video, or what you can access clearly
isn't this song (wrong track, removed/unavailable video, silent/blank video,
etc.), do NOT guess or invent lyrics from general knowledge of the song —
return [] instead.

Return ONLY a JSON array (no markdown, no commentary) of objects, one per sung
line, in chronological order:
[{"timeMs": <integer MILLISECONDS from the start of the video where this line begins — NOT seconds, e.g. a line starting at 1 minute 5 seconds into the song is timeMs: 65000, not 65>, "text": "<the line, no annotations like [Chorus]>"}, ...]

If the track is instrumental or has no discernible vocals, return [].`;
}

function parseTimedLyrics(json) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const timed = parsed
    .map((line) => ({
      timeMs: Number(line?.timeMs),
      text: typeof line?.text === 'string' ? line.text.trim() : '',
    }))
    .filter((l) => Number.isFinite(l.timeMs) && l.timeMs >= 0 && l.text.length > 0)
    .sort((a, b) => a.timeMs - b.timeMs);

  return timed.length > 0 ? timed : null;
}

// Grounded counterpart to parseTimedLyrics: the response references known
// lines by 1-based index (see buildPrompt's grounded branch) instead of
// repeating text, so the "text" in the result is always the original
// database line verbatim — Gemini only ever supplies the timing.
function parseGroundedTimedLyrics(json, knownLines) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const timed = parsed
    .map((line) => {
      const index = Number(line?.index);
      const timeMs = Number(line?.timeMs);
      if (!Number.isInteger(index) || index < 1 || index > knownLines.length) return null;
      if (!Number.isFinite(timeMs) || timeMs < 0) return null;
      return { timeMs, text: knownLines[index - 1] };
    })
    .filter(Boolean)
    .sort((a, b) => a.timeMs - b.timeMs);

  return timed.length > 0 ? timed : null;
}

// The prompt asks for milliseconds explicitly (with an example), but
// verified directly that a model can still answer in seconds anyway — a
// real 238-second song came back with every line under 220 "ms", i.e. the
// whole transcription compressed into under a quarter-second of actual
// playback. Rather than trust the model to get the unit right, sanity-check
// it against the song's *known* duration (already available from SMTC) and
// correct it deterministically: if the last line's timestamp is way too
// small to be milliseconds but lands close to right as *seconds* (the
// durationMs/maxTimeMs ratio comes out close to 1000), multiply everything
// by 1000. A well-formed ms-based track's last line should already land
// somewhere near the real duration, so that ratio is normally close to 1.
function correctSecondsMistakenForMs(timed, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || timed.length === 0) return timed;
  const maxTimeMs = timed[timed.length - 1].timeMs;
  if (maxTimeMs <= 0) return timed;
  const ratio = durationMs / maxTimeMs;
  if (ratio < 500 || ratio > 2000) return timed;
  return timed.map((l) => ({ ...l, timeMs: l.timeMs * 1000 }));
}

// Confirmed directly on a real (grounded) response for "Victim or Survivor"
// by Citizen Soldier: LRCLIB and the track's own SMTC-reported duration both
// agree the song is ~175s long, but the model repeated an entire bridge +
// chorus block a second time near the end with timestamps stretching to
// ~250s — 75s past the real ending. Grounding fixes *wording* (see
// buildPrompt's grounded branch) but does nothing to stop the model from
// still mistiming or duplicating a section against the video it's watching,
// so anything landing well past the song's actual known length is dropped
// outright rather than displayed — it's someone else's guess at "where would
// this repeat happen" and cannot be correct if the real song has already
// ended by then. A few seconds of slack covers a natural fade-out tail.
function dropLinesPastKnownDuration(timed, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return timed;
  const limit = durationMs + 5000;
  return timed.filter((l) => l.timeMs <= limit);
}

// Returns { timed, model, correctedUnits } from whichever model worked
// first, or null if the video has no usable lyrics (including: the video
// itself is gone — checked up front, before spending a model call on it).
// `durationMs` (the song's real, known duration) is optional but strongly
// recommended — it's what makes the seconds-vs-milliseconds correction above
// possible; without it, a mis-unit response is returned as-is. `title`/
// `artist` are optional but strongly recommended too — passed into the
// prompt so the model has something to confirm the video against instead of
// transcribing blind. Throws only once every candidate model has failed.
// `knownLyrics` (optional) is a plain-text lyrics blob already found from a
// database source (LRCLIB/YT Music/Genius/lyrics.ovh) but with no timing —
// when present, Gemini is only asked to time those exact lines (see
// buildPrompt's grounded branch) instead of transcribing the song blind,
// so a source that already got the wording right can't be second-guessed
// by mishearing.
async function fetchGeminiTimedLyrics(videoId, apiKey, onAttempt, durationMs, title, artist, knownLyrics) {
  if (!apiKey || !videoId) return null;

  if (!(await isVideoAvailable(videoId))) {
    onAttempt?.('preflight', 'video unavailable, skipping');
    return null;
  }

  const knownLines = splitKnownLyricsLines(knownLyrics);
  const grounded = knownLines.length > 0;

  const outcome = await tryModels(
    apiKey,
    () => ({
      contents: [
        {
          parts: [
            { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
            { text: buildPrompt(title, artist, knownLines) },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    (json) => (grounded ? parseGroundedTimedLyrics(json, knownLines) : parseTimedLyrics(json)),
    onAttempt
  );
  if (!outcome) return null;

  const corrected = correctSecondsMistakenForMs(outcome.result, durationMs);
  const trimmed = dropLinesPastKnownDuration(corrected, durationMs);
  if (trimmed.length === 0) return null;
  return {
    timed: trimmed,
    model: outcome.model,
    correctedUnits: corrected !== outcome.result,
    droppedPastDuration: trimmed.length !== corrected.length,
    grounded,
  };
}

module.exports = {
  fetchGeminiTimedLyrics,
  correctSecondsMistakenForMs,
  dropLinesPastKnownDuration,
  parseTimedLyrics,
  parseGroundedTimedLyrics,
  splitKnownLyricsLines,
  isVideoAvailable,
};
