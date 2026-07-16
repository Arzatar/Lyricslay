# Streams "now playing" media info as one JSON line per tick, read from Windows'
# GlobalSystemMediaTransportControlsSessionManager (SMTC). Works for YouTube / YouTube Music
# playing in any browser tab, the YT Music PWA, or the desktop app, since all of them report
# to the OS media session used for the volume-flyout / hardware media keys.

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

function Get-PreferredSession($manager) {
    $sessions = $manager.GetSessions()
    $preferredKeywords = @('music', 'yt', 'chrome', 'msedge', 'firefox', 'brave', 'opera')
    $best = $null
    foreach ($s in $sessions) {
        $appId = $s.SourceAppUserModelId.ToLowerInvariant()
        foreach ($kw in $preferredKeywords) {
            if ($appId.Contains($kw)) {
                try {
                    $pb = $s.GetPlaybackInfo()
                    if ($pb.PlaybackStatus -eq [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing) {
                        return $s
                    }
                    if ($best -eq $null) { $best = $s }
                } catch {}
            }
        }
    }
    if ($best -ne $null) { return $best }
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
while ($true) {
    try {
        $session = Get-PreferredSession $manager
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
    Start-Sleep -Milliseconds 800
}
