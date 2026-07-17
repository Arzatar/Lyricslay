'use strict';

// Same safeStorage-encrypted-file-on-disk pattern as auth.js's YT Music
// token, applied to a single string instead of an OAuth token pair — each
// user brings their own free Gemini API key rather than the app shipping
// with one (see ARCHITECTURE.md's "AI transcription fallback" section for
// why: a key embedded in a publicly-distributed app is both extractable and
// shared across every install against the same daily quota).

const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');

let keyFilePath = null;
function getKeyFilePath() {
  if (!keyFilePath) {
    keyFilePath = path.join(app.getPath('userData'), 'gemini-key.enc');
  }
  return keyFilePath;
}

function saveGeminiKey(key) {
  const file = getKeyFilePath();
  const trimmed = (key || '').trim();
  if (!trimmed) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(trimmed));
  } else {
    fs.writeFileSync(file, trimmed, 'utf8'); // fallback, e.g. some Linux setups w/o a keyring
  }
}

function loadGeminiKey() {
  const file = getKeyFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    const buf = fs.readFileSync(file);
    const key = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return key || null;
  } catch {
    return null;
  }
}

function clearGeminiKey() {
  const file = getKeyFilePath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { saveGeminiKey, loadGeminiKey, clearGeminiKey };
