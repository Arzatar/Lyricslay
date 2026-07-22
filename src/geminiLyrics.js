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

const PROMPT = `You are given a YouTube video of a song. Watch/listen to it and
transcribe its lyrics.

Return ONLY a JSON array (no markdown, no commentary) of objects, one per sung
line, in chronological order:
[{"timeMs": <integer ms from the start of the video where this line begins>, "text": "<the line, no annotations like [Chorus]>"}, ...]

If the track is instrumental or has no discernible vocals, return [].`;

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

// Returns { timed, model } from whichever model worked first, or null if the
// video has no usable lyrics. Throws only once every candidate model has failed.
async function fetchGeminiTimedLyrics(videoId, apiKey, onAttempt) {
  if (!apiKey || !videoId) return null;

  const outcome = await tryModels(
    apiKey,
    () => ({
      contents: [
        {
          parts: [
            { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    (json) => parseTimedLyrics(json),
    onAttempt
  );

  return outcome ? { timed: outcome.result, model: outcome.model } : null;
}

module.exports = { fetchGeminiTimedLyrics };
