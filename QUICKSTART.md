# Lyricslay — synced lyrics overlay, always on top, for whatever's playing on Windows

Free, open-source (MIT), no ads, no telemetry. Watches Windows' native
media session, so it works with YouTube Music (browser, PWA, or desktop
app), Spotify, or basically anything that reports what's playing — no
browser extension needed.

**What it does:** a small transparent overlay shows the current song's
lyrics, synced line-by-line, floating over whatever you're doing (games
included — it's click-through when locked). Drag it once per app and it
remembers that spot.

## Quick setup

1. Grab the installer from [Releases](https://github.com/Arzatar/Lyricslay/releases) (or run from source — see the [README](README.md)).
2. Play a song. That's it — the overlay finds and syncs lyrics automatically.
3. `Ctrl+Alt+L` locks it (click-through, for gaming). Right-click the tray icon for everything else.

## Tips for the best experience

- **Get a free Gemini API key** (tray → Settings → *Set up AI lyrics fallback*, link included to grab one) — unlocks two things at no cost to you beyond your own free quota:
  - Songs nothing else has synced lyrics for get transcribed straight from their YouTube video, timestamps included.
  - Japanese lyrics can show as **romaji** automatically, so you can follow along without reading kanji.
  Nothing is shared between installs — it's your key, your quota, never bundled with the app.
- **Wrong lyrics for a song?** Tray → *Re-search lyrics for this song* — the cache never expires on its own, so this is the fix if a source ever matched the wrong track.
- Everything's rebindable: fonts, opacity, visible line count, hotkeys, sync offset per song — all from the tray menu.

Windows 10/11 only (uses `GlobalSystemMediaTransportControlsSessionManager`).
Full docs and architecture notes: [README.md](README.md) / [ARCHITECTURE.md](ARCHITECTURE.md)
