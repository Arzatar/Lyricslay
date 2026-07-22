'use strict';

// Last-resort lyrics source: hands Gemini a YouTube URL directly (its API can
// ingest a YouTube link as video/audio input, no download/audio-capture on
// our end) and asks it to transcribe the song with per-line timestamps in
// our own {timeMs, text} shape, when nothing else in the chain found
// anything synced. Requires the user's own API key — see geminiKeyStore.js
// and the "AI lyrics fallback" section of ARCHITECTURE.md for why this can't
// ship with a key embedded/shared across installs.

// Tried in order, falling through to the next on a 429 (quota exceeded) or
// 404 (model not available to this project) rather than pinning to one
// model — Google's free tier hands out wildly different daily quotas per
// model on the *same* account, verified directly against a real project's
// AI Studio rate-limit dashboard: the plain Flash releases (2.5/3.5/3.6,
// including whatever "-latest" happens to alias to that day) were capped at
// a mere 20 requests/day, while the newer "Lite" releases (3.1, 3.5)
// were given 500/day on that same key — 25x more — for what turned out to
// be the same transcription quality on this task (confirmed directly: both
// correctly transcribed a real song's lyrics with per-line timestamps from
// its YouTube video). There's no API to ask Google "how much quota do I
// have left" up front — a live 429/404 during an actual call is the only
// signal — so this list is a curated, hand-ordered guess at what's likely
// to work for a typical free-tier account, not something recomputed at
// runtime; it's expected to need occasional retuning as Google reshuffles
// quotas (exactly what happened here) or ships newer model names. The
// "-latest" alias stays last purely as a catch-all for brand-new projects
// that don't yet have access to any of the named models above it.
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'];

const PROMPT = `You are given a YouTube video of a song. Watch/listen to it and
transcribe its lyrics.

Return ONLY a JSON array (no markdown, no commentary) of objects, one per sung
line, in chronological order:
[{"timeMs": <integer ms from the start of the video where this line begins>, "text": "<the line, no annotations like [Chorus]>"}, ...]

If the track is instrumental or has no discernible vocals, return [].`;

function buildRequest(model, videoId, apiKey) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
  });
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

// Returns { timed, model } from whichever model in MODELS worked first, or
// null if the video has no usable lyrics. Throws only once every model in
// the list has failed, so the caller can log/handle one real error instead
// of one per candidate.
async function fetchGeminiTimedLyrics(videoId, apiKey, onAttempt) {
  if (!apiKey || !videoId) return null;

  let lastError = null;
  for (const model of MODELS) {
    let res;
    try {
      res = await buildRequest(model, videoId, apiKey);
    } catch (err) {
      lastError = err;
      onAttempt?.(model, `network error: ${err?.message || err}`);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
      onAttempt?.(model, `HTTP ${res.status}`);
      continue; // quota exceeded (429), not available to this project (404), etc. — try the next model
    }

    const json = await res.json();
    const timed = parseTimedLyrics(json);
    onAttempt?.(model, timed ? `hit (${timed.length} lines)` : 'no usable transcription');
    return timed ? { timed, model } : null;
  }

  throw lastError || new Error('Gemini: all candidate models failed');
}

module.exports = { fetchGeminiTimedLyrics, MODELS };
