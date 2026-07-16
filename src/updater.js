'use strict';

// Thin wrapper around electron-updater. Keeps the autoUpdater event soup out of
// main.js: this module tracks a single `status` object and notifies subscribers
// (main.js uses that to redraw the tray's "Check for updates" item) whenever it
// changes, instead of main.js having to know about every autoUpdater event.

const { app } = require('electron');
const logger = require('./logger');

// electron-updater's `autoUpdater` is a lazy singleton getter, but constructing
// it immediately calls app.getVersion() — requiring the module (and touching
// that getter) at the top of the file, before Electron's app singleton has
// finished its own startup, crashes with "Cannot read properties of undefined
// (reading 'getVersion')" under `electron .` (dev). Packaged runs happened not
// to hit this timing window, which is what let it slip through untested. Doing
// the require inside init() — called from app.whenReady() — sidesteps it.
let autoUpdater = null;

// state: 'idle' | 'checking' | 'downloading' | 'downloaded' | 'not-available' | 'error'
let status = { state: 'idle' };
const listeners = [];

function setStatus(next) {
  status = next;
  for (const fn of listeners) fn(status);
}

function onStatusChange(fn) {
  listeners.push(fn);
}

function getStatus() {
  return status;
}

function init() {
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.logger = {
    info: (msg) => logger.log('[updater]', msg),
    warn: (msg) => logger.log('[updater:warn]', msg),
    error: (msg) => logger.log('[updater:error]', msg),
  };

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  // autoDownload is on, so an available update starts fetching immediately —
  // there's no useful separate "available but not downloading" state to show.
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', info, progress: null }));
  autoUpdater.on('update-not-available', (info) => setStatus({ state: 'not-available', info }));
  autoUpdater.on('download-progress', (progress) => setStatus({ state: 'downloading', info: status.info, progress }));
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'downloaded', info }));
  autoUpdater.on('error', (err) => setStatus({ state: 'error', error: err }));
}

function checkForUpdates() {
  // Unpackaged (dev) runs have no app-update.yml / feed URL and would just throw.
  if (!app.isPackaged) {
    logger.log('[updater] skipped check: app is not packaged (dev mode)');
    setStatus({ state: 'not-available', dev: true });
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    logger.log('[updater] checkForUpdates failed:', err.stack || String(err));
  });
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { init, checkForUpdates, quitAndInstall, getStatus, onStatusChange };
