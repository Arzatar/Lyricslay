# Lyricslay

A Windows tray app that shows real-time, synced song lyrics in a transparent,
always-on-top overlay — so you can read them while gaming or doing anything
else, without switching windows.

It watches whatever is currently playing on YouTube Music (browser tab,
desktop app, or PWA) via Windows' native media session, looks up synced
lyrics, and highlights the current line as the song plays.

## Features

- Runs as a system tray app — no taskbar window.
- Detects the current track via Windows' `GlobalSystemMediaTransportControlsSessionManager`
  (the same session used by the volume flyout / hardware media keys), so it
  works with YT Music in any Chromium/Firefox browser tab, the desktop app,
  or the PWA — no browser extension required.
- Cleans up messy title/artist metadata before searching for lyrics — needed
  for anything only available as third-party YouTube re-uploads (common for
  niche/harder-to-keep-online artists), where the "artist" field is often
  just the uploader's channel name and the title is padded with junk like
  "(letra)"/"(official video)". See `trackMetadata.js`.
- Timed lyrics first, always — tries every synced source before ever
  settling for unsynced text:
  1. **YouTube Music (authenticated)** — if you're logged in (see below),
     fetches the same line-synced lyrics your Premium account sees in the app.
  2. **[LRCLIB](https://lrclib.net)** — a free, keyless, community-run synced
     lyrics database. Used whenever you're not logged in, or YT Music has no
     synced lyrics for a track.
  3. **YouTube Music (unauthenticated)** — one more attempt at synced lyrics
     without requiring login.
  4. **AI transcription (optional, your own free key)** — if none of the
     above found synced lyrics and you've set up a free Google Gemini API
     key (tray menu → *Settings* → *Set up AI lyrics fallback…*), Gemini
     watches the song's YouTube video directly and transcribes it with
     per-line timestamps. Nothing is shared between installs — see
     [ARCHITECTURE.md](ARCHITECTURE.md#ai-lyrics-fallback-bring-your-own-key)
     for why this needs your own key.
  5. **[lyrics.ovh](https://lyrics.ovh)** — free, keyless, plain-text API,
     tried only once nothing above produced synced lyrics.
  6. **Genius (scraped)** — last resort: searches Genius's public search
     endpoint and scrapes the lyrics text off the matched song page. More
     fragile than the API-based sources (breaks if Genius changes their page
     markup) and only ever used when nothing else has anything.
  Whichever source ends up unsynced (any of 1–3 falling back, or 5–6) is
  shown with proportional auto-scroll instead of real line-by-line
  highlighting.
- Lyrics are cached to disk by song (title + artist, not YouTube video ID —
  see *Lyrics cache* below), so replaying a song never re-hits the network.
- Draggable, adjustable font size/opacity/color, and sized to fit exactly as
  many lines of lyrics as you want (1/3/5) — not manually resizable, since
  the window's size is entirely driven by that setting instead.
- A "locked" click-through mode so the overlay never intercepts game input.
- Global hotkeys that work regardless of which window has focus, fully
  rebindable from the tray's *Keyboard Shortcuts…* window.
- Optional launch at Windows startup, toggled from the tray menu.
- **Romaji for Japanese lyrics** — tray menu → *Settings* → *Show romaji for
  Japanese lyrics* converts whatever lyrics were found into romaji via
  Gemini, so you can follow along and sing without reading hiragana/
  katakana/kanji. Detection is automatic and free (no AI call for songs that
  aren't Japanese); conversion happens once per song and is cached, same as
  the lyrics themselves. Uses the same API key as *AI lyrics fallback* below.

## Requirements

- Windows 10/11 (uses a Windows-only media session API).
- [Node.js](https://nodejs.org) 18+ (project was built and tested on 24).

## Getting started

```
npm install
npm start
```

Or just double-click `Start Lyricslay.vbs` — it launches the app
without popping up a console window.

## Usage

The app starts unlocked and draggable, sitting top-center by default.

| Action | Default hotkey |
| --- | --- |
| Move the overlay | Drag the title/artist label top-left, while unlocked |
| Lock it (click-through, for gaming) | `Ctrl+Alt+L`, or tray menu → *Lock (click-through)* |
| Show / hide | `Ctrl+Alt+H`, or tray menu → *Show/Hide overlay* |
| Font size | `Ctrl+Alt+↑` / `Ctrl+Alt+↓` |
| Opacity | `Ctrl+Alt+PageUp` / `Ctrl+Alt+PageDown` |
| Visible lines | `Ctrl+Alt+→` / `Ctrl+Alt+←` |
| Sync offset (this song only) | `Ctrl+Alt+,` (earlier) / `Ctrl+Alt+.` (later) |
| Lyrics color, reset position, login, quit | Left- or right-click the tray icon |

Every hotkey above is also in the tray menu, with the current shortcut shown
next to it — and all of them are just defaults: tray menu → *Keyboard
Shortcuts…* opens a window listing every action, where clicking *Change* next
to one and pressing a new key combination rebinds it (a combination already
reserved by Windows, or already used by another action here, is rejected with
an explanation instead of silently failing). *Reset to defaults* restores the
table above.

The window has no background panel and is click-through everywhere except the
title/artist label top-left (which is also the drag handle) — so it floats over
whatever's behind it and never blocks clicks to the app underneath, even while
unlocked. "Locked" mode (`Ctrl+Alt+L`) makes it click-through *everywhere*,
including that label, for when you want zero chance of it intercepting input.

**Per-app position:** wherever you drag the overlay to is remembered
separately for whatever app was in the foreground at the time — top-center
for one game, off to the side for another, bottom-left while coding, etc.
There's no explicit "save" step: dragging it while a given app is behind it
*is* the save action, and switching back to that app later restores that
exact spot automatically. An app you've never positioned it for just leaves
the overlay wherever it already was until you drag it once. See
`foregroundApp.ps1`/`foregroundApp.js`.

Dragged it somewhere unreachable (off-screen, behind something) for a
specific app? Tray menu → *Reset position* lists every app with a remembered
position — the current one first, then every other one below — and clicking
one clears just that app's saved spot (snapping the overlay back to
top-center immediately if that's the app currently behind it).

**Snapping to a spot:** tray menu → *Move to…* opens a small 3x3 grid —
top-left through bottom-right — that mirrors the screen's own layout; click
a cell and the overlay jumps straight there at whatever size it already is.
Counts as a drag for per-app position purposes (see above), so whichever app
is currently behind the overlay remembers that spot the same as if you'd
dragged it there by hand.

**Visible lines:** tray menu → *Settings* → *More/Fewer visible lines* cycles
the window between showing 1, 3, or 5 lines of lyrics (default 3) — it
resizes the window itself to fit exactly that many lines, growing/shrinking
downward so it stays anchored to wherever its top-left corner currently is.

**Lyrics color:** tray menu → *Show color dot*, then click the small ● dot
that appears next to the title to open the native Windows color picker.
(The picker only opens on a genuine user click — Chromium silently ignores one
triggered from the tray menu itself, which is why this is a two-step process
instead of a single menu item.) It only recolors the lyrics text — the
title/artist label stays its own subtle gray so it never gets lost against a
bright pick.

**Sync offset:** if a song's lyrics are a beat early or late, nudge them with
`Ctrl+Alt+,` (earlier) / `Ctrl+Alt+.` (later), or the equivalent tray menu →
*Settings* items — each press moves by 100ms. The offset is saved per-song
(in that song's [lyrics cache](#lyrics-cache) entry), so it's remembered next
time that song plays. Tray menu → *Reset sync* zeroes it again.

**Wrong or broken lyrics:** tray menu → *Re-search lyrics for this song* is a
submenu with four options, all of which clear that song's
[cached](#lyrics-cache) entry and immediately re-run the lookup — useful when
a source matched the wrong song, or returned something garbled/truncated,
since the cache never expires on its own and a plain replay would just hit
that same bad entry again:
- **Automatic (all sources)** — the normal full chain (see *Features* above),
  unchanged.
- **YouTube Music** — YT Music only (authenticated, then unauthenticated),
  skipping LRCLIB, then falling through to the AI fallback and the
  plain-text sources same as automatic.
- **LRCLIB (free API)** — LRCLIB only, skipping YouTube, same fallthrough
  after.
- **Gemini AI only** — just the AI transcription, nothing before or after it
  (no static fallback either) — grayed out if no key is configured. Since
  it's already the last real attempt in the automatic chain, picking it
  explicitly means "just the AI, or nothing."

**Start with Windows:** tray menu → *Enable start with Windows* launches the
app automatically at login; the same item switches to *Disable* once it's on.

**AI lyrics fallback:** tray menu → *Settings* → *Set up AI lyrics
fallback…* opens a small window to paste a free Google Gemini API key (with
a link to get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)),
or clear a saved one. This only ever runs as the last attempt at *synced*
lyrics, after YouTube Music and LRCLIB have both failed to find any — see
*Features* above and [ARCHITECTURE.md](ARCHITECTURE.md#ai-lyrics-fallback-bring-your-own-key)
for how it works and why it needs your own key rather than a shared one.
Leaving it unconfigured is fully supported: the app just skips straight to
the plain-text fallbacks (lyrics.ovh, Genius) instead.

**Romaji for Japanese lyrics:** tray menu → *Settings* → *Show romaji for
Japanese lyrics* toggles converting Japanese lyrics (from any source, not
just the AI fallback above) into romaji. Needs the same Gemini key as *AI
lyrics fallback* — if none is configured, the toggle does nothing. Detecting
whether a song is actually Japanese is free/instant (no AI call for
non-Japanese songs); conversion runs once per song in the background and is
cached alongside the lyrics themselves, so turning the toggle off and back
on later doesn't re-convert. See [ARCHITECTURE.md](ARCHITECTURE.md#romaji-for-japanese-lyrics-geminiromajijs-langdetectjs).

**Signing in:** tray menu → *Sign in with YouTube Music (Premium)*
starts Google's OAuth device sign-in flow: it opens **your actual default
browser** (full autofill/saved passwords/passkeys, unlike an embedded login
window) to a short Google page, and shows a code in a small app window for
you to confirm. The app never sees your password — only a scoped OAuth
token, the same technique the open-source `ytmusicapi` project documents as
its "oauth" auth method. The token is encrypted at rest via Electron's
`safeStorage` (Windows DPAPI) and refreshed automatically as it expires.

## Lyrics cache

Every lyrics lookup is saved to `%APPDATA%\lyricslay\lyrics-cache\`, one
JSON file per song, named `<title> - <artist>.json` (normalized: lowercase,
accents/punctuation stripped) so you can find and delete a specific song by
hand. Matching is by title + artist, not YouTube video ID — a re-upload or a
different rip of the same song reuses the same cached lyrics instead of
triggering a fresh lookup.

The cache **never expires automatically**, including "no lyrics found"
results — if you want to force a re-check for a specific song (e.g. it's now
on LRCLIB, or you just signed in and want the real synced version), delete
that song's file. Signing in is the one exception: it automatically busts the
cache entry for whatever's currently playing, so you don't have to hunt down
the file yourself just to get the authenticated result once.

Each entry also stores `cachedAtMs` and `offsetMs` — the latter is the
per-song sync offset described above (see *Sync offset*), which is why
resetting/adjusting sync doesn't need a fresh lyrics lookup, and why deleting
a song's cache file also clears any offset you'd set for it.

## Diagnosing "why did this song's lyrics come out wrong"

Every attempt in the fallback chain (see *Features* above) gets logged as it
happens — which source hit, which missed, and why — ending in a line naming
which one actually won, e.g. `[lyrics] result: source=lrclib-synced (timed)`.
Useful when the same song looks different for two people (different source,
or one hit synced and the other only got a static match) and there's no
other way to tell which network call behaved differently for each of you.
Tray menu → *Settings* → *Open log file* opens
`%APPDATA%\lyricslay\overlay.log`'s containing folder directly — handy for
sending it to whoever else is comparing notes on the same song.

## Known limitations

- **True exclusive fullscreen** (DirectX exclusive mode, not borderless/windowed)
  can still cover the overlay — no window flag can force a window above a
  fullscreen-exclusive swap chain. Borderless/windowed-fullscreen games are fine.
- Track detection depends on whichever app Windows currently considers the
  "active" media session. If you have another app also publishing a media
  session (e.g. a video call, another music app), it may take priority over
  YT Music until YT Music is interacted with again.
- All lyrics sources are third-party/community (or scraped), plus an
  optional AI transcription step; coverage and accuracy for obscure or
  regional tracks varies. The Genius fallback in particular scrapes page
  HTML with no formal API contract, so it can break entirely if Genius
  changes their markup — it's still just a fallback, though, so a break
  there only matters for songs nothing else has.
- The AI lyrics fallback requires your own free Google Gemini API key (see
  *AI lyrics fallback* above) — without one, that step is skipped and the
  app relies on the other sources only.

## Project structure

```
src/
  main.js              Electron main process: window, tray, hotkeys, orchestration
  preload.js            Context-isolated IPC bridge exposed to the renderer
  nowplaying.ps1         PowerShell script streaming SMTC now-playing info as JSON
  nowplaying.js          Node wrapper: spawns nowplaying.ps1, restarts it if it dies
  foregroundApp.ps1      PowerShell script streaming the foreground window's
                          owning process name as JSON, for per-app overlay position
  foregroundApp.js       Node wrapper: spawns foregroundApp.ps1, restarts it if it dies
  trackMetadata.js        Cleans up third-party-reupload title/artist junk (channel
                          name as "artist", "(letra)"/"(official video)" suffixes,
                          "Artist: Song"-style titles) before it's used for search/cache
  ytmusic.js             Minimal InnerTube client: search + lyrics (used by both
                          anonymous and authenticated requests)
  lrclib.js              LRCLIB client: fetch + parse synced/plain lyrics
  geminiClient.js         Shared Gemini plumbing: the model-fallback list and
                          "try each until one works" request loop, used by
                          both geminiLyrics.js and geminiRomaji.js
  geminiLyrics.js         Last-resort AI transcription: hands Gemini a YouTube
                          URL directly and asks for per-line timed lyrics
  geminiRomaji.js         Converts Japanese lyrics to romaji via Gemini (text
                          only, no video ingestion) for the romaji toggle
  langDetect.js           Free, offline Japanese-script detection (hiragana/
                          katakana) that gates the romaji feature
  geminiKeyStore.js       Encrypted on-disk storage for the user's own Gemini
                          API key (same safeStorage pattern as auth.js)
  gemini-key-preload.js   IPC bridge for the "AI lyrics fallback" settings window
  renderer/geminiKey.html, The AI lyrics fallback settings window's UI: paste/
    geminiKey.css,          clear a Gemini API key, link to get a free one
    geminiKey.js
  lyricsOvh.js            lyrics.ovh client: free, keyless, plain-text-only
  genius.js               Last-resort fallback: Genius search + lyrics-page scraping
  lyricsCache.js          Per-song, on-disk lyrics cache (title+artist keyed, no
                          expiry) — also stores each song's manual sync offset
  auth.js                Google OAuth device-flow login + encrypted token storage
  updater.js              Thin wrapper around electron-updater: tracks update status
                          (checking/downloading/downloaded/error) and notifies main.js
                          for the tray's "Check for updates" item — see *Releasing an
                          update* below
  logger.js               Persistent file logger (%APPDATA%\lyricslay\overlay.log)
                          — the app has no console window, so this is how errors
                          and diagnostics are ever visible after the fact
  login-preload.js        IPC bridge for the small login-status window
  renderer/login.html,    The login-status window's UI (shows the device code;
    login.css, login.js   never renders Google's own login page)
  shortcuts-preload.js    IPC bridge for the keyboard-shortcuts window
  renderer/shortcuts.html, The rebindable-hotkeys window's UI: lists every
    shortcuts.css,          action, lets you press a new key combination for
    shortcuts.js            one, and reset all of them back to defaults
  position-picker-preload.js IPC bridge for the "Move to…" position picker
  renderer/positionPicker.html, The 3x3 anchor-grid popover's UI — click a
    positionPicker.css,       cell, overlay snaps there (see anchoredBounds
    positionPicker.js         in utils.js)
  textMatch.js           Shared fuzzy title/artist matching (used by ytmusic.js,
                          lrclib.js, and genius.js to pick the best search result)
  utils.js                Small pure helpers (track identity key, window placement,
                          settings-cycling, top-left-anchored resize math)
  renderer/
    index.html, style.css, renderer.js   The overlay's UI
    lyricsSync.js          Pure playback-position → active-line logic, shared
                            between the renderer and its unit tests
    colorUtils.js           hex → "r, g, b" conversion for the lyrics-color CSS
                            variable, same dual-load pattern as lyricsSync.js
    shortcutUtils.js        keydown event → Electron accelerator string, same
                            dual-load pattern, used by the shortcuts window
test/                     Unit tests (Node's built-in test runner)
assets/                   Tray/app icons (+ the script that generated them)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how data flows between these pieces.

## Testing

```
npm test
```

Runs the unit test suite (Node's built-in `node:test` runner, no extra
dependencies). Tests cover the pure logic — LRC parsing, title/artist
matching, active-line/scroll calculation, YT Music/lyrics.ovh/Genius/Gemini
response parsing (including the seconds-vs-milliseconds timestamp
correction), Japanese-script detection, the lyrics cache (including
sync-offset adjustment), and keydown → accelerator conversion for the
shortcuts recorder — using hand-built fixtures rather than live network
calls, so they run offline and deterministically.

Electron's main-process wiring (window/tray/IPC) and the PowerShell now-playing
bridge are not unit tested; they're thin glue verified by manually running the
app (see the *Getting started* section).

## Building an installer

```
npm run dist
```

Uses `electron-builder` to produce a Windows NSIS installer (see the `build`
section of `package.json`).

**Installing over a running copy:** the app is a tray app — closing its
window just hides it instead of quitting, so it never releases its own file
locks on a graceful close request. `electron-builder`'s built-in "wait for
the app to close" retry can run out before that happens, especially since
the app runs as several processes (main, renderer, GPU, utility). Without a
fix, that surfaces mid-install as "Lyricslay cannot be closed. Please
close it manually." `build/installer.nsh` (wired in via `nsis.include`) adds
a `customInit` hook that forcefully closes any running instance before
extraction starts, reusing the same `FIND_PROCESS`/`taskkill` pattern
`electron-builder` already uses internally for the analogous "another
installer instance is already running" case.

**Known issue on Windows without Developer Mode:** `electron-builder` always
downloads `winCodeSign` (macOS code-signing binaries it bundles regardless of
target platform) and extracts it with real symlinks. Creating those requires
`SeCreateSymbolicLinkPrivilege`, which a non-admin Windows account only has
if **Settings → Privacy & Security → For Developers → Developer Mode** is
on — without it, the build fails with `Cannot create symbolic link: A
required privilege is not held by the client`, and retries endlessly with
the same error. Turning Developer Mode on is the clean fix. Patching
`node_modules` to point the download at a pre-fixed archive also works but
modifies a dependency's internals — treat that as a last resort, not the
default move.

**Without an installer**, a portable copy works fine for sharing with someone
else: copy the project folder (including `node_modules`, so Electron itself
is bundled — no Node.js required on their machine), zip it, and have them run
`Start Lyricslay.vbs`. Windows SmartScreen will warn on first run since
the exe isn't code-signed ("More info" → "Run anyway" gets past it) — expected
for an unsigned personal app, not a sign of anything wrong.

## Releasing an update (auto-update)

Installed copies check GitHub Releases for updates (`electron-updater`), both
automatically (10s after launch, then every 4h) and on demand from the tray
menu's *Check for updates…* item, which becomes *Downloading update…* and
then *Restart to install update (vX.Y.Z)* once one's ready — that's the whole
UI, no separate updater window. A Windows notification also pops up the
moment an update starts downloading and again once it's ready to install
(clicking that second one restarts and installs it directly), so you don't
have to think to reopen the tray and check.

To ship a new version:

1. Bump `"version"` in `package.json` (semver, no `v` prefix there).
2. Commit that, then tag and push:
   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. The `.github/workflows/release.yml` workflow builds the installer on a
   Windows GitHub Actions runner and publishes it as a GitHub Release
   (installer `.exe`, `.exe.blockmap`, and `latest.yml` — `electron-updater`
   reads the last of those to decide if a newer version exists). Nothing to
   configure: it uses the repo's built-in `GITHUB_TOKEN`.
4. Once the release finishes (check the *Actions* tab), every installed copy
   picks it up on its next check.

The release only builds off a pushed tag — pushing to `main` alone does not
publish anything.

**Publishing manually** (e.g. to test the flow without CI) works too, from a
Windows machine with a GitHub [personal access token](https://github.com/settings/tokens)
that has `repo` scope:
```
$env:GH_TOKEN = "<token>"
npm run dist:publish
```

**No code signing (yet):** installers are unsigned, so SmartScreen shows the
same "unknown publisher" warning on install as the portable copy does.
Auto-update itself isn't affected — it doesn't depend on the installer being
signed. Lyricslay has applied for free code signing via the SignPath
Foundation open source program — see [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)
for status and details, and [PRIVACY.md](PRIVACY.md) for what data (if any)
leaves your machine.
