# Code Signing Policy

**Status:** Lyricslay has applied for free code signing through the
[SignPath Foundation](https://signpath.org/) open source program, built on
the [SignPath.io](https://signpath.io/) signing platform. Releases are not
yet signed — this document will be updated once the application is approved
and signing is active.

## Why

Windows installers are unsigned by default for a new project, which triggers
a SmartScreen "unknown publisher" warning on every install. SignPath
Foundation provides free code signing certificates to qualifying open source
projects; see their
[terms and conditions](https://signpath.org/terms.html).

## Team and roles

Lyricslay has a single maintainer. Until the project has more contributors,
roles are:

| Role | Person | Responsibility |
| --- | --- | --- |
| Author | Arzatar (repository owner) | Writes and merges code |
| Reviewer | Arzatar | Reviews any externally submitted pull request before merge |
| Approver | Arzatar | Approves each release signing request in SignPath |

All accounts involved (GitHub, SignPath) use multi-factor authentication.

## What gets signed

Only the Windows installer (`.exe`) produced by the `release` workflow in
[`.github/workflows/release.yml`](.github/workflows/release.yml), built
directly from this repository's source via `electron-builder`. No
third-party or upstream binaries are re-signed under this certificate.

## Privacy

See [PRIVACY.md](PRIVACY.md) for what data Lyricslay transmits and to whom —
in short, nothing is collected by or sent to the maintainer; the app only
talks to third-party lyrics APIs and, optionally, Google's Gemini API using
your own key.
