# Streams "now playing" media info as one JSON line per tick, read from Windows'
# GlobalSystemMediaTransportControlsSessionManager (SMTC). Works for any app that reports
# to the OS media session used for the volume-flyout / hardware media keys - YouTube /
# YouTube Music in any browser tab, the YT Music PWA/desktop app, Spotify, etc.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

# Per-process audio peak meters (Core Audio WASAPI session API), used to tell
# whether the *app* behind the selected SMTC session is still actually making
# sound. Needed because Chromium-based browsers (Opera GX, Chrome, Edge, ...)
# expose ONE SMTC session for the whole browser, fed by whichever tab most
# recently *started* playing - not one per tab. Confirmed live: YT Music
# playing in one tab, then play+pause a video in another tab, and Opera's
# single session keeps reporting the paused video forever, even though YT
# Music never stopped; the music tab simply became invisible to SMTC until it
# was refocused. "Paused, but the browser is still audibly outputting sound"
# is the signal main.js (see sessionHold.js) uses to fall back to the last
# track it saw genuinely playing in that same app.
Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LyricslayAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom {}

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2 {
        // IAudioSessionManager
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
        // IAudioSessionManager2
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2 {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr eventContext);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr eventContext);
        [PreserveSig] int GetGroupingParam(out Guid groupingParam);
        [PreserveSig] int SetGroupingParam(IntPtr groupingParam, IntPtr eventContext);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint pid);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioMeterInformation {
        [PreserveSig] int GetPeakValue(out float peak);
    }

    public static class Meters {
        // Peak meters for every audio session on the default playback device
        // whose owning process name appears inside the SMTC appId (e.g.
        // process "opera" in "OperaSoftware.OperaGXWebBrowser.123", "chrome"
        // in "Chrome", "msedge" in "MSEdge", "spotify" in "Spotify.exe").
        // AppIds that are opaque hashes (Firefox) match nothing -> empty list,
        // which the caller reports as "unknown" rather than "silent".
        public static IAudioMeterInformation[] ForAppId(string appId) {
            List<IAudioMeterInformation> result = new List<IAudioMeterInformation>();
            if (String.IsNullOrEmpty(appId)) return result.ToArray();
            string appIdLower = appId.ToLowerInvariant();

            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
            IMMDevice device;
            if (enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device) != 0 || device == null) {
                return result.ToArray();
            }
            Guid iid = typeof(IAudioSessionManager2).GUID;
            object managerObj;
            if (device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out managerObj) != 0) return result.ToArray();
            IAudioSessionManager2 manager = (IAudioSessionManager2)managerObj;

            IAudioSessionEnumerator sessions;
            if (manager.GetSessionEnumerator(out sessions) != 0 || sessions == null) return result.ToArray();
            int count;
            sessions.GetCount(out count);

            Dictionary<uint, string> names = new Dictionary<uint, string>();
            for (int i = 0; i < count; i++) {
                IAudioSessionControl2 ctl;
                if (sessions.GetSession(i, out ctl) != 0 || ctl == null) continue;
                uint pid;
                if (ctl.GetProcessId(out pid) != 0 || pid == 0) continue;
                string name;
                if (!names.TryGetValue(pid, out name)) {
                    try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); }
                    catch { name = ""; }
                    names[pid] = name;
                }
                if (name.Length < 3 || !appIdLower.Contains(name)) continue;
                IAudioMeterInformation meter = ctl as IAudioMeterInformation;
                if (meter != null) result.Add(meter);
            }
            return result.ToArray();
        }

        public static float Peak(IAudioMeterInformation[] meters) {
            float max = 0;
            foreach (IAudioMeterInformation m in meters) {
                float p;
                if (m.GetPeakValue(out p) == 0 && p > max) max = p;
            }
            return max;
        }
    }
}
"@

function Get-PreferredSession($manager) {
    # $preferredKeywords only breaks ties (multiple sessions in the same playback
    # state) - it must never let a *paused* browser/music-app session outrank an
    # app that's actually playing right now (reported live: Spotify actively
    # playing was ignored in favor of a stale paused Opera tab, since Spotify's
    # appId never matches any keyword and used to only get picked up via
    # GetCurrentSession() when literally no keyword session existed at all).
    $sessions = $manager.GetSessions()
    $preferredKeywords = @('music', 'yt', 'chrome', 'msedge', 'firefox', 'brave', 'opera')
    $playingPreferred = $null
    $playingAny = $null
    $pausedPreferred = $null
    foreach ($s in $sessions) {
        $appId = $s.SourceAppUserModelId.ToLowerInvariant()
        $isPreferred = $false
        foreach ($kw in $preferredKeywords) {
            if ($appId.Contains($kw)) { $isPreferred = $true; break }
        }
        try {
            $isPlaying = $s.GetPlaybackInfo().PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
        } catch { continue }
        if ($isPlaying) {
            if ($isPreferred -and $null -eq $playingPreferred) { $playingPreferred = $s }
            if ($null -eq $playingAny) { $playingAny = $s }
        } elseif ($isPreferred -and $null -eq $pausedPreferred) {
            $pausedPreferred = $s
        }
    }
    if ($null -ne $playingPreferred) { return $playingPreferred }
    if ($null -ne $playingAny) { return $playingAny }
    if ($null -ne $pausedPreferred) { return $pausedPreferred }
    try { return $manager.GetCurrentSession() } catch { return $null }
}

$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Windows PowerShell's Console.Out encodes through the console/OEM codepage even when
# stdout is redirected to a pipe, which mangles non-ASCII characters (accents, ñ, etc.)
# by the time Node reads them. Writing directly to the raw stdout stream with an
# explicit UTF-8 (no BOM) encoder bypasses that and guarantees Node sees real UTF-8.
$stdout = [Console]::OpenStandardOutput()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$out = New-Object System.IO.StreamWriter($stdout, $utf8NoBom)
$out.AutoFlush = $false
# Samples the selected app's audio peak several times across the tick's
# wait instead of once: a single instantaneous peak reading can land on a
# quiet moment (a pause between phrases) and read as silence. Returns $true
# (sound heard at least once), $false (meters found, all silent), or $null
# (no meter could be matched to this appId, or the audio API failed -
# unknown, which main.js treats the same as "not audible").
function Measure-Audible($appId, $totalMs, $samples) {
    $stepMs = [math]::Floor($totalMs / $samples)
    try {
        $meters = [LyricslayAudio.Meters]::ForAppId($appId)
    } catch {
        Start-Sleep -Milliseconds $totalMs
        return $null
    }
    if ($meters.Length -eq 0) {
        Start-Sleep -Milliseconds $totalMs
        return $null
    }
    $heard = $false
    for ($i = 0; $i -lt $samples; $i++) {
        try {
            if ([LyricslayAudio.Meters]::Peak($meters) -gt 0.001) { $heard = $true }
        } catch {}
        Start-Sleep -Milliseconds $stepMs
    }
    return $heard
}

$PausedStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Paused
while ($true) {
    $slept = $false
    try {
        $session = Get-PreferredSession $manager
        # Only a *paused* session needs the audio check (see sessionHold.js) -
        # it replaces this tick's normal sleep rather than adding to it, and
        # runs before the media/timeline reads below so the reported position
        # is still as fresh as possible when it's written out.
        $audible = $null
        if ($null -ne $session) {
            try { $isPaused = $session.GetPlaybackInfo().PlaybackStatus -eq $PausedStatus } catch { $isPaused = $false }
            if ($isPaused) {
                $audible = Measure-Audible $session.SourceAppUserModelId 800 8
                $slept = $true
            }
        }
        if ($null -eq $session) {
            $out.WriteLine('{"active":false}')
        } else {
            $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $timeline = $session.GetTimelineProperties()
            $playback = $session.GetPlaybackInfo()

            $title = $props.Title
            $artist = $props.Artist

            if ([string]::IsNullOrWhiteSpace($title)) {
                $out.WriteLine('{"active":false}')
            } else {
                # $timeline.Position is only accurate as of $timeline.LastUpdatedTime — most
                # apps (browsers included) don't push a fresh Position on every frame, only
                # when something changes. Taking Position at face value makes the reported
                # position lag further behind real playback the longer it's been since the
                # last update, which — combined with the renderer's own local extrapolation
                # between polls — causes position to visibly jump backwards every time a
                # fresher value arrives (the lyrics "dancing"/scrolling back and forth).
                # Extrapolating here means every poll already reports an accurate "right now"
                # position, so the renderer's between-poll interpolation has nothing to correct.
                $durationMs = $timeline.EndTime.TotalMilliseconds
                $positionMs = $timeline.Position.TotalMilliseconds
                if ($playback.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
                    $rate = 1.0
                    if ($null -ne $playback.PlaybackRate) { $rate = $playback.PlaybackRate }
                    $elapsedSinceUpdateMs = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalMilliseconds
                    if ($elapsedSinceUpdateMs -gt 0) {
                        $positionMs += $elapsedSinceUpdateMs * $rate
                    }
                }
                if ($positionMs -lt 0) { $positionMs = 0 }
                if ($durationMs -gt 0 -and $positionMs -gt $durationMs) { $positionMs = $durationMs }

                $obj = [ordered]@{
                    active      = $true
                    appId       = $session.SourceAppUserModelId
                    title       = $title
                    artist      = $artist
                    album       = $props.AlbumTitle
                    status      = $playback.PlaybackStatus.ToString()
                    positionMs  = [math]::Round($positionMs)
                    durationMs  = [math]::Round($durationMs)
                    updatedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    audible     = $audible
                }
                $json = $obj | ConvertTo-Json -Compress
                $out.WriteLine($json)
            }
        }
    } catch {
        $errObj = [ordered]@{ active = $false; error = $_.Exception.Message }
        $out.WriteLine(($errObj | ConvertTo-Json -Compress))
    }
    $out.Flush()
    if (-not $slept) { Start-Sleep -Milliseconds 800 }
}
