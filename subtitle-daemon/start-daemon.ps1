# ZixiCaption daemon: start, monitor, health check
# Start: .\start-daemon.ps1
# Stop:  Stop-ScheduledTask -TaskName ZixiCaption; or Stop-Process
$ErrorActionPreference = 'Stop'

$ModelDir = 'C:\Users\CPXru\Desktop\thumb\Projects\cl-deploy-ascii\subtitle-daemon\models\sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05'
$DaemonDir = $PSScriptRoot

# 1. Reuse existing
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 3
    if ($h.ok) {
        Write-Output "already running (pid via netstat below)"
        return
    }
} catch {}

# 2. GPU note: pip sherpa-onnx is CPU-only build; CPU is enough for 1 live stream.
$env:CAPTION_MODEL_DIR = $ModelDir
$env:CAPTION_THREADS = '4'   # 4 inference threads; the rest of the cores stay free for OBS/browser

$notif = New-Object System.Collections.Generic.List[string]
$proc = Start-Process -FilePath 'python.exe' -ArgumentList 'caption_daemon.py' `
    -WorkingDirectory $DaemonDir -NoNewWindow -PassThru
if ($proc.PriorityClass) { $proc.PriorityClass = 'BelowNormal' }  # don't starve OBS/browser

$deadline = (Get-Date).AddSeconds(60)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if ($proc.HasExited) { throw "daemon exited early: $($proc.ExitCode)" }
    try {
        $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/health' -TimeoutSec 3
        if ($h.ok) { $healthy = $true; break }
    } catch {}
}
if ($healthy) {
    Write-Output "ZixiCaption healthy: load_s=$($h.load_s) provider=$($h.provider)"
} else {
    throw 'daemon did not become healthy in 60s'
}
