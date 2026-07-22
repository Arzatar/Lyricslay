# Architecture

## Data flow

```
Windows SMTC  --(poll every 800ms, JSON lines over stdout)-->  nowplaying.ps1
                                                                     |
                                                              nowplaying.js
                                                          (spawns/restarts the
                                                           PowerShell process)
                                                                     |
                                                              main.js (Electron
                                                              main process)
                                                                     |
                                                        trackMetadata.js cleans
                                                        title/artist (see below)
                                                                     |
                                    title/artist changed? --> lyricsCache.js lookup
                                                              (title+artist keyed) --\
                                                                     |               |
                                                              cache miss       cache hit
                                                                     |               |
                                       1. ytmusic.js     (timed, authenticated)      |
                                       2. lrclib.js      (timed, keyless)            |
                                       3. ytmusic.js     (timed, unauthenticated)    |
                                       4. geminiLyrics.js (timed, AI, needs own key) |
                                       -- static-only fallback, if nothing above is timed --
                                       5. lyricsOvh.js   (plain text, keyless)       |
                                       6. genius.js      (plain text, scraped)       |
                                                                     |               |
                                                          lyricsCache.js.set()       |
                                                                     |               |
                                                                     \---------------/
                                                                     |
                                                        IPC ('now-playing',
                                                       'lyrics-result', ...)
                                                                     |
                                                              preload.js
                                                          (context-isolated
                                                              bridge)
                                                                     |
                                                              renderer.js
                                                        (draws the overlay,
                                                       highlights the active
                                                            line live)
```

## Why a PowerShell bridge for now-playing detection

Windows exposes "what's currently playing" (title, artist, position, play/pause
state) via `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`,
a WinRT API. It's the same source that powers the volume flyout's mini-player and
hardware media keys, and — crucially — browsers populate it automatically via the
Web `MediaSession` API whenever a page plays audio, including YouTube Music. That
means detection works with zero YouTube Music-specific integration: no browser
extension, no scraping a specific tab.

WinRT APIs aren't directly reachable from Node.js without a native addon, which
would need a compiled toolchain on the user's machine. `nowplaying.ps1` sidesteps
that by using PowerShell's own (built-in, no-install) WinRT projection, and
`nowplaying.js` just spawns it once, keeps it alive across restarts, and parses
its `stdout` (one JSON object per line, emitted every ~800ms).

## Per-app remembered position (`foregroundApp.js`)

The overlay remembers a separate position/size per foreground app (top-center
for one game, off to the side for another, bottom-left while coding) with no
explicit "save" step — dragging it while a given app is behind it is the save
action, and switching back to that app later restores that exact spot. Two
pieces make that work, both in `main.js`:

- **Detecting which app is behind it.** `foregroundApp.ps1` polls Win32's
  `GetForegroundWindow` + `GetWindowThreadProcessId` every ~1s and streams the
  owning process's name as JSON (same "PowerShell bridge, one JSON line per
  tick" shape as `nowplaying.ps1`, for the same reason — no native addon
  needed). `foregroundApp.js` dedupes consecutive identical ticks and only
  emits `'change'` when the name actually differs.
- **Not tracking ourselves.** Clicking/dragging the overlay itself briefly
  makes *it* the OS foreground window, which would otherwise overwrite
  "the app to save this position for" with our own process name mid-drag.
  `main.js` compares every reported name against `OWN_PROCESS_NAME`
  (`path.basename(process.execPath, '.exe')` — "Lyricslay" packaged,
  "electron" in dev) and ignores it, keeping `currentForegroundApp` as
  whatever real app was last seen instead.

`perAppBounds` (in the electron-store config, alongside the flat `bounds`
fallback used for apps with no entry yet) is read/rewritten as a whole object
with bracket access (`perApp[processName]`) rather than electron-store's
`set('perAppBounds.x', …)` dot-path shorthand — several real process names
contain a literal `.` (`Warframe.x64`), which dot-path would otherwise split
into a nested key instead of one flat entry.

## Cleaning up third-party re-upload metadata (`trackMetadata.js`)

SMTC reports whatever the page's `MediaSession` metadata says, which for a
YouTube video is only as good as whoever uploaded it. For mainstream music on
an official channel that's usually fine. It falls apart for anything only
available as third-party re-uploads — the exact situation for artists whose
content keeps getting taken down (the case that motivated this: a Chilean
band, "Los Mox", whose explicit lyrics make official uploads short-lived) —
where two things routinely go wrong:

- The **artist** field is frequently just the uploader's YouTube channel name
  (e.g. `neohex`, `sebastian rojas`), not the actual artist.
- The **title** repeats the real artist name followed by junk annotations —
  `"Los Mox: Curao manejo mejor! (letra)"` rather than just `"Curao manejo
  mejor!"`.

Searching lyrics sources with that verbatim pair fails across the board —
verified directly: all five sources returned nothing for that exact title/artist
combination before this existed. `cleanTrackMetadata(title, artist)` runs once,
at the top of `handleTrackTick` in `main.js`, before the value is used for
*anything* — the display label, the `lyricsCache.js` key, and every lyrics
source's search query all flow from the same cleaned value, so a fix here
doesn't need to be threaded through five call sites individually. It:

1. Strips trailing `(...)`/`[...]` groups whose entire inner text matches a
   known junk annotation (`letra`, `lyrics`, `official video`, `video
   oficial`, `en vivo`, `live`, `hd`, ...) — matched as a whole, not a
   substring, so a song genuinely titled with something like `"(Live Aid)"`
   or `"(System of a Down song)"` is left alone.
2. Checks whether what's left starts with `"Artist: Song"` or
   `"Artist - Song"` (the near-universal YouTube upload convention) and, if
   so, treats the prefix as the real artist — overriding the SMTC-reported
   one, since that's the one actually wrong here.

For an already-clean title/artist pair (the common case — official YT Music
playback, mainstream official uploads), neither step matches anything, so
this is a no-op; it only changes behavior for the messy-metadata case it was
built for.

## Why the lyrics chain is timed-first, with AI as a last resort

The chain optimizes for one thing above all: never settle for static
(proportional-scroll) lyrics while there's still a chance at real per-line
sync. It tries sources in this order, and — critically — a source returning
*non-timed* lyrics no longer stops the search; it's remembered as
`staticFallback` (first one found wins) and the chain keeps going, since a
later source might still produce a timed result. Only once every timed
attempt has failed does the search settle for that remembered static result.

1. **YT Music's own timed-lyrics renderer, authenticated** — only responds to
   authenticated requests (YouTube Music's web client won't return it to an
   anonymous session). When the user has signed in (see `auth.js`), this is
   tried first, since it's literally what their Premium account would show.
   If it has no timed lyrics but does have plain text, that text is kept as
   `staticFallback` and the chain continues.
2. **LRCLIB** — free, keyless, synced (LRC) lyrics for a large slice of
   mainstream and non-mainstream music, but it's a community database, so
   coverage isn't universal. Same deal: an untimed ("plain") LRCLIB match is
   kept as a fallback candidate, not treated as a final answer.
3. **YT Music again, unauthenticated** — one more attempt at *timed* lyrics
   (Musixmatch-sourced, via the unauthenticated `next`/`browse` InnerTube
   endpoints) in case authentication wasn't the blocker. Its static text is
   likewise only kept as a fallback candidate if none is saved yet.
4. *(Not implemented)* A fourth free timed-lyrics source was investigated —
   NetEase Cloud Music's API — but its lyrics endpoints now require
   request-level AES+RSA encryption rather than a plain keyless GET, so it
   was skipped rather than reverse-engineering that scheme for a single
   extra source.
5. **Gemini AI transcription** — the true last resort before giving up on
   timing entirely. If nothing above produced a timed result, and the user
   has configured their own free Gemini API key (see below), `geminiLyrics.js`
   hands Gemini the song's YouTube video URL directly via its native
   video-ingestion input (`fileData.fileUri` — the same mechanism Gemini uses
   to answer questions about a YouTube video's content) and asks it to
   transcribe the song with a `{timeMs, text}` per line, matching the shape
   every other timed source already produces. No audio capture or download
   happens on our end — Gemini fetches and watches the video itself.
6. **Static-only fallback** — reached only if every timed attempt above
   failed *and* no `staticFallback` was captured along the way (i.e. no
   Gemini key configured, or Gemini also failed/found nothing). At this
   point, and only this point, two more plain-text sources are tried purely
   to have *something* to show:
   - **lyrics.ovh**, a free, keyless, plain-text API — a real API call
     before resorting to scraping.
   - **Genius (scraped)**, last: searches Genius's public search endpoint
     (no API key — the same one that backs the search box on genius.com),
     then scrapes the lyrics text out of the matched page's HTML. Kept last
     on purpose — scraping page markup has no versioning guarantee and
     breaks the moment Genius changes their page structure, unlike every
     other source's actual API.

Whichever plain-text result ends up used (from steps 1–3 or the two
dedicated static sources in step 6) is shown with proportional auto-scroll
standing in for real per-line sync.

### AI lyrics fallback: bring your own key

Step 5 requires the user's own Google AI Studio API key — set up via tray
menu → *Settings* → *Set up AI lyrics fallback…*, which opens a small window
(`geminiKey.html`/`.js`) to paste a key, get a link to
`aistudio.google.com/apikey` to create one for free, or clear an existing
one. The key is stored the same way YouTube Music login credentials are
(`geminiKeyStore.js`, mirroring `auth.js`'s `safeStorage`-encrypted file —
Windows DPAPI at rest, never plaintext, never in git), and read back via
`getGeminiApiKey()` in `main.js` (env var `GEMINI_API_KEY` for local
development, falling back to the stored key).

This has to be BYOK rather than a key embedded in the app:

- **Shared quota exhausts almost immediately.** Google AI Studio's free tier
  is genuinely free (no card required — the actual friction is that it
  requires creating a Google Cloud *project* first, not billing), but per-key
  daily quotas are small (see below) and vary by model. Shared across every
  install, that's gone in minutes.
- **A key embedded in a distributed app isn't secret.** Anyone can extract
  it from the packaged binary, at which point it's not "the app's key"
  anymore, it's a public one.
- **Google's ToS doesn't allow redistributing a personal key** this way
  regardless.

If no key is configured, step 5 is skipped entirely (logged as
`[lyrics] gemini: no videoId to give it, skipping` never even fires — the
`if (!lyrics && geminiApiKey)` guard short-circuits first) and the chain
falls straight through to the static-only fallback in step 6 — meaning
lyrics.ovh and Genius (scraped), alongside whatever YT Music/LRCLIB static
text steps 1–3 already captured, remain the complete fallback chain for
every user who hasn't set up a key. Nothing about the app's core behavior
depends on Gemini being configured.

### Why every Gemini call tries a *list* of models, not one (`geminiClient.js`)

Free-tier daily request quotas (RPD) turn out to vary enormously between
Gemini models on the exact same key/project — verified directly against a
real account's AI Studio rate-limit dashboard, not from Google's docs (which
don't publish per-model numbers at all, only "check your dashboard"): plain
Flash releases were capped at **20 requests/day**, while the newer "Lite"
releases (`gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`) were given
**500/day** on that *same* key — 25x more, for equivalent quality on this
task (confirmed directly, both for lyrics transcription and for romaji
conversion below).

Since there's no API to ask "how much quota do I have left" up front — a
live HTTP 429 (quota exceeded) or 404 (model retired, or not available to
this project) during an actual call is the only signal Google gives —
`MODELS` in `geminiClient.js` is a hand-ordered list, shared by every Gemini
feature (`geminiLyrics.js`'s transcription and `geminiRomaji.js`'s romaji
conversion), tried in sequence per call rather than pinning to one:

```
gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-flash-latest
```

`tryModels()` moves to the next candidate on any non-2xx response and only
throws once every model in the list has failed; an `onAttempt` callback lets
callers log each candidate tried (`[lyrics] gemini (gemini-3.5-flash-lite):
hit (103 lines)`), so which model actually served a given call — and why an
earlier one got skipped — is visible in `overlay.log` instead of being a
black box. This list is a curated guess at what's likely to work for a
typical free-tier account, not something recomputed at runtime, and needs
occasional retuning as Google reshuffles quotas or retires models entirely —
`gemini-2.5-flash` and `gemini-2.5-flash-lite` were both tried here at
different points and **both now 404** ("no longer available to new users"),
which is why the list above has no non-Lite, non-"latest" tier left: an
older "stable" named model isn't actually safer than a newer one, Google
just removes access outright rather than only tightening quota.
`gemini-flash-latest` stays last purely as a catch-all for brand-new
projects that don't yet have access to any of the named models above it —
and as a hedge against the two Lite models above it eventually meeting the
same fate.

### Romaji for Japanese lyrics (`geminiRomaji.js`, `langDetect.js`)

Tray menu → *Settings* → *Show romaji for Japanese lyrics* converts whatever
lyrics were found (from any source — LRCLIB, YT Music, Gemini transcription,
even the plain-text fallbacks) into romaji, so someone who can't read
hiragana/katakana/kanji can still follow along and sing. Three pieces:

- **Detection is local and free** — `langDetect.js`'s `lyricsAreJapanese()`
  just checks for hiragana/katakana code points (not kanji alone, which is
  ambiguous with Chinese) via regex. No network call, so every song's lyrics
  get checked for free, and the AI conversion step only ever runs for songs
  that are actually Japanese.
- **Conversion is AI, not a local dictionary, on purpose.** The obvious
  offline alternative — `kuroshiro` + `kuromoji`, a Japanese morphological
  analyzer — ships a ~40MB dictionary just for this one feature, and
  dictionary lookups routinely get kanji readings wrong for song lyrics
  specifically, where artists commonly use stylized/non-standard furigana
  for artistic effect that no fixed dictionary can know about. `geminiRomaji.js`
  reuses `geminiClient.js`'s model-fallback list — this call is pure text
  (no video ingestion), so it's far cheaper against the same daily quota
  than the transcription step.
- **Computed once, cached forever, shown by swapping at the IPC boundary.**
  `main.js`'s `computeRomaji()` converts whichever of `timed`/`static` the
  song actually has (an array of strings for timed lines — validated to come
  back the same length so each line's `timeMs` stays correctly paired with
  its romaji text, or the whole block for static text) and stores the result
  as a `.romaji` field alongside the original in the same lyrics-cache entry
  (`lyricsCache.js` needed no changes — `set()` already persists whatever
  extra fields are handed to it). `lyricsForDisplay()` then substitutes
  `timed`/`static` with the romaji versions only in what's sent over IPC when
  the setting is on — the cache file and `renderer.js` never need to know
  the feature exists, since the renderer already just displays whatever
  `timed`/`static` it's given. Turning the setting back off is instant
  (nothing to refetch, just stops substituting), and conversion only ever
  happens once per song even across toggling on/off multiple times.
- **Never blocks the initial lyrics display.** `maybeBackfillRomaji()` fires
  the conversion in the background (checked on every fresh lookup and every
  cache hit, but a no-op unless the setting's on, a key's configured, the
  song is actually Japanese, and it isn't already cached) and only resends
  `lyrics-result` once the conversion lands — lyrics always appear
  immediately in their original text first, same progressive-enhancement feel
  as the AI transcription fallback itself.

## Lyrics cache (`lyricsCache.js`)

Every lyrics lookup — successful or not — is written to
`<userData>/lyrics-cache/<title> - <artist>.json`. Two deliberate choices here,
both driven by how the app is actually used rather than general-purpose
caching defaults:

- **Keyed by normalized title+artist, not YouTube video ID.** The same song
  often exists as multiple YouTube uploads (official audio, a re-upload after
  a takedown, a lyric-video reupload, etc.) with different video IDs but the
  same lyrics. Keying by ID would mean re-fetching from scratch every time
  `ytmusic.searchSong` happens to match a different upload of a song we've
  already looked up.
- **No expiry, ever — including "not found" results.** A cache with a TTL
  would eventually re-hit the network on its own, which fights against the
  explicit, user-driven model this app uses instead: delete a song's cache
  file by hand to force a re-check (the filename is deliberately human
  readable for exactly this). The one built-in exception is signing in
  (`doLogin` in `main.js`), which busts the currently-playing song's entry
  automatically — otherwise logging in specifically to get a better,
  authenticated lyric would just silently hit the old cached result.

Each entry also carries `cachedAtMs` and `offsetMs` — the latter backs the
manual sync-offset feature below.

## Logging (`logger.js`)

The app launches via a `.vbs` script specifically so no console window ever
appears — which also means `console.log` in `main.js` has nowhere a user
could ever see it. `logger.js` appends timestamped lines to
`<userData>/overlay.log` instead (fresh file each launch, no rotation — log
volume here is low enough not to need one), and `main.js` wires three things
into it: uncaught exceptions/rejections, the renderer's own `console.log`
output (via `webContents.on('console-message', ...)`), and a set of explicit
diagnostic points. This is the first thing to check when something silently
doesn't work — most notably the color picker (see *Lyrics color* in the
README), where the failure mode is Chromium doing nothing at all, with no
exception to catch in the first place.

`handleTrackTick`'s lyrics lookup is the other big one: every source in the
fallback chain logs a hit/miss/error as it's tried (`[lyrics]
ytmusic-timed-auth: ...`, `[lyrics] lrclib: ...`, `[lyrics] gemini: ...`,
etc.), ending in `[lyrics] result: source=X (timed|static|none)` — which
source actually won and why the ones before it in priority order didn't, all
in one place. This is the tool for "why did I get synced lyrics for a song
and someone else didn't" — motivated by exactly that report (Clipse's
"P.O.V." resolving to different sources for different people) — rather than
only being able to speculate about which network call behaved differently.
Tray menu → Settings → *Open log file* opens the containing folder directly,
for sending it to someone else debugging the same song.

## Click-through with one interactive hole

Early on, "unlocked" meant a fully interactive window — you could drag it
from anywhere, but it also blocked every click underneath, all the time
(fine for repositioning, bad for actually reading lyrics while doing
anything else). The current behavior instead makes the window click-through
*everywhere, all the time*, with a single small exception carved out for the
title/artist label (`#top-row` in `renderer.js`) that acts as the drag handle.

The mechanism (standard Electron pattern for this exact need):

1. `main.js` calls `win.setIgnoreMouseEvents(true, { forward: true })` by
   default — clicks pass straight through to whatever's behind the overlay.
   `forward: true` is what still lets the renderer receive raw `mousemove`
   while ignoring is on.
2. `renderer.js` listens to `document`'s `mousemove` and hand-hit-tests the
   cursor position against `#top-row`'s `getBoundingClientRect()` — not
   `mouseenter`/`mouseleave`, since a click-through window's derived hover
   state isn't guaranteed to fire those reliably (this is the drop-in
   replacement for an earlier attempt that used them and quietly never
   fired at all).
3. Crossing into/out of that rect sends `set-interactive` over IPC, and
   `main.js` toggles `setIgnoreMouseEvents` accordingly — `false` (fully
   interactive) while hovering the label, back to click-through-with-forward
   the moment the cursor leaves it.
4. While actually dragging (mouse down on the label), hover re-evaluation is
   suspended (`isPressed` in `renderer.js`) — re-hit-testing mid-drag based on
   viewport coordinates fought with the native `-webkit-app-region: drag`
   loop and made moving the window feel jumpy/erratic.

"Locked" mode skips all of this and stays permanently click-through,
including the label — `set-interactive` is a no-op while locked
(`ipcMain.on('set-interactive', ...)` checks `store.get('locked')` first).

## Color swatch: why a visible dot, not a menu item

Chromium only opens an `<input type="color">`'s native picker in response to
a **genuine user click** — one triggered by calling `.click()` from an IPC
handler (i.e., anything wired to a tray menu item) is silently ignored, no
exception thrown, nothing in the console. This was hit directly: `open-color-picker`
sent from the tray, `colorInput.click()` called correctly, and Chromium never
opened anything.

There's no way around that from the main process, so the swatch (`#color-swatch`
in `renderer.js`) exists specifically to be the one thing on screen the user
directly clicks. It's hidden by default (`colorSwatchVisible` in the store) since
a permanent dot next to the title read as clutter; the tray's *Show/Hide
color dot* toggles it, and — since it's only reachable through the same
click-through hole as the drag label — showing it also unlocks and raises the
window so it's actually clickable once shown.

Related: while the native picker is open, `main.js` pauses the periodic
"stay on top" `moveTop()` call (see below) via a `colorPickerOpen` flag, set
via `set-picker-open` on the swatch click and cleared on the color input's
`blur` (the only signal available that the picker closed, whether committed
or cancelled) — otherwise the overlay re-asserts itself above its *own*
picker popup every few seconds, making it unusable.

## Manual sync offset

Sources can be off by a fixed amount for a given song — an LRCLIB submission
timed against a slightly different edit/master, for instance — so `Ctrl+Alt+,`
/ `Ctrl+Alt+.` (and the equivalent tray items) let the user nudge a constant
offset in 100ms steps for whatever's currently playing.

The offset lives on the same `lyricsCache.js` entry as the lyrics themselves
(`LyricsCache.adjustOffset`/`resetOffset`), not a separate settings store, for
two reasons: it's inherently per-song (the same "keyed by title+artist, not
video ID" reasoning as the cache itself applies here too), and piggybacking on
the existing cache file means resetting sync never needs a fresh network
lookup, and deleting a song's cache file naturally clears its offset too.

`main.js` keeps `currentLyrics.offsetMs` in memory as the source of truth
for hotkey/tray adjustments (`changeOffset`/`resetOffset`), and pushes the new
value to the renderer over IPC (`offset-changed`) rather than resending the
whole lyrics payload. The renderer applies it by subtracting it from the real
playback position before comparing against line timestamps
(`state.positionMs - state.offsetMs` in `updateActiveLine`) — so a positive
offset delays the lyrics (makes them show later) and a negative one advances
them, regardless of which line is currently active.

## Customizable global shortcuts

Every global hotkey used to be a hardcoded `globalShortcut.register()` call in
`main.js`, with the accelerator baked directly into both the registration and
the tray label string. `SHORTCUT_DEFS` (an array of `{id, label,
defaultAccelerator}`) and `SHORTCUT_HANDLERS` (an `{id: () => ...}` map) near
the top of `main.js` are now the single source of truth for what a shortcut
*does*; the accelerator it's bound to lives in the store instead
(`store.get('shortcuts')`, seeded from `DEFAULT_SHORTCUTS` the first time it's
read), so it can change at runtime without touching code. `registerShortcuts()`
always starts with `globalShortcut.unregisterAll()` before re-registering every
`{id}` in `SHORTCUT_DEFS` against whatever accelerator the store currently has
for it — simpler than diffing old vs. new bindings, and cheap enough (ten
shortcuts) that it isn't worth optimizing. It's called once at startup and
again after any change from the shortcuts window.

The tray menu itself reads `store.get('shortcuts')` on every rebuild
(`shortcutFor()`/`formatAccelerator()`), so its labels always show whatever
the user last bound a given action to, rather than a hardcoded string that
could silently go stale the moment it's rebound.

**The shortcuts window** (`shortcuts-preload.js`, `renderer/shortcuts.html` /
`.css` / `.js`) is a small, non-modal `BrowserWindow` — the same
create-if-missing-else-focus pattern as the login window (`openShortcutsWindow`
mirrors `doLogin`'s `loginWin` handling). It lists every `SHORTCUT_DEFS` entry
with its current accelerator; clicking *Change* puts that row into a
"recording" state, and the next keydown becomes the new binding via
`renderer/shortcutUtils.js`'s `keyEventToAccelerator()` — keyed off
`KeyboardEvent.code` rather than `.key` specifically so `Shift+,` still reads
as `,` instead of the shifted symbol `<`, and so layout doesn't matter. A
keydown carrying only modifier keys (`ControlLeft`, etc.) returns `null` from
that function, which the recorder reads as "keep waiting" rather than
committing a bare `Control` accelerator.

A submitted accelerator is validated on the main-process side
(`set-shortcut` handler), not trusted from the renderer: first for a conflict
with another action already using the exact same accelerator (rejected with
which action has it), then by actually attempting
`globalShortcut.register()` on it and immediately unregistering again — some
combinations are reserved by Windows or another running app and simply never
register, and this is the only way to find that out before committing to it
as the new binding. Only after both checks pass does it get written to the
store and trigger a full `registerShortcuts()` + tray-menu rebuild.

## Start with Windows

Toggled from the tray menu via Electron's own `app.setLoginItemSettings()` /
`app.getLoginItemSettings()` — no custom registry or Startup-folder code, and
no separate store flag to track (the OS-level setting *is* the source of
truth, read fresh every time the tray menu rebuilds, so it can't drift out of
sync with reality if the user later disables it from Windows' own Settings →
Startup Apps page).

The one wrinkle is unpackaged runs (`npm start` / the portable `.vbs`
launcher): `process.execPath` there is `node_modules/electron/dist/electron.exe`,
a generic Electron shell with no knowledge of *this* project unless told. A
packaged build's own `.exe` already knows what to load, so `loginItemOptions()`
only adds an explicit `path`/`args` (pointing at this project's root folder,
same as running `electron .`) when `app.isPackaged` is false — without that,
enabling this setting from a dev/portable run would register a login item
that opens a blank Electron window with nothing to run.

**Gotcha: `getLoginItemSettings()` must be called with the same `path`/`args`
used to set it.** On Windows it compares against whatever `path`/`args` are
passed in (defaulting to bare `process.execPath`, no args, if omitted) to
decide `openAtLogin`. Reading it back with no arguments right after enabling it
*with* args — the first version of this — made the tray label always read
back "Enable" even immediately after successfully turning it on, since the
registry's actual command line (exe + project path) never matched the
bare-exe-only comparison the read was making. `loginItemOptions()` is shared
by both `setStartWithWindows()` and `startWithWindowsEnabled()` specifically
so this can't drift out of sync again.

## Authentication (`auth.js`)

An earlier version of this app opened an embedded `BrowserWindow` pointed at
`music.youtube.com` and scraped the resulting session cookies. That works, but
an embedded window gets a blank Chromium profile — no saved passwords, no
passkeys, no autofill — which makes Google sign-in noticeably worse than
using the browser you actually use every day.

Instead, `auth.js` implements Google's **OAuth 2.0 device authorization grant**
(RFC 8628) — the flow designed for apps that can't (or shouldn't) embed a
browser, such as TVs and set-top boxes:

1. The app POSTs to Google's device-code endpoint and gets back a short
   `user_code` plus a `verification_url`.
2. It calls `shell.openExternal(verification_url)`, which opens the URL in
   the **user's actual default browser** — their real profile, autofill and
   all — not anything the app controls.
3. A small local window (`renderer/login.html`) — not a webview into Google,
   just static UI the app owns — shows the code so the user can confirm it
   matches what their browser displays.
4. The app polls Google's token endpoint until the user approves the device
   in their browser, then receives an OAuth `access_token` + `refresh_token`.
5. Both are encrypted and written to disk via Electron's `safeStorage`
   (backed by Windows DPAPI, tied to the current Windows user account).
   `access_token` is refreshed automatically (`isTokenExpired` / 60s safety
   margin) using the `refresh_token` before each authenticated request.

Subsequent InnerTube calls send `Authorization: Bearer <access_token>`
instead of the old cookie/`SAPISIDHASH` pair — simpler, and it's Google's
sanctioned mechanism for this use case rather than a cookie-scraping hack.
This mirrors the "oauth" auth method the open-source `ytmusicapi` project
documents; `CLIENT_ID`/`CLIENT_SECRET` in `auth.js` are the same public "TV
and Limited Input device" OAuth client published by that project and by
`yt-dlp` for this exact purpose — not a secret tied to this app or its users.

### Known limitation: Google now rejects this token for InnerTube

As of mid-2026, the access token this flow produces is consistently rejected
by every InnerTube endpoint this app calls (`search` and `next`) with HTTP
400 `"Request contains an invalid argument"` the moment `Authorization:
Bearer <token>` is present — regardless of the `key` query param, the
"Songs" search filter, or which `clientName` (`WEB_REMIX`, `ANDROID_MUSIC`,
`IOS_MUSIC`) the request claims to be. The exact same request with that one
header removed succeeds immediately. Verified directly against a real,
freshly-refreshed (non-expired) token, not a guess from the error message
alone.

This isn't a bug in this app's request-building — it's Google having
restricted the public "TV and Limited Input device" OAuth client (the same
one `ytmusicapi`/`yt-dlp` document) from InnerTube's music surface
server-side, unrelated to anything under this app's control, and not fixable
by adjusting headers or the declared client identity. `handleTrackTick` in
`main.js` already treats this correctly without knowing why it's happening:
step 1's failure is caught, logged, and falls through to LRCLIB/unauthenticated
sources (see *Why the lyrics chain is timed-first* above) rather than
surfacing as a real error — so this shows up as an expected, harmless log
line (`[lyrics] ytmusic-timed-auth: request failed, falling back
unauthenticated: YT Music search HTTP 400`) on every track for a signed-in
user, not a malfunction. Deliberately left attempting the authenticated call
regardless (it fails fast, ~60-100ms) rather than special-cased/skipped, so
it silently starts working again on its own if Google ever reverses this.

## Testable core vs. Electron glue

Electron's main process (`main.js`) can't be `require`d outside an Electron
runtime — it touches `app`/`BrowserWindow` at module scope, and those are
`undefined` under plain Node. To keep the actual logic unit-testable, anything
that doesn't need a live window, tray, or network call was pulled into small,
dependency-free modules:

- `utils.js` — track-identity key, window placement math, settings-cycling
  (`cycleValue`), and top-left-anchored resize math (`resizeKeepingTopLeftAnchored`).
- `trackMetadata.js` — fully pure: junk-annotation stripping and
  artist-from-title extraction, entirely string-in/string-out.
- `lyricsCache.js` — filename sanitizing/keying, and the offset math in
  `adjustOffset`/`resetOffset`, are pure; `get`/`set`/`delete` do real file I/O
  but take the cache directory as a constructor argument, so tests point them
  at a temp directory instead of mocking `fs`.
- `textMatch.js` — fuzzy title/artist scoring shared by `ytmusic.js`,
  `lrclib.js`, and `genius.js`'s search-result ranking.
- `lrclib.js`'s `parseLrc` — LRC text → timed line array.
- `ytmusic.js`'s `extractSongCandidates` / `extractStaticLyrics` /
  `extractTimedLyrics` — pure InnerTube JSON → plain object parsing, exported
  separately from the functions that actually perform the `fetch()` calls.
- `lyricsOvh.js`'s `parseLyricsOvhResponse` — same separation, one field to pull out.
- `genius.js`'s `extractSongCandidates` (search JSON → candidates),
  `extractLyricsFromHtml` (lyrics-page HTML → plain text), and
  `removeExcludedSections` (drops Genius's own `data-exclude-from-selection`
  chrome — see *Scraping gotcha* below) — all exported separately from the
  `fetch()`-performing functions, same pattern as `ytmusic.js`.
- `renderer/lyricsSync.js` — playback-position → active-line-index and
  scroll-ratio math, loaded by both the renderer (via a plain `<script>` tag,
  since the renderer has no bundler) and the test suite (via `require`).
- `renderer/colorUtils.js` — hex → `"r, g, b"` conversion for the lyrics-color
  CSS variable, same dual-load pattern as `lyricsSync.js`.
- `renderer/shortcutUtils.js` — keydown-event fields → Electron accelerator
  string for the keyboard-shortcuts recorder, same dual-load pattern; takes a
  plain `{ctrlKey, altKey, ..., code}` object rather than a real
  `KeyboardEvent` specifically so it stays callable (and testable) with no DOM.
- `logger.js` — takes its target directory as an argument to `init()` (same
  reasoning as `lyricsCache.js`), so tests point it at a temp dir and read
  the resulting file back rather than mocking `fs`.

Everything else — spawning the PowerShell process, wiring IPC, building the
tray menu, driving the actual `BrowserWindow` — is thin enough that it's
verified by running the app rather than by unit tests.

**Gotcha for any future `renderer/*.js` helper**: these are loaded as plain
`<script>` tags (no bundler, no module scope), so every one of them shares a
single global scope. Two of these modules independently declared `const api`
as their final export object, which silently threw `Identifier 'api' has
already been declared` the moment a second one loaded — no error dialog, no
visible symptom beyond "a feature that reads `window.<name>` mysteriously
does nothing," since the failure happens in a `<script>` tag with no visible
UI to report it. Every module's top-level export binding must have a unique
name (`lyricsSyncApi`, `colorUtilsApi`, ...).

## Fitting the window to N lines of lyrics

The tray's *visible lines* setting (1/3/5) resizes the actual OS window
rather than just clipping content inside a fixed-size one — "show 3 lines"
should be true regardless of font size or how the window was last dragged.
The renderer, not `main.js`, owns the height math: it reads the live
`--font-size`/`--line-height-em` CSS custom properties and measures the
track label's real rendered height via `getBoundingClientRect()`, so the
computation can never drift out of sync with the actual CSS (`main.js` would
otherwise need to hardcode a duplicate of every spacing rule that affects
height). `main.js` separately owns the width: `applyDesiredSize()` re-reads
`screen.getDisplayMatching(win.getBounds())` every time it resizes, so the
window is always a third of whichever display it's currently on — including
after being dragged to a different monitor (`win`'s `moved` event re-runs it
with no new height, just to pick up a possible display change).

**Top-aligned, not centered — the lyrics never need to shrink to survive
wrapping.** An earlier version kept every `.lyrics-line` on exactly one
visual row (`white-space: nowrap` + a `fitLineWidths()`-computed `--fit-scale`
shrinking anything too wide) because the active line was vertically *centered*
in the window via `translateY`, and that centering math assumed every line
was exactly one `line-height` tall — a wrapped line broke that assumption,
clipping the lines above/below it as playback advanced (confirmed directly on
a Ska-P line 76 characters long). Shrinking text to force it onto one row to
protect that assumption was the wrong fix — it made long lines needlessly
tiny. The window is top-aligned instead: `updateActiveLine()` in
`renderer.js` translates `.lyrics-inner` so the *first visible* line's own
`.offsetTop` lands at y=0, and the block simply flows downward from there.
Because that only depends on the first visible line's real rendered
position — not an assumed uniform height for every line after it — a long
line is free to wrap to 2+ rows: it and everything after it just moves
further down, and the active line's *entire* wrapped block is highlighted as
one unit, since it's one `<p>` element with the `.active` class.

Wrapping "further down" needs somewhere to go, so `computeDesiredHeight()`
reserves `WRAP_BUFFER_MULTIPLIER` (3x) the configured visible-line count in
actual row budget — "show 3 lines" allocates height for 9, "show 5" for 15.
Since the window has no background panel, that reserved space is simply
invisible when unused; it only matters as headroom for wrapped lines to
occupy without being clipped by `.lyrics`'s `overflow: hidden`. A single line
wrapping to 4+ rows can still clip — an accepted tradeoff for never shrinking
text to force everything onto one row.

That reserved height also has to grow *somewhere* on screen, which is why
`applyDesiredSize()` resizes with `resizeKeepingTopLeftAnchored` rather than
a bottom-anchored version: an earlier version kept the window's *bottom*
edge fixed and grew upward, which — once the 3x wrap-buffer made "show 5
lines" reserve 15 rows of height instead of 5 — could grow the window right
off the top of the screen from a window sitting low enough on screen (its
usual default position). Anchoring the top-left corner instead means growing
purely adds height below wherever the window already is, never moving
content already on screen out from under the user.

`updateActiveLine()` still explicitly marks any line more than
`floor(visibleLines / 2)` away from the active one with `.outside-window`
(`opacity: 0`), independent of the translateY math, so only a bounded window
of lines is ever in play regardless of how any of them wrap.

**Gotcha: `resizable: false` pins the window's effective min/max size on
Windows.** The window is `resizable: false` (manual edge-dragging fought with
the programmatic sizing above and was reported as jumpy), but `setBounds()`
still needs to *shrink* it when `visibleLines` decreases (or the window moves
to a smaller display). Toggling `setResizable(true)` just for that one call,
then back to `false`, is the standard workaround for `setBounds()` otherwise
silently refusing to shrink a non-resizable window on Windows — but doing so
pins the window's effective minimum *and maximum* size to whatever it
happened to be at that exact moment, and that pin is not undone by toggling
`resizable` back. Left alone, this made the window grow correctly but never
shrink back down (the "shrink" call's own target height would get clamped to
the *previous, larger* size, which futureproof-looking `win.getMinimumSize()`
calls would silently pick up instead of the real intended minimum). The fix
in `applyDesiredSize()` is to never trust `win.getMinimumSize()`/
`getMaximumSize()` for this and instead use fixed `MIN_WINDOW_WIDTH`/
`MIN_WINDOW_HEIGHT` constants, then explicitly call
`setMinimumSize`/`setMaximumSize` back to their real intended values after
every resize, undoing that call's own pinning before the next resize needs it.

**Gotcha: `win.moveTop()` also un-hides a hidden window.** The periodic
`setInterval(..., 3000)` that keeps the overlay above newly-focused
fullscreen apps/games used to call `moveTop()` unconditionally. `moveTop()`
turns out to *show* a hidden window as a side effect on Windows — so
"Hide overlay" would silently undo itself a few seconds later, with
nothing updating the tray label or the persisted `visible` state to match
(they'd still say hidden while the window was back on screen). The interval
now checks `store.get('visible')` first. The same call is also paused while
the color picker is open, for the unrelated reason described in the *Color
swatch* section above.
