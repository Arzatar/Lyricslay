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

function buildPrompt(title, artist) {
  const known = title
    ? `The song is "${title}"${artist ? ` by ${artist}` : ''} — use this to confirm you're
watching/hearing the right track.`
    : '';

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

// Returns { timed, model, correctedUnits } from whichever model worked
// first, or null if the video has no usable lyrics (including: the video
// itself is gone — checked up front, before spending a model call on it).
// `durationMs` (the song's real, known duration) is optional but strongly
// recommended — it's what makes the seconds-vs-milliseconds correction above
// possible; without it, a mis-unit response is returned as-is. `title`/
// `artist` are optional but strongly recommended too — passed into the
// prompt so the model has something to confirm the video against instead of
// transcribing blind. Throws only once every candidate model has failed.
async function fetchGeminiTimedLyrics(videoId, apiKey, onAttempt, durationMs, title, artist) {
  if (!apiKey || !videoId) return null;

  if (!(await isVideoAvailable(videoId))) {
    onAttempt?.('preflight', 'video unavailable, skipping');
    return null;
  }

  const outcome = await tryModels(
    apiKey,
    () => ({
      contents: [
        {
          parts: [
            { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
            { text: buildPrompt(title, artist) },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    (json) => parseTimedLyrics(json),
    onAttempt
  );
  if (!outcome) return null;

  const corrected = correctSecondsMistakenForMs(outcome.result, durationMs);
  return { timed: corrected, model: outcome.model, correctedUnits: corrected !== outcome.result };
}

module.exports = { fetchGeminiTimedLyrics, correctSecondsMistakenForMs, parseTimedLyrics, isVideoAvailable };
