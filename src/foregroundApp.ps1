# Streams the foreground (active) window's owning process name as one JSON line
# per tick, so main.js can tell which app the overlay is currently sitting on
# top of — used to remember/restore a different overlay position per app.

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ForegroundWindowNative {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

# Windows PowerShell's Console.Out encodes through the console/OEM codepage even when
# stdout is redirected to a pipe, which mangles non-ASCII characters by the time Node
# reads them. Writing directly to the raw stdout stream with an explicit UTF-8 (no
# BOM) encoder bypasses that and guarantees Node sees real UTF-8 (see nowplaying.ps1,
# which this mirrors).
$stdout = [Console]::OpenStandardOutput()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$out = New-Object System.IO.StreamWriter($stdout, $utf8NoBom)
$out.AutoFlush = $false

while ($true) {
    try {
        $hwnd = [ForegroundWindowNative]::GetForegroundWindow()
        $processName = $null
        if ($hwnd -ne [IntPtr]::Zero) {
            $procId = 0
            [ForegroundWindowNative]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
            if ($procId -ne 0) {
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                if ($null -ne $proc) { $processName = $proc.ProcessName }
            }
        }
        $obj = [ordered]@{ processName = $processName }
        $out.WriteLine(($obj | ConvertTo-Json -Compress))
    } catch {
        $out.WriteLine('{"processName":null}')
    }
    $out.Flush()
    Start-Sleep -Milliseconds 1000
}
