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

// Formats a known duration as an explicit calibration anchor for the
// prompt. Confirmed directly on "Victim or Survivor" by Citizen Soldier: a
// grounded response placed known line 24 ("I got a story too") 50.8s after
// known line 23 ("Victim or survivor", the end of the first chorus) even
// though the two are sung back to back with almost no gap — audible,
// reported live. Nothing in the prompt previously told the model how long
// the song actually was, so it had no anchor at all for converting "how far
// into the video does this feel" into an absolute timestamp over a multi-
// minute span; it was just as free to guess 50s as 2s. Giving it the real,
// known duration up front (from SMTC, the same value used by
// correctSecondsMistakenForMs/dropLinesPastKnownDuration below) can't force
// correct pacing throughout, but at least gives every timestamp a fixed
// point to be measured against instead of an unconstrained guess.
function formatDurationHint(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
  const totalSec = Math.round(durationMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = String(totalSec % 60).padStart(2, '0');
  return `\n\nThe song's real, known duration is ${mm}:${ss} (${durationMs}ms total). Use this
as your reference for elapsed time — your timestamps should be spread
proportionally across the whole ${mm}:${ss}, and none should land at or after
${durationMs}ms.`;
}

function buildPrompt(title, artist, knownLines, durationMs) {
  const known = title
    ? `The song is "${title}"${artist ? ` by ${artist}` : ''} — use this to confirm you're
watching/hearing the right track.`
    : '';
  const durationHint = formatDurationHint(durationMs);

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

${known}${durationHint}

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

${known}${durationHint}

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

// Windowed grounded mode: instead of asking Gemini to output a millisecond
// figure directly (unreliable — see below), the video is split into fixed
// windows and, for each one, Gemini is only asked "which of the known lines
// occur in this specific clip, in order" — a classification question, not a
// time-estimation one. We then interpolate each window's lines evenly across
// its own known start/end.
//
// Confirmed directly, live, against the real API for "Victim or Survivor" by
// Citizen Soldier (a 175071ms track): asking for a timestamp (even a
// clip-relative one, with the video clipped via videoMetadata
// startOffset/endOffset) reproducibly placed known line 24 ("I got a story
// too") at an absolute ~102s — identical across full-video and "clipped"
// attempts alike, and identical whether the model was asked to add the clip
// offset itself or report clip-relative and let our code add it — even
// though line 23 ends at ~52s and the two are sung back to back. Whatever
// that number was, it wasn't coming from a real read of elapsed time in the
// clip: an out-of-bounds clip (1000s-1010s of a ~175s video) does 500 with an
// internal error, so the API is validating the offset against the real
// video, yet a well-formed in-bounds clip still didn't change the reported
// number at all — the model just isn't tracking absolute elapsed seconds
// reliably over a multi-minute span with no visual timing cues (this video,
// like most "Topic" channel uploads, is a static album-art image throughout).
//
// Simply asking it to transcribe (not timestamp) a bounded clip, however,
// was accurate and stable: a 40-50s clip came back with exactly the expected
// chorus lines, a 90-100s clip came back with the *next* chorus repeat
// (proving verse 2 actually falls well before 90s, nowhere near the ~102s
// the timestamp-asking approach kept insisting on). Reframing the ask from
// "when does this happen" (numeric estimation, unreliable) to "which of
// these known lines is in this clip" (classification, verified 4/4
// identical across repeated live calls at 55-80s) turns the model's
// demonstrated strength (accurate transcription within a bounded window)
// into the thing it's actually being asked to do.
const WINDOW_MS = 25000;
// Guards against a pathological/incorrect durationMs (e.g. a bad SMTC
// report) turning one lyrics fetch into dozens of Gemini calls.
const MAX_WINDOWS = 20;

function buildWindowPrompt(title, artist, knownLines, startSec, endSec) {
  const known = title
    ? `The song is "${title}"${artist ? ` by ${artist}` : ''}.`
    : '';
  const numbered = knownLines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `${known}

Here is the full, already-verified numbered lyrics list for this song:
${numbered}

You are given only a short clip of the song — from ${startSec}s to ${endSec}s
of the original video, not the whole song. Listen to this clip and identify
which of the numbered lines above are actually sung within it, in the order
they occur. Do not guess based on typical song structure or lyrics you
already know from training — only report lines you actually hear sung in
THIS specific clip. If none of the lines occur in this clip, return [].

Return ONLY a JSON array of the 1-based indices, in chronological order
(e.g. [16,17,18]). No markdown, no commentary, no timestamps.`;
}

// A window response is legitimately an empty array (that window has no
// sung line worth reporting, e.g. a instrumental break) — that's not the
// same as a parse failure, so callers must be able to tell the two apart
// (see fetchWindowedGroundedTimedLyrics's onResponse wrapper below).
function parseWindowIndices(json, knownLines) {
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  return parsed
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= knownLines.length);
}

// Spreads a window's identified lines evenly across its own [start, end)
// span, each centered in its equal-sized slot. Deliberately simple — pacing
// within a ~25s window won't be perfectly uniform, but this stays close
// (bounded error of at most one window's width) instead of the tens of
// seconds of drift the direct-timestamp approach produced.
function interpolateWindowTimestamps(indices, knownLines, windowStartMs, windowEndMs) {
  const count = indices.length;
  if (count === 0) return [];
  const span = windowEndMs - windowStartMs;
  return indices.map((index, pos) => ({
    timeMs: Math.round(windowStartMs + ((pos + 0.5) / count) * span),
    text: knownLines[index - 1],
  }));
}

// Windows are cut at fixed times, not at phrase boundaries, so a phrase
// straddling a cut is sometimes independently picked up by both the window
// ending just before it and the window starting just after — confirmed
// directly: a real run had the whole 4-line verse-2 opening
// ([24,25,26,27]) reported as the tail of one window's list AND again as
// the head of the very next window's list, so it displayed twice in a row.
// If the current window's list starts with the same run of indices the
// previous window's list ended with, that's almost certainly the same
// bled-through occurrence rather than a genuine back-to-back repeat (a real
// repeat — e.g. the four-times "I'm not.../I'm the survivor" refrain — gets
// reported within a *single* window's own list, not split as one window's
// tail plus the next window's head), so the duplicated prefix is dropped.
function trimBoundaryOverlap(prevIndices, currIndices) {
  const maxOverlap = Math.min(prevIndices.length, currIndices.length);
  for (let k = maxOverlap; k > 0; k--) {
    const prevTail = prevIndices.slice(prevIndices.length - k);
    const currHead = currIndices.slice(0, k);
    if (prevTail.every((v, i) => v === currHead[i])) {
      return currIndices.slice(k);
    }
  }
  return currIndices;
}

async function fetchWindowedGroundedTimedLyrics(videoId, apiKey, onAttempt, durationMs, title, artist, knownLines) {
  const windowCount = Math.min(MAX_WINDOWS, Math.ceil(durationMs / WINDOW_MS));
  const windowSize = durationMs / windowCount;
  const timed = [];
  const modelsUsed = new Set();
  let prevIndices = [];

  for (let i = 0; i < windowCount; i++) {
    const start = Math.round(i * windowSize);
    const end = Math.round(Math.min((i + 1) * windowSize, durationMs));
    const startSec = Math.floor(start / 1000);
    const endSec = Math.ceil(end / 1000);

    const outcome = await tryModels(
      apiKey,
      () => ({
        contents: [
          {
            parts: [
              {
                fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` },
                videoMetadata: { startOffset: `${startSec}s`, endOffset: `${endSec}s` },
              },
              { text: buildWindowPrompt(title, artist, knownLines, startSec, endSec) },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      (json) => {
        const indices = parseWindowIndices(json, knownLines);
        // Wrap so a legitimate empty window ([]) is still a truthy "hit" to
        // tryModels, distinct from a parse failure (null) that should retry
        // the next model.
        return indices ? { indices } : null;
      },
      (model, outcome) => onAttempt?.(model, `window ${startSec}-${endSec}s: ${outcome}`)
    );

    if (outcome) {
      modelsUsed.add(outcome.model);
      const trimmedIndices = trimBoundaryOverlap(prevIndices, outcome.result.indices);
      timed.push(...interpolateWindowTimestamps(trimmedIndices, knownLines, start, end));
      prevIndices = outcome.result.indices;
    }
  }

  return timed.length > 0 ? { timed, models: modelsUsed } : null;
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
// when present, and a known durationMs is available to tile the video into
// windows, Gemini is only asked which known lines occur in each window (see
// fetchWindowedGroundedTimedLyrics above) instead of transcribing the song
// blind or self-reporting an elapsed-time estimate — both proved unreliable
// live against the real API for a repetitive rock chorus. Without a known
// durationMs, grounded mode falls back to the older single-call approach
// (windowing needs a total length to tile against).
async function fetchGeminiTimedLyrics(videoId, apiKey, onAttempt, durationMs, title, artist, knownLyrics) {
  if (!apiKey || !videoId) return null;

  if (!(await isVideoAvailable(videoId))) {
    onAttempt?.('preflight', 'video unavailable, skipping');
    return null;
  }

  const knownLines = splitKnownLyricsLines(knownLyrics);
  const grounded = knownLines.length > 0;

  if (grounded && Number.isFinite(durationMs) && durationMs > 0) {
    const windowed = await fetchWindowedGroundedTimedLyrics(videoId, apiKey, onAttempt, durationMs, title, artist, knownLines);
    if (!windowed) return null;
    const trimmed = dropLinesPastKnownDuration(windowed.timed, durationMs);
    if (trimmed.length === 0) return null;
    return {
      timed: trimmed,
      model: [...windowed.models].join('+') || 'unknown',
      correctedUnits: false,
      droppedPastDuration: trimmed.length !== windowed.timed.length,
      grounded: true,
      windowed: true,
    };
  }

  const outcome = await tryModels(
    apiKey,
    () => ({
      contents: [
        {
          parts: [
            { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
            { text: buildPrompt(title, artist, knownLines, durationMs) },
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
  interpolateWindowTimestamps,
  trimBoundaryOverlap,
  parseTimedLyrics,
  parseGroundedTimedLyrics,
  parseWindowIndices,
  splitKnownLyricsLines,
  isVideoAvailable,
};
