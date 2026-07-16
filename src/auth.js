'use strict';

const { shell, safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

// Signs the user into their Google/YouTube account using Google's OAuth 2.0
// "device authorization grant" (RFC 8628) — the same flow TVs and other apps
// without an embeddable browser use, and the same technique the open-source
// ytmusicapi project documents as its "oauth" auth method.
//
// Why this instead of an embedded login window: an Electron BrowserWindow gets a
// blank profile with none of the user's saved passwords/passkeys/autofill, which
// makes Google sign-in painful. The device flow instead opens the user's real
// default browser (their actual Chrome/Edge/Opera profile, autofill and all) to a
// short Google verification page, and the app only ever receives a scoped OAuth
// access/refresh token — never the password, never a browser session to manage.
//
// CLIENT_ID / CLIENT_SECRET below are the public "TV and Limited Input device"
// OAuth client Google's own device-flow model expects to be embedded in client
// apps (this exact pair is publicly documented by yt-dlp and ytmusicapi for the
// same purpose) — it is not a secret tied to this app or to any user.
const CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
const CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT';
const SCOPE = 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube-paid-content';

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let authFilePath = null;
function getAuthFilePath() {
  if (!authFilePath) {
    authFilePath = path.join(app.getPath('userData'), 'ytmusic-auth.enc');
  }
  return authFilePath;
}

function saveAuth(auth) {
  const json = JSON.stringify(auth);
  const file = getAuthFilePath();
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(json));
  } else {
    fs.writeFileSync(file, json, 'utf8'); // fallback, e.g. some Linux setups w/o a keyring
  }
}

function loadAuth() {
  const file = getAuthFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clearAuth() {
  const file = getAuthFilePath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// Pure — exported for unit testing. 60s safety margin so we refresh a little
// before Google actually rejects the token.
function isTokenExpired(auth, nowMs = Date.now()) {
  if (!auth || !Number.isFinite(auth.obtainedAtMs) || !Number.isFinite(auth.expiresInSec)) return true;
  return nowMs >= auth.obtainedAtMs + auth.expiresInSec * 1000 - 60_000;
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function requestDeviceCode() {
  const { ok, json } = await postForm(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: SCOPE });
  if (!ok || !json.device_code) {
    throw new Error(`Failed to start Google sign-in: ${json.error || 'unknown error'}`);
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUrl: json.verification_url || json.verification_uri,
    intervalSec: json.interval || 5,
    expiresInSec: json.expires_in || 1800,
  };
}

async function pollForToken(deviceCode, intervalSec, expiresInSec, onTick) {
  const deadline = Date.now() + expiresInSec * 1000;
  let waitSec = intervalSec;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    if (onTick) onTick();

    const { json } = await postForm(TOKEN_URL, {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (json.access_token) {
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresInSec: json.expires_in,
        obtainedAtMs: Date.now(),
      };
    }
    if (json.error === 'authorization_pending') continue;
    if (json.error === 'slow_down') {
      waitSec += 5;
      continue;
    }
    throw new Error(`Google sign-in failed: ${json.error || 'unknown error'}`);
  }
  throw new Error('Google sign-in timed out — the code expired before it was confirmed.');
}

async function refreshAccessToken(auth) {
  const { ok, json } = await postForm(TOKEN_URL, {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: auth.refreshToken,
    grant_type: 'refresh_token',
  });
  if (!ok || !json.access_token) {
    throw new Error(`Failed to refresh Google sign-in: ${json.error || 'unknown error'}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: auth.refreshToken, // Google doesn't rotate this on refresh
    expiresInSec: json.expires_in,
    obtainedAtMs: Date.now(),
  };
}

// Starts the flow and opens the user's real default browser to confirm it.
// `onWaiting(userCode, verificationUrl)` fires once the code is ready to show;
// the returned promise resolves with the final auth object once the user
// confirms in their browser (or rejects on timeout/denial).
async function startDeviceLogin(onWaiting) {
  const { deviceCode, userCode, verificationUrl, intervalSec, expiresInSec } = await requestDeviceCode();

  shell.openExternal(verificationUrl);
  if (onWaiting) onWaiting(userCode, verificationUrl);

  const auth = await pollForToken(deviceCode, intervalSec, expiresInSec);
  saveAuth(auth);
  return auth;
}

// Returns a fresh, valid access token given the currently stored auth, refreshing
// (and persisting the refreshed result) if it's expired. Returns null if logged out.
async function getValidAccessToken(auth) {
  if (!auth) return null;
  if (!isTokenExpired(auth)) return auth.accessToken;

  const refreshed = await refreshAccessToken(auth);
  saveAuth(refreshed);
  Object.assign(auth, refreshed); // keep the caller's in-memory reference current
  return refreshed.accessToken;
}

function buildAuthHeaders(accessToken) {
  if (!accessToken) return null;
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Goog-AuthUser': '0',
  };
}

module.exports = {
  startDeviceLogin,
  loadAuth,
  clearAuth,
  getValidAccessToken,
  buildAuthHeaders,
  isTokenExpired,
};
