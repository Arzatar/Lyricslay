'use strict';

const fs = require('fs');
const path = require('path');

// Plain file logger for the main process — the app normally launches via a .vbs
// script with no console window, so console.log has nowhere a user could ever see
// it. Writing to a file in userData means "check the log" is always possible,
// including after the fact (crashes, silently-failing native dialogs, etc.).

let logFilePath = null;

function init(userDataPath) {
  logFilePath = path.join(userDataPath, 'overlay.log');
  try {
    // Start each run with a fresh file so it never grows unbounded — this app
    // has no rotation/cleanup story, and log volume is low enough not to need one.
    fs.writeFileSync(logFilePath, `--- session started ${new Date().toISOString()} ---\n`);
  } catch {
    // best-effort; if we can't write here, log() below will just no-op
  }
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    if (logFilePath) fs.appendFileSync(logFilePath, line);
  } catch {
    // logging must never crash the app it's trying to help debug
  }
}

function getLogFilePath() {
  return logFilePath;
}

module.exports = { init, log, getLogFilePath };
