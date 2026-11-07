'use strict';

// Works around Chromium-based browsers (Opera GX, Chrome, Edge, ...) exposing
// ONE Windows SMTC media session for the whole browser, fed by whichever tab
// most recently *started* playing — not one session per tab.
//
// Confirmed live: YT Music playing in one tab, switch to another tab, play a
// video, pause it. The browser's single session now reports the *paused
// video* indefinitely, even though YT Music never stopped playing — the music
// tab only becomes visible to SMTC again once it's refocused/re-interacted
// with. Merely focusing an already-paused tab (without pressing play) doesn't
// trigger this; the take-over only happens when the other tab starts playback.
//
// Nothing on the SMTC side can recover the music tab's info while this lasts,
// so this remembers tracks that got *displaced* (replaced by a different
// track from the same app while still Playing — never seen paused) and, when
// that app's session then reports a Paused track while the app is still
// audibly outputting sound (nowplaying.ps1's `audible` peak-meter check),
// re-emits the displaced track as if it were still being reported, with its
// position extrapolated from when it was last really seen.
//
// Only tracks that `isEligible` accepts (main.js: tracks that actually have
// lyrics) are ever resumed — so a video Gemini classified as "not music" (no
// lyrics) is never resumed over paused music in the mirrored case (video
// playing, then music started over it, then music paused).

const MAX_DISPLACED = 5;
// A displaced track this close to its end when it was displaced was most
// likely just a natural track change (song ended -> next song in the same
// tab), not a take-over by another tab.
const NEAR_END_MS = 5000;
// nowplaying.ps1 samples the meter several times per tick, but an extended
// quiet passage can still read as silence for a tick or two — only let go of
// a held track after this many consecutive non-audible paused ticks.
const SILENT_TICKS_TO_RELEASE = 4;

function trackKey(data) {
  return `${data.appId || ''}\u0000${data.title || ''}\u0000${data.artist || ''}`;
}

class SessionHold {
  constructor({ isEligible = () => true, onHoldChange = () => {} } = {}) {
    this.isEligible = isEligible;
    this.onHoldChange = onHoldChange;
    this.lastPlaying = null; // { data, seenAtMs, key }
    this.displaced = []; // newest first, same shape as lastPlaying
    this.holding = null; // key of the displaced entry currently being re-emitted
    this.silentTicks = 0;
  }

  // Takes one raw tick from nowplaying.ps1 and returns the tick to actually
  // act on: either the same object unchanged, or a synthesized copy of a
  // displaced track.
  process(data, nowMs = Date.now()) {
    if (!data || !data.active || !data.title) {
      this._release('no active session');
      return data;
    }

    const key = trackKey(data);

    if (data.status === 'Playing') {
      this._release('session reports a playing track again');
      // Back on a previously displaced track (its tab got refocused, or
      // reclaimed the session) — it's being reported for real again.
      this.displaced = this.displaced.filter((d) => d.key !== key);

      const prev = this.lastPlaying;
      if (prev && prev.key !== key && prev.data.appId === data.appId && !this._endedAt(prev, prev.seenAtMs, NEAR_END_MS)) {
        this.displaced = [prev, ...this.displaced.filter((d) => d.key !== prev.key)].slice(0, MAX_DISPLACED);
      }
      this.lastPlaying = { data, seenAtMs: nowMs, key };
      return data;
    }

    // Not Playing (Paused/Stopped/...). The current track itself is clearly
    // not playing anymore, so it can't be a displaced-and-still-playing one.
    this.displaced = this.displaced.filter((d) => d.key !== key);
    if (this.lastPlaying?.key === key) this.lastPlaying = null;

    if (data.audible !== true) {
      if (!this.holding) return data;
      this.silentTicks += 1;
      if (this.silentTicks < SILENT_TICKS_TO_RELEASE) {
        const held = this.displaced.find((d) => d.key === this.holding);
        if (held && !this._endedAt(held, nowMs, 0)) return this._synthesize(held, nowMs);
      }
      this._release('app went silent');
      return data;
    }
    this.silentTicks = 0;

    const candidate = this.displaced.find(
      (d) => d.data.appId === data.appId && !this._endedAt(d, nowMs, 0) && this.isEligible(d.data)
    );
    if (!candidate) {
      // Any displaced track from this app that has since run past its end
      // can never be resumed — the next song started in a tab SMTC can't see.
      this.displaced = this.displaced.filter((d) => d.data.appId !== data.appId || !this._endedAt(d, nowMs, 0));
      this._release('no resumable track');
      return data;
    }

    if (this.holding !== candidate.key) {
      this.holding = candidate.key;
      this.onHoldChange(candidate.data, data);
    }
    return this._synthesize(candidate, nowMs);
  }

  _positionAt(entry, nowMs) {
    return (entry.data.positionMs || 0) + Math.max(0, nowMs - entry.seenAtMs);
  }

  _endedAt(entry, nowMs, marginMs) {
    const duration = entry.data.durationMs;
    if (!Number.isFinite(duration) || duration <= 0) return false;
    return this._positionAt(entry, nowMs) >= duration - marginMs;
  }

  _synthesize(entry, nowMs) {
    return {
      ...entry.data,
      status: 'Playing',
      positionMs: Math.round(this._positionAt(entry, nowMs)),
      updatedAtMs: nowMs,
      held: true,
    };
  }

  _release(reason) {
    if (this.holding && reason) this.onHoldChange(null, null, reason);
    this.holding = null;
    this.silentTicks = 0;
  }
}

module.exports = { SessionHold, trackKey };
