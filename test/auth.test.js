'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTokenExpired } = require('../src/auth');

test('isTokenExpired is true when there is no stored auth', () => {
  assert.equal(isTokenExpired(null), true);
  assert.equal(isTokenExpired(undefined), true);
});

test('isTokenExpired is true when required fields are missing', () => {
  assert.equal(isTokenExpired({ obtainedAtMs: Date.now() }), true);
  assert.equal(isTokenExpired({ expiresInSec: 3600 }), true);
});

test('isTokenExpired is false for a token well within its lifetime', () => {
  const auth = { obtainedAtMs: 1_000_000, expiresInSec: 3600 };
  const now = 1_000_000 + 60_000; // 1 minute in, expires in 1 hour
  assert.equal(isTokenExpired(auth, now), false);
});

test('isTokenExpired is true once past expiry', () => {
  const auth = { obtainedAtMs: 1_000_000, expiresInSec: 3600 };
  const now = 1_000_000 + 3600 * 1000 + 1;
  assert.equal(isTokenExpired(auth, now), true);
});

test('isTokenExpired applies a 60s safety margin before the real expiry', () => {
  const auth = { obtainedAtMs: 1_000_000, expiresInSec: 3600 };
  const justInsideMargin = 1_000_000 + 3600 * 1000 - 30_000; // 30s left
  assert.equal(isTokenExpired(auth, justInsideMargin), true);
});
