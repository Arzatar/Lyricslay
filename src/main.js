'use strict';

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage, shell, dialog, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { NowPlayingWatcher } = require('./nowplaying');
const { ForegroundAppWatcher } = require('./foregroundApp');
const { fetchLyricsForTrack, searchSong } = require('./ytmusic');
const { fetchSyncedLyrics } = require('./lrclib');
const lyricsOvh = require('./lyricsOvh');
const genius = require('./genius');
// Last-resort AI transcription fallback (see geminiLyrics.js) — only active
// once the user's brought their own free API key (tray -> Settings -> Set
// Gemini API key...); nothing is shipped/shared between installs. A
// GEMINI_API_KEY env var can override it too, purely as a local-dev
// convenience for testing without touching the encrypted store.
const { fetchGeminiTimedLyrics } = require('./geminiLyrics');
const { fetchRomajiLines, fetchRomajiText } = require('./geminiRomaji');
const { lyricsAreJapanese } = require('./langDetect');
const geminiKeyStore = require('./geminiKeyStore');
function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || geminiKeyStore.loadGeminiKey();
}
const ytmAuthModule = require('./auth');
const { LyricsCache } = require('./lyricsCache');
const { cleanTrackMetadata } = require('./trackMetadata');
const logger = require('./logger');
const updater = require('./updater');
const {
  trackKeyFor,
  anchoredBounds: computeAnchoredBounds,
  cycleValue,
  resizeKeepingTopLeftAnchored,
} = require('./utils');

const VISIBLE_LINES_OPTIONS = [1, 3, 5];
const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 56; // small enough that 1 visible line doesn't get clamped taller than it needs

// User-customizable global shortcuts (see the "Keyboard shortcuts…" tray item /
// shortcuts.html). `id` is the persistent key both in the store and in
// SHORTCUT_HANDLERS below; `label` is what the shortcuts window shows next to
// each row; `defaultAccelerator` seeds the store the first time it's read and
// is what "Reset to defaults" restores.
const SHORTCUT_DEFS = [
  { id: 'toggleLocked', label: 'Lock / unlock overlay (click-through)', defaultAccelerator: 'Control+Alt+L' },
  { id: 'toggleVisible', label: 'Show / hide overlay', defaultAccelerator: 'Control+Alt+H' },
  { id: 'increaseFontSize', label: 'Increase font size', defaultAccelerator: 'Control+Alt+Up' },
  { id: 'decreaseFontSize', label: 'Decrease font size', defaultAccelerator: 'Control+Alt+Down' },
  { id: 'increaseOpacity', label: 'Increase opacity', defaultAccelerator: 'Control+Alt+PageUp' },
  { id: 'decreaseOpacity', label: 'Decrease opacity', defaultAccelerator: 'Control+Alt+PageDown' },
  { id: 'moreVisibleLines', label: 'More visible lines', defaultAccelerator: 'Control+Alt+Right' },
  { id: 'fewerVisibleLines', label: 'Fewer visible lines', defaultAccelerator: 'Control+Alt+Left' },
  { id: 'advanceLyrics', label: 'Advance lyrics sync (earlier)', defaultAccelerator: 'Control+Alt+,' },
  { id: 'delayLyrics', label: 'Delay lyrics sync (later)', defaultAccelerator: 'Control+Alt+.' },
];
const DEFAULT_SHORTCUTS = Object.fromEntries(SHORTCUT_DEFS.map((s) => [s.id, s.defaultAccelerator]));

const store = new Store({
  defaults: {
    bounds: { width: 620, height: 260, x: undefined, y: undefined },
    // Per-app remembered position/size, keyed by the foreground process name
    // (e.g. "ffxiv_dx11", "Warframe.x64") — see foregroundApp.js. `bounds`
    // above stays the fallback for apps with no entry here yet.
    perAppBounds: {},
    fontSize: 22,
    opacity: 0.92,
    locked: false, // locked = click-through; unlocked lets you drag the overlay anywhere
    visible: true,
    visibleLines: 3,
    lyricsColor: '#ffffff',
    colorSwatchVisible: false,
    showRomaji: false,
    shortcuts: DEFAULT_SHORTCUTS,
  },
});

// Handlers are wrapped in arrows (rather than referenced directly) purely so this
// object can sit near SHORTCUT_DEFS, above the functions it calls — those are
// hoisted function declarations, so the forward reference resolves fine by the
// time any of these actually run (app startup, well after the whole module loads).
const SHORTCUT_HANDLERS = {
  toggleLocked: () => applyLocked(!store.get('locked')),
  toggleVisible: () => toggleVisible(),
  increaseFontSize: () => changeFontSize(2),
  decreaseFontSize: () => changeFontSize(-2),
  increaseOpacity: () => changeOpacity(0.05),
  decreaseOpacity: () => changeOpacity(-0.05),
  moreVisibleLines: () => changeVisibleLines(1),
  fewerVisibleLines: () => changeVisibleLines(-1),
  advanceLyrics: () => changeOffset(-100),
  delayLyrics: () => changeOffset(100),
};

let colorPickerOpen = false; // pauses the always-on-top re-assert while the native color picker is up

let win = null;
let tray = null;
let watcher = null;
let foregroundAppWatcher = null;
// The last *other* app the overlay was seen sitting on top of — excludes our
// own window (see OWN_PROCESS_NAME below), since clicking/dragging the
// overlay itself briefly makes it the OS foreground window, which would
// otherwise overwrite this with our own process name mid-drag. Position
// saves/restores are keyed off this rather than the raw watcher output.
let currentForegroundApp = null;
// process.execPath is ".../Lyricslay.exe" packaged, ".../electron.exe" in
// dev (`electron .`) — either way, basename-without-extension is exactly
// what Get-Process reports as ProcessName for our own window in
// foregroundApp.ps1's output, letting it be excluded the same way in both.
const OWN_PROCESS_NAME = path.basename(process.execPath, '.exe');
// Windows Explorer owns the taskbar, the tray's notification area, and the
// desktop itself — clicking the tray icon (which is how our own menu opens)
// or the taskbar briefly reports "explorer" as the foreground window, same
// as any real app switch would. Without excluding it here the same way
// OWN_PROCESS_NAME is excluded above, that click gets misattributed as "the
// user switched to Explorer," which then corrupts drag-to-save, *Move to…*,
// and *Reset position* into operating on an "explorer" entry instead of
// whatever app was actually behind the overlay a moment before.
const SHELL_PROCESS_NAME = 'explorer';

let currentTrackKey = null;
let currentLyrics = null; // { timed, static, source, videoId }
let fetchToken = 0;
let ytmAuth = null; // { accessToken, refreshToken, expiresInSec, obtainedAtMs } once logged in, else null
let lyricsCache = null;
let lastTrackData = null; // most recent now-playing tick, so login can bust its cache entry
let loginWin = null;
let lastVerificationUrl = null;
let shortcutsWin = null;
let positionPickerWin = null;
let geminiKeyWin = null;
// Last height the renderer asked for via 'set-desired-height' — kept around so
// applyDesiredSize() can be re-run from win's 'moved' event (e.g. dragged to a
// different-sized monitor) without needing the renderer to resend it.
let lastDesiredHeightPx = null;

function createLoginWindow() {
  const w = new BrowserWindow({
    width: 420,
    height: 320,
    parent: win,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Sign in — YouTube Music',
    webPreferences: {
      preload: path.join(__dirname, 'login-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  return w;
}

async function doLogin() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  loginWin = createLoginWindow();
  loginWin.on('closed', () => {
    loginWin = null;
  });

  try {
    const auth = await ytmAuthModule.startDeviceLogin((userCode, verificationUrl) => {
      lastVerificationUrl = verificationUrl;
      loginWin?.webContents.send('login-code', { userCode });
      loginWin?.webContents.send('login-status', {
        state: 'waiting',
        message: 'Waiting for you to confirm in the browser…',
      });
    });
    ytmAuth = auth;
    // The cache has no time-based expiry, so a plain re-fetch would just hit the
    // (possibly worse, unauthenticated) cached entry again — bust it explicitly for
    // whatever's playing right now so signing in actually gets a fresh, better lookup.
    if (lastTrackData) lyricsCache?.delete(lastTrackData.title, lastTrackData.artist);
    currentTrackKey = null; // force a re-fetch of the current track's lyrics with auth
    updateTrayMenu();
    loginWin?.webContents.send('login-status', { state: 'success', message: 'Signed in!' });
    setTimeout(() => {
      if (loginWin && !loginWin.isDestroyed()) loginWin.close();
    }, 1500);
  } catch (err) {
    loginWin?.webContents.send('login-status', {
      state: 'error',
      message: String(err?.message || err),
    });
  }
}

function doLogout() {
  ytmAuthModule.clearAuth();
  ytmAuth = null;
  currentTrackKey = null; // force a re-fetch without auth
  updateTrayMenu();
}

function topCenterBounds() {
  return computeAnchoredBounds('top-center', screen.getPrimaryDisplay().workArea);
}

// Clears `appName`'s remembered position (if it has one) so the next time
// it's foreground, applyForegroundApp() has nothing saved to re-apply and it
// falls back to the default — and if `appName` is the app currently behind
// the overlay (including both being null, before any app's been seen yet),
// also snaps the window there immediately instead of only on next switch.
// A bad per-app position (dragged somewhere unreachable, e.g. off-screen)
// would otherwise never be fixable: resetting only the window's *current*
// bounds without also clearing the saved entry just gets overwritten again
// the next time that app comes back to the foreground.
function resetPosition(appName) {
  if (appName) {
    const perApp = store.get('perAppBounds');
    if (Object.prototype.hasOwnProperty.call(perApp, appName)) {
      const next = { ...perApp };
      delete next[appName];
      store.set('perAppBounds', next);
    }
  }
  if (appName === currentForegroundApp && win && !win.isDestroyed()) {
    win.setBounds(topCenterBounds());
  }
  updateTrayMenu();
}

// One item for whatever app is currently behind the overlay (so the common
// case — "this one specific app's position is wrong, right now" — is always
// one click away without hunting for it below), then every *other* app with
// a remembered position, so a bad one can be fixed even from a different app
// (e.g. Warframe dragged off-screen while it's not even running).
function resetPositionSubmenu() {
  const perApp = store.get('perAppBounds');
  const items = [
    {
      label: currentForegroundApp ? `This app (${currentForegroundApp})` : 'Current window',
      click: () => resetPosition(currentForegroundApp),
    },
  ];
  const others = Object.keys(perApp).filter((name) => name !== currentForegroundApp).sort();
  if (others.length > 0) {
    items.push({ type: 'separator' });
    for (const name of others) {
      items.push({ label: name, click: () => resetPosition(name) });
    }
  }
  return items;
}

function createWindow() {
  const savedBounds = store.get('bounds');
  const bounds = savedBounds && Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y)
    ? savedBounds
    : { ...topCenterBounds(), ...savedBounds, x: undefined, y: undefined };
  if (bounds.x === undefined || bounds.y === undefined) {
    const tc = topCenterBounds();
    bounds.x = tc.x;
    bounds.y = tc.y;
  }
  win = new BrowserWindow({
    width: bounds.width || 620,
    height: bounds.height || 260,
    x: bounds.x,
    y: bounds.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    // The window's size is entirely programmatic now (height from the visible-lines
    // setting via 'set-desired-height', width fixed) — manual edge-resizing doesn't
    // interact well with that and was reported as producing an erratic, jumpy window.
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('console-message', (_e, _level, message) => logger.log('[renderer]', message));

  // 'screen-saver' level keeps the overlay above most fullscreen/borderless windows,
  // including many games. True exclusive-fullscreen (DirectX) apps can still cover it —
  // that's an OS/driver limitation no window flag can bypass.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (store.get('visible')) win.show();
    applyLocked(store.get('locked'));
  });

  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  // Width tracks whichever display the window is currently on (see
  // applyDesiredSize) — 'moved' fires once a drag settles, unlike the
  // continuous 'move', so this re-checks the display without fighting the drag.
  win.on('moved', () => applyDesiredSize(null));

  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Keep it above newly-focused fullscreen apps/games. Only while the overlay is
  // actually supposed to be visible — moveTop() also *shows* a hidden window as a
  // side effect, which would otherwise silently undo "Hide overlay" ~3s later
  // without updating the tray label or the persisted visible state to match.
  setInterval(() => {
    // Also paused while the native color picker is open — otherwise this yanks the
    // overlay back above its own picker popup every 3s, making it unusable.
    if (win && !win.isDestroyed() && store.get('visible') && !colorPickerOpen) win.moveTop();
  }, 3000);

  // sanity: if window ends up fully off-screen (e.g. monitor unplugged), recenter it.
  const [wx, wy] = win.getPosition();
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return wx >= a.x - 50 && wy >= a.y - 50 && wx < a.x + a.width && wy < a.y + a.height;
  });
  if (!onScreen) {
    const tc = topCenterBounds();
    win.setPosition(tc.x, tc.y);
  }
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  store.set('bounds', bounds);
  // Whatever app the overlay was last seen sitting on top of gets this exact
  // position/size remembered for it — no explicit "save" step; dragging the
  // overlay while a given game/app is behind it is the save action.
  //
  // Read-mutate-write the whole map with bracket access (not electron-store's
  // dot-path `set('perAppBounds.x', ...)`) since a process name can itself
  // contain a literal "." (e.g. Warframe's is "Warframe.x64") — dot-path
  // would silently split that into a nested perAppBounds.Warframe.x64
  // instead of one perAppBounds["Warframe.x64"] entry.
  if (currentForegroundApp) {
    const perApp = store.get('perAppBounds');
    store.set('perAppBounds', { ...perApp, [currentForegroundApp]: bounds });
  }
}

// Called whenever foregroundApp.ps1 reports a different foreground process.
// Applies that app's remembered position/size if there is one; otherwise
// leaves the overlay exactly where it already is (first time switching to a
// given app just means nothing moves until you drag it once).
function applyForegroundApp(processName) {
  if (!processName || processName === OWN_PROCESS_NAME || processName === SHELL_PROCESS_NAME) return;
  currentForegroundApp = processName;
  const saved = store.get('perAppBounds')[processName];
  if (saved && win && !win.isDestroyed()) {
    win.setBounds(saved);
  }
}

function applyLocked(locked) {
  store.set('locked', locked);
  if (!win || win.isDestroyed()) return;
  // Both states start fully click-through — "locked" stays that way permanently
  // (nothing intercepts clicks, not even the label), while "unlocked" lets the
  // renderer punch a temporary hole in that via 'set-interactive' whenever the
  // cursor is over the track-label drag handle. Either way, games/apps behind
  // the overlay keep receiving clicks everywhere else, all the time.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send('locked-changed', locked);
  updateTrayMenu();
}

function toggleVisible() {
  if (!win || win.isDestroyed()) return;
  const next = !win.isVisible();
  if (next) {
    win.show();
    win.moveTop();
  } else {
    win.hide();
  }
  store.set('visible', next);
  updateTrayMenu();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Lyricslay');
  updateTrayMenu();
  // On Windows, Electron only auto-shows the context menu on right-click; a plain
  // left-click just fires 'click' with no menu, which reads as "the tray icon does
  // nothing". Show the same menu on left-click too, matching how most tray apps behave.
  tray.on('click', () => tray.popUpContextMenu());
}

// "Control" -> "Ctrl" for a shorter, more familiar-looking tray label; the
// underlying accelerator string (what globalShortcut.register actually gets)
// is untouched — this only affects display.
function formatAccelerator(accelerator) {
  return accelerator ? accelerator.replace(/Control/g, 'Ctrl') : 'unassigned';
}

function shortcutFor(id) {
  return store.get('shortcuts')[id];
}

// Set while a user-initiated tray click is waiting on a result, so the
// "no update / error" outcomes (silent on the automatic startup check) get a
// dialog only when someone actually asked. Downloading/downloaded outcomes need
// no dialog either way — the tray item itself becomes the progress/install button.
let manualUpdateCheckPending = false;

function checkForUpdatesFromTray() {
  manualUpdateCheckPending = true;
  updater.checkForUpdates();
}

// Fires once per state *transition* (not on every download-progress tick,
// which reuses the 'downloading' state repeatedly) — a toast notification is
// how "an update is ready" reaches you without having to think to reopen the
// tray menu and check, which is the whole reason this exists.
let lastNotifiedUpdateState = null;

function notifyUpdateState(status) {
  if (status.state === lastNotifiedUpdateState) return;
  lastNotifiedUpdateState = status.state;
  if (!Notification.isSupported()) return;

  if (status.state === 'downloading') {
    new Notification({
      title: 'Lyricslay',
      body: `Update${status.info?.version ? ` v${status.info.version}` : ''} found — downloading…`,
    }).show();
  } else if (status.state === 'downloaded') {
    const notification = new Notification({
      title: 'Lyricslay update ready',
      body: `v${status.info?.version || ''} downloaded. Click here to restart and install now.`,
    });
    notification.on('click', () => updater.quitAndInstall());
    notification.show();
  }
}

updater.onStatusChange((status) => {
  notifyUpdateState(status);
  if (manualUpdateCheckPending && (status.state === 'not-available' || status.state === 'error')) {
    manualUpdateCheckPending = false;
    if (status.state === 'error') {
      dialog.showMessageBox({
        type: 'error',
        title: 'Lyricslay',
        message: "Couldn't check for updates",
        detail: status.error?.message || String(status.error),
      });
    } else if (status.dev) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Lyricslay',
        message: 'Update checks are disabled in this development build.',
      });
    } else {
      dialog.showMessageBox({
        type: 'info',
        title: 'Lyricslay',
        message: `You're up to date (v${app.getVersion()}).`,
      });
    }
  }
  updateTrayMenu();
});

// The single tray "update button" — its label/action changes with updater state
// instead of living as several separate menu items.
function updateMenuItem() {
  const status = updater.getStatus();
  switch (status.state) {
    case 'checking':
      return { label: 'Checking for updates…', enabled: false };
    case 'downloading': {
      const pct = status.progress ? ` (${Math.round(status.progress.percent)}%)` : '';
      return { label: `Downloading update…${pct}`, enabled: false };
    }
    case 'downloaded':
      return {
        label: `Restart to install update (v${status.info?.version || ''})`,
        click: () => updater.quitAndInstall(),
      };
    default:
      return { label: 'Check for updates…', click: checkForUpdatesFromTray };
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const locked = store.get('locked');
  const visible = win && !win.isDestroyed() ? win.isVisible() : store.get('visible');

  const menu = Menu.buildFromTemplate([
    { label: 'Lyricslay', enabled: false },
    { type: 'separator' },
    {
      label: `${visible ? 'Hide' : 'Show'} overlay (${formatAccelerator(shortcutFor('toggleVisible'))})`,
      click: toggleVisible,
    },
    {
      label: `${locked ? 'Unlock (move)' : 'Lock (click-through)'} (${formatAccelerator(shortcutFor('toggleLocked'))})`,
      click: () => applyLocked(!locked),
    },
    { type: 'separator' },
    {
      // Font/opacity/visible-lines/sync-nudge are all "set once and forget"
      // fine-tuning, unlike the actions around them (sync reset, re-search,
      // sign-in, ...) that get reached for often enough to want at the top
      // level — tucked away here once the flat list got too long to scan.
      label: 'Settings',
      submenu: [
        {
          label: `Increase font size (${formatAccelerator(shortcutFor('increaseFontSize'))})`,
          click: () => changeFontSize(2),
        },
        {
          label: `Decrease font size (${formatAccelerator(shortcutFor('decreaseFontSize'))})`,
          click: () => changeFontSize(-2),
        },
        {
          label: `Increase opacity (${formatAccelerator(shortcutFor('increaseOpacity'))})`,
          click: () => changeOpacity(0.05),
        },
        {
          label: `Decrease opacity (${formatAccelerator(shortcutFor('decreaseOpacity'))})`,
          click: () => changeOpacity(-0.05),
        },
        { type: 'separator' },
        {
          label: `Visible lines: ${store.get('visibleLines')}`,
          enabled: false,
        },
        {
          label: `More visible lines (${formatAccelerator(shortcutFor('moreVisibleLines'))})`,
          click: () => changeVisibleLines(1),
        },
        {
          label: `Fewer visible lines (${formatAccelerator(shortcutFor('fewerVisibleLines'))})`,
          click: () => changeVisibleLines(-1),
        },
        { type: 'separator' },
        {
          label: `This song's sync offset: ${currentOffsetMs()}ms`,
          enabled: false,
        },
        {
          label: `Advance lyrics sync (${formatAccelerator(shortcutFor('advanceLyrics'))})`,
          click: () => changeOffset(-100),
        },
        {
          label: `Delay lyrics sync (${formatAccelerator(shortcutFor('delayLyrics'))})`,
          click: () => changeOffset(100),
        },
        { type: 'separator' },
        {
          // Every lyrics source attempt now gets logged here (see
          // handleTrackTick) — which one won for a given song, why the
          // earlier ones in the fallback chain didn't, and why one person's
          // "P.O.V." got synced lyrics while someone else's didn't. Opens
          // the containing folder (not the file directly) so it's one click
          // to also grab overlay.log's neighbors if a report needs them.
          label: 'Open log file',
          click: () => {
            const logPath = logger.getLogFilePath();
            if (logPath) shell.showItemInFolder(logPath);
          },
        },
        { type: 'separator' },
        {
          // Bring-your-own-key by design (see geminiKeyStore.js) — nothing
          // shipped in the app itself, so this step of the lyrics chain is
          // silently skipped for everyone until they set their own here.
          label: geminiKeyStore.loadGeminiKey() ? 'AI lyrics fallback: key set' : 'Set up AI lyrics fallback…',
          click: openGeminiKeySettings,
        },
        {
          // Only ever does anything for songs actually detected as Japanese
          // (see langDetect.js) — flipping this on for an English song is a
          // harmless no-op, nothing gets sent to Gemini for it.
          label: store.get('showRomaji') ? 'Show original (hide romaji)' : 'Show romaji for Japanese lyrics',
          click: toggleShowRomaji,
        },
      ],
    },
    {
      // Chromium only opens an <input type="color">'s native picker on a genuine
      // user click — none triggered from this menu ever works, silently, no error —
      // so the swatch itself has to live on the overlay. Hidden by default since a
      // permanent dot next to the title was reported as unwanted clutter; this
      // reveals it (and preps the window to actually be clickable) on demand.
      label: store.get('colorSwatchVisible')
        ? 'Hide color dot'
        : 'Show color dot (to change it)',
      click: toggleColorSwatchVisible,
    },
    { type: 'separator' },
    {
      label: 'Reset sync',
      click: resetOffset,
    },
    {
      label: 'Re-search lyrics for this song',
      enabled: !!lastTrackData?.title,
      submenu: [
        { label: 'Automatic (all sources)', click: () => retryLyrics('auto') },
        { label: 'YouTube Music', click: () => retryLyrics('youtube') },
        { label: 'LRCLIB (free API)', click: () => retryLyrics('api') },
        {
          label: 'Gemini AI only',
          enabled: !!getGeminiApiKey(),
          click: () => retryLyrics('gemini'),
        },
      ],
    },
    { type: 'separator' },
    {
      label: 'Move to…',
      click: openPositionPicker,
    },
    {
      label: 'Reset position',
      submenu: resetPositionSubmenu(),
    },
    { type: 'separator' },
    {
      label: `${startWithWindowsEnabled() ? 'Disable' : 'Enable'} start with Windows`,
      click: () => setStartWithWindows(!startWithWindowsEnabled()),
    },
    {
      label: 'Keyboard shortcuts…',
      click: openShortcutsWindow,
    },
    { type: 'separator' },
    {
      label: ytmAuth ? 'Sign out of YouTube Music' : 'Sign in with YouTube Music (Premium)',
      click: () => (ytmAuth ? doLogout() : doLogin()),
    },
    { type: 'separator' },
    updateMenuItem(),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function changeFontSize(delta) {
  const size = Math.max(12, Math.min(48, store.get('fontSize') + delta));
  store.set('fontSize', size);
  win?.webContents.send('font-size-changed', size);
}

function changeOpacity(delta) {
  const op = Math.max(0.2, Math.min(1, +(store.get('opacity') + delta).toFixed(2)));
  store.set('opacity', op);
  win?.webContents.send('opacity-changed', op);
}

function changeVisibleLines(direction) {
  const next = cycleValue(VISIBLE_LINES_OPTIONS, store.get('visibleLines'), direction);
  store.set('visibleLines', next);
  win?.webContents.send('visible-lines-changed', next);
  updateTrayMenu();
}

function toggleColorSwatchVisible() {
  const next = !store.get('colorSwatchVisible');
  store.set('colorSwatchVisible', next);
  win?.webContents.send('color-swatch-visible-changed', next);
  if (next && win && !win.isDestroyed()) {
    // Showing the swatch only helps if it's actually reachable — prep the window
    // the same way the old dedicated menu item used to.
    if (!win.isVisible()) toggleVisible();
    if (store.get('locked')) applyLocked(false);
    win.moveTop();
  }
  updateTrayMenu();
}

// Positive = lyrics show later (delay them), negative = earlier — see the matching
// convention note on renderer.js's updateActiveLine, which is where this is applied.
function currentOffsetMs() {
  return currentLyrics?.offsetMs ?? 0;
}

function changeOffset(deltaMs) {
  if (!lastTrackData || !lyricsCache) return;
  const offsetMs = lyricsCache.adjustOffset(lastTrackData.title, lastTrackData.artist, deltaMs);
  if (offsetMs === null) return; // lyrics for this track haven't finished loading yet
  if (currentLyrics) currentLyrics.offsetMs = offsetMs;
  win?.webContents.send('offset-changed', offsetMs);
  updateTrayMenu();
}

function resetOffset() {
  if (!lastTrackData || !lyricsCache) return;
  const offsetMs = lyricsCache.resetOffset(lastTrackData.title, lastTrackData.artist);
  if (offsetMs === null) return;
  if (currentLyrics) currentLyrics.offsetMs = offsetMs;
  win?.webContents.send('offset-changed', offsetMs);
  updateTrayMenu();
}

// For when a source matched the wrong song, or returned something garbled/
// truncated — the cache has no time-based expiry (see README > Lyrics cache),
// so a plain re-fetch would just hit that same bad cached entry again. This
// busts it and re-runs the lookup immediately, same as the cache-bust already
// done automatically on sign-in, but user-triggered and for whichever source
// currently has bad data instead of only the "should now use auth" case.
// `mode` picks which source(s) to restrict the re-run to — see the comment
// on handleTrackTick's `mode` parameter for what each one skips/keeps.
function retryLyrics(mode = 'auto') {
  if (!lastTrackData?.title || !lyricsCache) return;
  logger.log(`[lyrics] manual re-search requested for "${lastTrackData.title}" — "${lastTrackData.artist}" (mode=${mode})`);
  lyricsCache.delete(lastTrackData.title, lastTrackData.artist);
  currentTrackKey = null;
  handleTrackTick(lastTrackData, mode);
}

// Registers every configured shortcut fresh (see SHORTCUT_DEFS/SHORTCUT_HANDLERS
// near the top of the file) — called at startup and again after any change from
// the shortcuts window, always starting from unregisterAll() so a shortcut moved
// off of one key combination doesn't linger registered on it.
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const shortcuts = store.get('shortcuts');
  for (const { id } of SHORTCUT_DEFS) {
    const accelerator = shortcuts[id];
    if (!accelerator) continue; // user cleared this one — leave it unbound
    const ok = globalShortcut.register(accelerator, SHORTCUT_HANDLERS[id]);
    if (!ok) logger.log(`failed to register shortcut "${id}":`, accelerator);
  }
}

// Unpackaged (dev/portable) runs execute through node_modules/electron/dist/
// electron.exe, which needs an explicit path to this project passed as an
// argument — otherwise Windows would launch a bare Electron shell at login
// with nothing to run. A packaged build's own .exe already knows what to
// load, so these only matter for portable/dev runs.
//
// getLoginItemSettings() must be checked with these *same* path/args, not just
// setLoginItemSettings() — on Windows it compares against whatever path/args
// are passed in (defaulting to process.execPath with none), so reading it back
// with no arguments after registering *with* args made it always report
// `openAtLogin: false` even immediately after successfully enabling it, since
// the stored registry command line (exe + project path) never matched the
// bare-exe comparison the read was making.
function loginItemOptions() {
  if (app.isPackaged) return {};
  return { path: process.execPath, args: [path.join(__dirname, '..')] };
}

function startWithWindowsEnabled() {
  return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
}

function setStartWithWindows(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, ...loginItemOptions() });
  updateTrayMenu();
}

function createShortcutsWindow() {
  const w = new BrowserWindow({
    width: 460,
    height: 640,
    parent: win,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Keyboard Shortcuts',
    webPreferences: {
      preload: path.join(__dirname, 'shortcuts-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'shortcuts.html'));
  return w;
}

function openShortcutsWindow() {
  if (shortcutsWin && !shortcutsWin.isDestroyed()) {
    shortcutsWin.focus();
    return;
  }
  shortcutsWin = createShortcutsWindow();
  shortcutsWin.on('closed', () => {
    shortcutsWin = null;
  });
}

function createGeminiKeyWindow() {
  const w = new BrowserWindow({
    width: 420,
    height: 380,
    parent: win,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'AI Lyrics Fallback',
    webPreferences: {
      preload: path.join(__dirname, 'gemini-key-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'geminiKey.html'));
  return w;
}

function openGeminiKeySettings() {
  if (geminiKeyWin && !geminiKeyWin.isDestroyed()) {
    geminiKeyWin.focus();
    return;
  }
  geminiKeyWin = createGeminiKeyWindow();
  geminiKeyWin.on('closed', () => {
    geminiKeyWin = null;
  });
}

// A visual 3x3 anchor grid (see renderer/positionPicker.html) — clicking a
// cell moves the overlay straight to that spot, matching the "top-left,
// top-center, ..., bottom-right" grid this mirrors 1:1 (see anchoredBounds
// in utils.js). Small and frameless so it reads as a popover, not a real
// window.
function createPositionPickerWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 180;
  const height = 210;
  const w = new BrowserWindow({
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Move overlay',
    webPreferences: {
      preload: path.join(__dirname, 'position-picker-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname, 'renderer', 'positionPicker.html'));
  // Reads as a popover, not a real window — losing focus (clicked elsewhere,
  // alt-tabbed away) is as much a "done here" signal as actually picking a
  // cell, so close it either way instead of leaving a stray always-on-top
  // window sitting on screen.
  w.on('blur', () => {
    if (!w.isDestroyed()) w.close();
  });
  return w;
}

function openPositionPicker() {
  if (positionPickerWin && !positionPickerWin.isDestroyed()) {
    positionPickerWin.focus();
    return;
  }
  positionPickerWin = createPositionPickerWindow();
  positionPickerWin.on('closed', () => {
    positionPickerWin = null;
  });
}

// If "Show romaji" is on and this song's lyrics have a `.romaji` version
// cached, swaps it in for display — otherwise returns `lyrics` unchanged.
// Only ever touches what's sent over IPC; the cache file always keeps the
// original text too, so turning the setting back off instantly reverts.
function lyricsForDisplay(lyrics) {
  if (!lyrics || !store.get('showRomaji') || !lyrics.romaji) return lyrics;
  return {
    ...lyrics,
    timed: lyrics.romaji.timed ?? lyrics.timed,
    static: lyrics.romaji.static ?? lyrics.static,
  };
}

// Converts whichever of timed/static this song actually has into romaji via
// Gemini, returning a new lyrics object with a `.romaji` field, or null if
// nothing usable came back (quota exhausted on every candidate model,
// network error, etc.) — a failure here just means the toggle has nothing
// to show yet, never a crash or a lost original lyric.
async function computeRomaji(title, artist, lyrics, apiKey) {
  const onAttempt = (model, outcome) => logger.log(`[romaji] (${model}): ${outcome}`);
  try {
    if (Array.isArray(lyrics.timed) && lyrics.timed.length > 0) {
      logger.log(`[romaji] converting ${lyrics.timed.length} timed lines for "${title}" — "${artist}"...`);
      const romajiLines = await fetchRomajiLines(lyrics.timed.map((l) => l.text), apiKey, onAttempt);
      if (!romajiLines) return null;
      const romajiTimed = lyrics.timed.map((l, i) => ({ timeMs: l.timeMs, text: romajiLines[i] }));
      logger.log(`[romaji] hit (${romajiTimed.length} lines)`);
      return { ...lyrics, romaji: { timed: romajiTimed, static: null } };
    }
    if (typeof lyrics.static === 'string' && lyrics.static.trim()) {
      logger.log(`[romaji] converting static text for "${title}" — "${artist}"...`);
      const romajiText = await fetchRomajiText(lyrics.static, apiKey, onAttempt);
      if (!romajiText) return null;
      logger.log('[romaji] hit');
      return { ...lyrics, romaji: { timed: null, static: romajiText } };
    }
    return null;
  } catch (err) {
    logger.log('[romaji] all candidate models failed:', err?.message || err);
    return null;
  }
}

// Fire-and-forget: kicks off romaji conversion in the background (if the
// setting's on, a key's configured, the song is actually Japanese, and it
// isn't already computed) without making the caller wait for it — lyrics
// always show immediately in their original text first, then get swapped
// to romaji a moment later once the conversion lands, same "progressive"
// feel as the AI transcription fallback itself. Guards against a track
// change happening mid-request by checking `currentTrackKey` before acting
// on the result, the same race this file already handles via `fetchToken`
// inside handleTrackTick.
function maybeBackfillRomaji(title, artist, lyrics) {
  if (!store.get('showRomaji') || !lyrics || lyrics.romaji || !lyricsAreJapanese(lyrics)) return;
  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) return;

  // Guards against the same fetchToken race as the main lyrics chain (see
  // the dedicated section in ARCHITECTURE.md) — but comparing `key !==
  // currentTrackKey` alone isn't enough here specifically: re-searching the
  // *same* song that's already playing doesn't change `key`, only bumps
  // `fetchToken`. Confirmed directly: re-searching a Japanese song while its
  // *previous* automatic romaji conversion was still in flight let both
  // finish and race to overwrite each other's result. Capturing fetchToken
  // at kickoff and checking it (not just the track key) on the other side
  // catches that case too.
  const key = trackKeyFor(title, artist);
  const myFetchToken = fetchToken;
  computeRomaji(title, artist, lyrics, geminiApiKey).then((updated) => {
    if (!updated || key !== currentTrackKey || myFetchToken !== fetchToken) return;
    lyricsCache?.set(title, artist, updated);
    currentLyrics = lyricsCache?.get(title, artist) ?? updated;
    win?.webContents.send('lyrics-result', { title, artist, lyrics: lyricsForDisplay(currentLyrics) });
  });
}

function toggleShowRomaji() {
  const next = !store.get('showRomaji');
  store.set('showRomaji', next);
  updateTrayMenu();
  if (lastTrackData && currentLyrics) {
    win?.webContents.send('lyrics-result', {
      title: lastTrackData.title,
      artist: lastTrackData.artist,
      lyrics: lyricsForDisplay(currentLyrics),
    });
    if (next) maybeBackfillRomaji(lastTrackData.title, lastTrackData.artist, currentLyrics);
  }
}

// mode picks which primary source(s) "Re-search lyrics for this song" starts
// from, each keeping its own natural downstream fallback tail:
//   'auto'    - the full default chain, unchanged (YT auth -> LRCLIB -> YT
//               unauth -> Gemini -> static).
//   'youtube' - YT Music only (auth then unauth), skipping LRCLIB entirely,
//               then falling through to Gemini -> static same as auto.
//   'api'     - LRCLIB only, skipping YouTube entirely, then Gemini -> static.
//   'gemini'  - Gemini only. No fallback after it at all, static included -
//               it's already the last real attempt in the normal chain, so
//               picking it explicitly means "just the AI, nothing else."
// Regular automatic ticks from the now-playing watcher never pass a mode,
// so they always get 'auto' — this only ever differs for a manual re-search
// (see retryLyrics()).
async function handleTrackTick(data, mode = 'auto') {
  // Third-party YouTube re-uploads (common for niche/harder-to-keep-online artists)
  // often report a useless (title, artist) pair for lyrics purposes — the artist
  // field is frequently just the uploader's channel name. Cleaning it here, once,
  // means everything downstream (display label, cache key, every lyrics source's
  // search query) automatically benefits; it's a no-op for already-clean metadata.
  if (data.active && data.title) {
    const cleaned = cleanTrackMetadata(data.title, data.artist);
    data = { ...data, title: cleaned.title, artist: cleaned.artist };
  }

  win?.webContents.send('now-playing', data);

  if (!data.active || !data.title) return;
  lastTrackData = data;

  const key = trackKeyFor(data.title, data.artist);
  if (key === currentTrackKey) return;
  currentTrackKey = key;
  currentLyrics = null;
  // Bumped unconditionally on every real track change, before knowing yet
  // whether this resolves via a cache hit or a fresh fetch — a fast-path
  // cache hit still needs to invalidate whatever fetch was already in
  // flight for the *previous* track. Without this, switching A -> B -> back
  // to A while B's lookup is still running let B's stale result land after
  // A's cache-hit result already displayed, silently overwriting the
  // correct lyrics with the wrong song's (confirmed directly: YT Music ->
  // Spotify -> back to YT Music mid-search did exactly this).
  const myToken = ++fetchToken;
  // Enables "Re-search lyrics for this song" (disabled until there's a track to
  // retry) — the tray menu is only rebuilt on explicit actions, not every tick,
  // so a real track change needs its own trigger here rather than relying on
  // whatever else happens to touch the tray next.
  updateTrayMenu();

  logger.log(`[lyrics] new track: "${data.title}" — "${data.artist}"`);

  const cached = lyricsCache?.get(data.title, data.artist);
  if (cached) {
    logger.log(`[lyrics] cache hit, source=${cached.source} ${cached.timed ? '(timed)' : cached.static ? '(static)' : '(none)'}`);
    currentLyrics = cached;
    win?.webContents.send('lyrics-result', { title: data.title, artist: data.artist, lyrics: lyricsForDisplay(cached) });
    maybeBackfillRomaji(data.title, data.artist, cached);
    return;
  }

  win?.webContents.send('lyrics-loading', { title: data.title, artist: data.artist });

  try {
    const durationSec = Number.isFinite(data.durationMs) && data.durationMs > 0
      ? data.durationMs / 1000
      : null;
    logger.log(`[lyrics] cache miss, searching (durationSec=${durationSec}, authed=${!!ytmAuth})`);

    // Timed lyrics are the only thing that satisfies the chain; a source
    // returning only plain/static text no longer stops the search, it just
    // gets kept as `staticFallback` in case *nothing* ever produces timed
    // lyrics, tried dead last instead of accepted on the spot.
    // ytmResult/videoId gets threaded through every step so the AI fallback
    // can reuse whichever YT Music search already resolved a videoId,
    // without a redundant extra search call.
    let lyrics = null;
    let ytmResult = null;
    let staticFallback = null; // { static, source } — last resort only

    // Step 1: YT Music, authenticated — timed only.
    if ((mode === 'auto' || mode === 'youtube') && ytmAuth) {
      let authHeaders = null;
      try {
        const accessToken = await ytmAuthModule.getValidAccessToken(ytmAuth);
        authHeaders = ytmAuthModule.buildAuthHeaders(accessToken);
      } catch (err) {
        // The refresh token itself got revoked/expired server-side — this is
        // the only case that should actually sign the user out.
        logger.log('[lyrics] ytmusic-timed-auth: refresh failed, signing out:', err?.message || err);
        ytmAuth = null;
        updateTrayMenu();
      }
      if (authHeaders) {
        try {
          ytmResult = await fetchLyricsForTrack(data.title, data.artist, authHeaders);
          if (myToken !== fetchToken) return;
          if (ytmResult?.timed) {
            lyrics = { timed: ytmResult.timed, static: null, source: 'ytmusic-timed-auth' };
            logger.log(`[lyrics] ytmusic-timed-auth: hit (${ytmResult.timed.length} lines)`);
          } else {
            logger.log(`[lyrics] ytmusic-timed-auth: no timed lyrics (static=${!!ytmResult?.static})`);
            if (ytmResult?.static && !staticFallback) {
              staticFallback = { static: ytmResult.static, source: 'ytmusic-static-auth' };
            }
          }
        } catch (err) {
          // A single request in the lookup (search/browse) failed — the
          // token itself is still fine, so stay signed in and just fall
          // back to the unauthenticated sources below for this track.
          logger.log('[lyrics] ytmusic-timed-auth: request failed, falling back unauthenticated:', err?.message || err);
          ytmResult = null;
        }
      }
    }

    // Step 2: LRCLIB — timed only.
    if (!lyrics && (mode === 'auto' || mode === 'api')) {
      const synced = await fetchSyncedLyrics(data.title, data.artist, durationSec);
      if (myToken !== fetchToken) return;
      if (synced?.timed) {
        lyrics = { timed: synced.timed, static: null, source: 'lrclib-synced' };
        logger.log(`[lyrics] lrclib: hit, timed (${synced.timed.length} lines)`);
      } else {
        if (synced?.plain && !staticFallback) {
          staticFallback = { static: synced.plain, source: 'lrclib-plain' };
        }
        logger.log(`[lyrics] lrclib: no timed match (plain=${!!synced?.plain})`);
      }
    }

    // Step 3: YT Music again, unauthenticated this time — still timed only.
    // In practice YT Music's timed-lyrics renderer only ever responds to
    // authenticated requests (see ARCHITECTURE.md), so this realistically
    // never hits — kept anyway since it's cheap (reuses step 1's result
    // when we have one) and costs nothing to check.
    if (!lyrics && (mode === 'auto' || mode === 'youtube')) {
      const fallback = ytmResult ?? (await fetchLyricsForTrack(data.title, data.artist));
      if (myToken !== fetchToken) return;
      ytmResult = ytmResult ?? fallback; // keep the videoId around for the AI step below
      if (fallback?.timed) {
        lyrics = { timed: fallback.timed, static: null, source: 'ytmusic-timed-unauth' };
        logger.log(`[lyrics] ytmusic-timed-unauth: hit (${fallback.timed.length} lines)`);
      } else {
        if (fallback?.static && !staticFallback) {
          staticFallback = { static: fallback.static, source: 'ytmusic-static' };
        }
        logger.log(`[lyrics] ytmusic-timed-unauth: no timed match (static=${!!fallback?.static})`);
      }
    }

    // Step 4 (TODO, not implemented in this prototype): another free
    // timed-lyrics source beyond LRCLIB/YT Music — NetEase Cloud Music's
    // public API was the obvious candidate (used by other open-source lyrics
    // tools) but its search/lyric endpoints now require its own AES+RSA
    // request-encryption scheme, not a plain keyless GET as assumed; skipped
    // for now rather than half-implementing crypto plumbing in a prototype.

    // Step 5: last resort — ask Gemini to transcribe the song directly from
    // its YouTube video (no audio capture on our end; Gemini's API can
    // ingest a YouTube URL as input). Only runs if nothing above found
    // *timed* lyrics. See geminiLyrics.js.
    const geminiApiKey = getGeminiApiKey();
    if (!lyrics && geminiApiKey) {
      const videoId = ytmResult?.videoId ?? (await searchSong(data.title, data.artist))?.videoId;
      if (myToken !== fetchToken) return;
      if (videoId) {
        logger.log(`[lyrics] gemini: asking about youtube video ${videoId}...`);
        try {
          const result = await fetchGeminiTimedLyrics(
            videoId,
            geminiApiKey,
            (model, outcome) => logger.log(`[lyrics] gemini (${model}): ${outcome}`),
            data.durationMs
          );
          if (myToken !== fetchToken) return;
          if (result) {
            if (result.correctedUnits) {
              logger.log('[lyrics] gemini: response used seconds instead of milliseconds, corrected against known song duration');
            }
            lyrics = { timed: result.timed, static: null, source: `gemini-ai:${result.model}` };
          }
        } catch (err) {
          logger.log('[lyrics] gemini: all candidate models failed:', err?.message || err);
        }
      } else {
        logger.log('[lyrics] gemini: no videoId to give it, skipping');
      }
    }

    // Nothing timed anywhere, including AI — try the remaining plain-text-only
    // sources (if step 1-3 didn't already leave us a staticFallback) before
    // finally giving up, same as the old chain's tail end. Skipped entirely
    // in 'gemini' mode — picking Gemini explicitly means only the AI, no
    // static fallback of any kind, since it's already the last real attempt
    // in the normal chain.
    if (!lyrics && !staticFallback && mode !== 'gemini') {
      try {
        const ovh = await lyricsOvh.fetchLyrics(data.title, data.artist);
        if (myToken !== fetchToken) return;
        if (ovh?.plain) {
          staticFallback = { static: ovh.plain, source: 'lyricsovh-plain' };
          logger.log('[lyrics] lyricsovh: hit');
        } else {
          logger.log('[lyrics] lyricsovh: no match');
        }
      } catch (err) {
        logger.log('[lyrics] lyricsovh: request failed:', err?.message || err);
      }
    }

    if (!lyrics && !staticFallback && mode !== 'gemini') {
      try {
        const scraped = await genius.fetchLyrics(data.title, data.artist);
        if (myToken !== fetchToken) return;
        if (scraped?.plain) {
          staticFallback = { static: scraped.plain, source: 'genius-scraped' };
          logger.log('[lyrics] genius: hit');
        } else {
          logger.log('[lyrics] genius: no match');
        }
      } catch (err) {
        logger.log('[lyrics] genius: request failed:', err?.message || err);
      }
    }

    if (!lyrics && staticFallback) {
      logger.log(`[lyrics] falling back to static-only result from ${staticFallback.source} (no timed lyrics found anywhere, including AI)`);
      lyrics = { timed: null, static: staticFallback.static, source: staticFallback.source };
    }

    if (!lyrics) {
      lyrics = { timed: null, static: null, source: 'none' };
    }

    logger.log(`[lyrics] result: source=${lyrics.source} ${lyrics.timed ? '(timed)' : lyrics.static ? '(static)' : '(none)'}`);
    lyricsCache?.set(data.title, data.artist, lyrics);
    // Re-read from the cache rather than using `lyrics` as-is so the renderer gets
    // the canonical stored shape — specifically offsetMs, which set() defaults to 0
    // but a per-song value could already exist from a previous adjustOffset() call.
    currentLyrics = lyricsCache?.get(data.title, data.artist) ?? lyrics;
    win?.webContents.send('lyrics-result', {
      title: data.title,
      artist: data.artist,
      lyrics: lyricsForDisplay(currentLyrics),
    });
    maybeBackfillRomaji(data.title, data.artist, currentLyrics);
  } catch (err) {
    if (myToken !== fetchToken) return;
    logger.log('[lyrics] lookup threw:', err?.stack || err?.message || err);
    win?.webContents.send('lyrics-result', {
      title: data.title,
      artist: data.artist,
      lyrics: null,
      error: String(err?.message || err),
    });
  }
}

function startWatcher() {
  watcher = new NowPlayingWatcher();
  watcher.on('track', handleTrackTick);
  watcher.on('error', () => {
    win?.webContents.send('now-playing', { active: false });
  });
  watcher.start();

  foregroundAppWatcher = new ForegroundAppWatcher();
  foregroundAppWatcher.on('change', applyForegroundApp);
  foregroundAppWatcher.start();
}

// Includes the *current* now-playing/lyrics state (not just static settings)
// specifically so the renderer can recover it on load regardless of timing —
// `handleTrackTick` starts firing (from the already-playing track it finds
// on its very first tick) as soon as `startWatcher()` runs in
// `app.whenReady()`, which doesn't wait for the renderer's page to finish
// loading and register its 'now-playing'/'lyrics-result' listeners first.
// Confirmed directly: a track already playing before launch got detected
// and its lyrics found (cache hit) a mere ~270ms after "app ready" — easily
// before a freshly (re)loaded renderer, especially right after an
// auto-update, has necessarily finished loading — so those pushed IPC
// events land with nobody listening yet and are simply lost, leaving the
// overlay stuck on its initial "waiting for YouTube Music" hint until the
// next real track change. The renderer's own `getInitState()` call, by
// contrast, always happens *from* the renderer once it's already loaded and
// ready to receive the response, so pulling the last known state through it
// is timing-safe in a way pushed events aren't.
ipcMain.handle('get-init-state', () => ({
  fontSize: store.get('fontSize'),
  opacity: store.get('opacity'),
  locked: store.get('locked'),
  visibleLines: store.get('visibleLines'),
  lyricsColor: store.get('lyricsColor'),
  colorSwatchVisible: store.get('colorSwatchVisible'),
  nowPlaying: lastTrackData ?? null,
  lyrics: currentLyrics ? lyricsForDisplay(currentLyrics) : null,
}));

// Resizes the window to `heightPx` (the renderer's font/visible-lines-driven
// content height) and to a third of the current display's work-area width —
// the display is re-read from win's *current* position every time, so this
// stays correct if the overlay lives on/moves to a smaller or larger monitor.
// `heightPx` is optional so this can be re-run (e.g. from 'moved') using
// whatever height was last requested, without the renderer resending it.
function applyDesiredSize(heightPx) {
  if (!win || win.isDestroyed()) return;
  if (Number.isFinite(heightPx)) lastDesiredHeightPx = heightPx;
  if (!Number.isFinite(lastDesiredHeightPx)) return;

  const bounds = win.getBounds();
  const displayWorkArea = screen.getDisplayMatching(bounds).workArea;
  const newWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(displayWorkArea.width / 3));
  // Deliberately NOT win.getMinimumSize() — on Windows, toggling resizable false
  // pins the effective minimum (and maximum) size to whatever the window's size
  // happened to be at that moment, and toggling resizable back to true does not
  // undo that pin. Using our own constant instead of the (silently mutated) OS
  // value is what makes shrinking reliable across repeated grow/shrink cycles.
  const newHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(lastDesiredHeightPx));
  if (newWidth === bounds.width && newHeight === bounds.height) return;
  // setBounds() on a resizable:false window grows it fine but silently refuses to
  // shrink it (see above) — toggling resizable on for just this one call sidesteps
  // that; the window is still effectively locked since we're the only thing that
  // ever resizes it. The min/max reset undoes this same call's own pinning before
  // the next resize needs to shrink again.
  win.setResizable(true);
  win.setBounds(resizeKeepingTopLeftAnchored(bounds, newWidth, newHeight));
  setImmediate(() => {
    if (!win || win.isDestroyed()) return;
    win.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
    win.setMaximumSize(0, 0);
    win.setResizable(false);
  });
}

ipcMain.on('set-desired-height', (_e, heightPx) => applyDesiredSize(heightPx));

ipcMain.on('set-lyrics-color', (_e, hex) => {
  logger.log('set-lyrics-color received:', hex);
  if (typeof hex === 'string') store.set('lyricsColor', hex);
});

ipcMain.on('set-picker-open', (_e, open) => {
  colorPickerOpen = !!open;
});

ipcMain.on('login-reopen-browser', () => {
  if (lastVerificationUrl) shell.openExternal(lastVerificationUrl);
});

ipcMain.on('position-picker-choose', (_e, anchor) => {
  if (win && !win.isDestroyed()) {
    // Keeps the overlay's current size — this repositions it, not resizes
    // it. win.setBounds() below fires 'move'/'resize', which saveBounds()
    // already listens for, so this is remembered per-app exactly like a
    // manual drag would be.
    const current = win.getBounds();
    const bounds = computeAnchoredBounds(anchor, screen.getPrimaryDisplay().workArea, {
      width: current.width,
      height: current.height,
    });
    win.setBounds(bounds);
    win.moveTop();
  }
  if (positionPickerWin && !positionPickerWin.isDestroyed()) positionPickerWin.close();
});

ipcMain.handle('gemini-key-status', () => ({ configured: !!geminiKeyStore.loadGeminiKey() }));

ipcMain.handle('gemini-key-save', (_e, key) => {
  geminiKeyStore.saveGeminiKey(key);
});

ipcMain.handle('gemini-key-clear', () => {
  geminiKeyStore.clearGeminiKey();
});

ipcMain.on('gemini-key-open-page', () => {
  shell.openExternal('https://aistudio.google.com/apikey');
});

ipcMain.on('gemini-key-close', () => {
  if (geminiKeyWin && !geminiKeyWin.isDestroyed()) geminiKeyWin.close();
});

ipcMain.on('login-close', () => {
  loginWin?.close();
});

ipcMain.handle('get-shortcuts', () => ({
  defs: SHORTCUT_DEFS.map(({ id, label, defaultAccelerator }) => ({ id, label, defaultAccelerator })),
  current: store.get('shortcuts'),
}));

ipcMain.handle('set-shortcut', (_e, { id, accelerator } = {}) => {
  if (!SHORTCUT_HANDLERS[id]) return { ok: false, error: 'Unknown shortcut.' };
  if (typeof accelerator !== 'string' || !accelerator) {
    return { ok: false, error: 'No key combination received.' };
  }

  const current = store.get('shortcuts');
  const conflictId = Object.keys(current).find((k) => k !== id && current[k] === accelerator);
  if (conflictId) {
    const conflictLabel = SHORTCUT_DEFS.find((s) => s.id === conflictId)?.label || conflictId;
    return { ok: false, error: `Already used by "${conflictLabel}".` };
  }

  // Some combinations are reserved by Windows/other apps and simply refuse to
  // register — test-register (then immediately release) to confirm this one
  // actually works before committing it as this action's shortcut.
  const testOk = globalShortcut.register(accelerator, () => {});
  if (!testOk) {
    return { ok: false, error: 'That key combination is not available (it may be reserved by Windows or another app).' };
  }
  globalShortcut.unregister(accelerator);

  store.set('shortcuts', { ...current, [id]: accelerator });
  registerShortcuts();
  updateTrayMenu();
  return { ok: true, accelerator };
});

ipcMain.handle('reset-shortcuts', () => {
  store.set('shortcuts', { ...DEFAULT_SHORTCUTS });
  registerShortcuts();
  updateTrayMenu();
  return store.get('shortcuts');
});

ipcMain.on('shortcuts-close', () => {
  shortcutsWin?.close();
});

// Punches a temporary hole in the click-through overlay while unlocked and the
// cursor is over the track-label drag handle (see renderer.js's mouseenter/leave
// listeners) — ignored while locked, which is always fully click-through.
ipcMain.on('set-interactive', (_e, interactive) => {
  if (!win || win.isDestroyed() || store.get('locked')) return;
  if (interactive) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

// Windows groups/brands toast notifications and taskbar entries by this ID —
// without it, packaged-app notifications can show up under a generic
// "Electron" identity instead of the app's own name/icon.
app.setAppUserModelId('com.arzatar.lyricslay');

app.whenReady().then(() => {
  logger.init(app.getPath('userData'));
  logger.log('app ready, log file at', logger.getLogFilePath());
  ytmAuth = ytmAuthModule.loadAuth();
  lyricsCache = new LyricsCache(path.join(app.getPath('userData'), 'lyrics-cache'));
  createWindow();
  createTray();
  registerShortcuts();
  startWatcher();

  updater.init();
  // Delayed so the update check never competes with startup (window creation,
  // now-playing watcher, etc.) for network/CPU in the first moment after launch.
  setTimeout(() => updater.checkForUpdates(), 10_000);
  // Long-running tray app: also re-check periodically for anyone who never quits.
  setInterval(() => updater.checkForUpdates(), 4 * 60 * 60 * 1000);
});

process.on('uncaughtException', (err) => logger.log('uncaughtException:', err.stack || String(err)));
process.on('unhandledRejection', (reason) => logger.log('unhandledRejection:', reason?.stack || String(reason)));

app.on('window-all-closed', (e) => {
  e.preventDefault(); // tray app: never quit just because the window closed
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  watcher?.stop();
  foregroundAppWatcher?.stop();
});

// Single instance: focus/show the existing overlay instead of spawning a second copy.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.moveTop();
    }
  });
}
