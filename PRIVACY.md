# Privacy

Lyricslay does not operate a server and does not send telemetry, analytics,
or usage data to its maintainer or to any system controlled by the
maintainer. Everything below happens directly between your machine and the
listed third party.

## What leaves your machine, and to whom

- **Track lookups** (title/artist, cleaned up per `trackMetadata.js`) are
  sent directly to whichever lyrics source is being tried: YouTube Music
  (Google), [LRCLIB](https://lrclib.net), [lyrics.ovh](https://lyrics.ovh),
  or Genius. See the *Features* section of [README.md](README.md) for the
  full fallback order.
- **YouTube Music sign-in** uses Google's OAuth device-flow — Lyricslay
  never sees your password, only a scoped access token. That token is
  encrypted at rest with Electron's `safeStorage` (Windows DPAPI) and never
  leaves your machine except to call Google's/YouTube Music's own APIs on
  your behalf.
- **AI lyrics fallback / romaji conversion** (optional, off by default) send
  the song's YouTube URL or lyrics text to Google's Gemini API, using an API
  key you obtain and paste in yourself (tray menu → *Settings*). This key is
  stored encrypted, locally, the same way as the YouTube Music token. Nothing
  about your usage is shared between installs.
- **Auto-update checks** query GitHub Releases for this repository
  (`electron-updater`) to see if a newer version exists.

## What stays local and is never transmitted anywhere

- The lyrics cache (`%APPDATA%\lyricslay\lyrics-cache\`), sync offsets,
  overlay position/size/color settings, and the log file
  (`%APPDATA%\lyricslay\overlay.log`).

## Third-party privacy policies

Because Lyricslay talks to these services directly, their own privacy
policies govern what they do with the requests Lyricslay sends:
[Google](https://policies.google.com/privacy),
[Genius](https://genius.com/privacy_policy). LRCLIB and lyrics.ovh are
free, keyless, community-run APIs without a formal account system.
