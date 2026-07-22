'use strict';

// Shared plumbing for every Gemini call in the app (lyrics transcription in
// geminiLyrics.js, romaji conversion in geminiRomaji.js): the model-fallback
// list and the "try each until one works" loop. See the "Why geminiLyrics.js
// tries a list of models" section of ARCHITECTURE.md for the full story —
// short version: free-tier daily quotas vary wildly between models on the
// same key (20/day for plain Flash releases vs 500/day for the newer "Lite"
// ones, verified directly against a real account), and there's no API to
// check remaining quota up front, so every Gemini call in this app tries
// this same ordered list and falls through to the next model on a 429/404
// rather than pinning to one. Deliberately short: `gemini-2.5-flash` and
// `gemini-2.5-flash-lite` were both tried here at one point and now 404
// ("no longer available to new users") — Google retires named models
// outright, not just quotas, so an older "stable, established" model isn't
// actually a safer bet than a newer one; every entry below is one verified
// live against a real key right before writing this, not assumed from a
// models-list description.
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

async function generateContent(model, apiKey, body) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Calls `buildBody(model)` -> request body for each model in MODELS in turn,
// passing each response to `onResponse(res, model)` to parse. `onResponse`
// returns the parsed result (any truthy value) to stop and return it, or a
// falsy value to mean "no usable result, but don't try another model either"
// (stops immediately, e.g. valid response but genuinely empty lyrics).
// A non-ok HTTP response always moves on to the next model. Throws only once
// every model has failed outright, so the caller handles one real error
// instead of one per candidate. `onAttempt(model, outcome)` is an optional
// logging hook.
async function tryModels(apiKey, buildBody, onResponse, onAttempt) {
  let lastError = null;
  for (const model of MODELS) {
    let res;
    try {
      res = await generateContent(model, apiKey, buildBody(model));
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
    const result = await onResponse(json);
    onAttempt?.(model, result ? 'hit' : 'no usable result');
    return result ? { result, model } : null;
  }

  throw lastError || new Error('Gemini: all candidate models failed');
}

module.exports = { MODELS, tryModels };
