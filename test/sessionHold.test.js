'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SessionHold } = require('../src/sessionHold');

const OPERA = 'OperaSoftware.OperaGXWebBrowser.1';

function tick(title, status, positionMs, extra = {}) {
  return {
    active: true,
    appId: OPERA,
    title,
    artist: `${title} artist`,
    status,
    positionMs,
    durationMs: 200000,
    audible: null,
    ...extra,
  };
}

test('passes ticks through unchanged while nothing is displaced', () => {
  const hold = new SessionHold();
  const a = tick('Music', 'Playing', 10000);
  assert.equal(hold.process(a, 0), a);
  const paused = tick('Music', 'Paused', 12000, { audible: true });
  assert.equal(hold.process(paused, 2000), paused);
});

test('resumes the music when a video that took over the browser session is paused while audio continues', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 10000), 0);
  hold.process(tick('Video', 'Playing', 0), 5000); // play pressed in another tab
  const out = hold.process(tick('Video', 'Paused', 3000, { audible: true }), 8000);
  assert.equal(out.title, 'Music');
  assert.equal(out.status, 'Playing');
  assert.equal(out.held, true);
  // Extrapolated from when the music was last really seen: 10s + 8s elapsed.
  assert.equal(out.positionMs, 18000);
});

test('does not resume when the browser went silent (the music was really paused too)', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 10000), 0);
  hold.process(tick('Video', 'Playing', 0), 5000);
  const paused = tick('Video', 'Paused', 3000, { audible: false });
  assert.equal(hold.process(paused, 8000), paused);
  const unknown = tick('Video', 'Paused', 3000, { audible: null });
  assert.equal(hold.process(unknown, 9000), unknown);
});

test('rides out a few silent ticks (quiet passage) before letting go', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 10000), 0);
  hold.process(tick('Video', 'Playing', 0), 5000);
  assert.equal(hold.process(tick('Video', 'Paused', 3000, { audible: true }), 8000).title, 'Music');
  for (let i = 1; i <= 3; i++) {
    assert.equal(hold.process(tick('Video', 'Paused', 3000, { audible: false }), 8000 + i * 800).title, 'Music');
  }
  assert.equal(hold.process(tick('Video', 'Paused', 3000, { audible: false }), 12000).title, 'Video');
});

test('never resumes a displaced track that is not eligible (e.g. a video with no lyrics)', () => {
  const hold = new SessionHold({ isEligible: (d) => d.title !== 'Video' });
  hold.process(tick('Video', 'Playing', 10000), 0);
  hold.process(tick('Music', 'Playing', 0), 5000); // music started over the video
  const paused = tick('Music', 'Paused', 3000, { audible: true }); // video still audible
  assert.equal(hold.process(paused, 8000), paused);
});

test('does not resume a displaced track that would have already ended', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 190000), 0); // 10s left
  hold.process(tick('Video', 'Playing', 0), 1000);
  const paused = tick('Video', 'Paused', 3000, { audible: true });
  assert.equal(hold.process(paused, 30000), paused);
});

test('a natural song change near the end of the previous song is not treated as a take-over', () => {
  const hold = new SessionHold();
  hold.process(tick('Song 1', 'Playing', 198000), 0);
  hold.process(tick('Song 2', 'Playing', 0), 2000);
  const paused = tick('Song 2', 'Paused', 5000, { audible: true });
  assert.equal(hold.process(paused, 7000), paused);
});

test('a track that was paused before being replaced is never resumed', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 10000), 0);
  hold.process(tick('Music', 'Paused', 11000), 1000); // user paused the music
  hold.process(tick('Video', 'Playing', 0), 5000);
  const paused = tick('Video', 'Paused', 3000, { audible: true });
  assert.equal(hold.process(paused, 8000), paused);
});

test('only resumes tracks from the same app as the paused session', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 10000, { appId: 'Spotify.exe' }), 0);
  hold.process(tick('Video', 'Playing', 0), 5000);
  const paused = tick('Video', 'Paused', 3000, { audible: true });
  assert.equal(hold.process(paused, 8000), paused);
});

test('follows the session again as soon as it reports something playing', () => {
  const hold = new SessionHold();
  hold.process(tick('Music', 'Playing', 10000), 0);
  hold.process(tick('Video', 'Playing', 0), 5000);
  assert.equal(hold.process(tick('Video', 'Paused', 3000, { audible: true }), 8000).title, 'Music');
  const back = tick('Music', 'Playing', 18500); // music tab refocused, reported for real
  assert.equal(hold.process(back, 8800), back);
  const paused = tick('Music', 'Paused', 19000, { audible: false });
  assert.equal(hold.process(paused, 9500), paused);
});

test('reports hold start and release through onHoldChange', () => {
  const events = [];
  const hold = new SessionHold({
    onHoldChange: (held, reported, reason) => events.push(held ? `hold:${held.title}` : `release:${reason}`),
  });
  hold.process(tick('Music', 'Playing', 10000), 0);
  hold.process(tick('Video', 'Playing', 0), 5000);
  hold.process(tick('Video', 'Paused', 3000, { audible: true }), 8000);
  hold.process(tick('Video', 'Paused', 3000, { audible: true }), 8800);
  hold.process(tick('Other', 'Playing', 0), 9600);
  assert.deepEqual(events, ['hold:Music', 'release:session reports a playing track again']);
});
