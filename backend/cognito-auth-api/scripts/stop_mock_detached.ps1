$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.mock_server.pid'

if (-not (Test-Path $pidFile)) {
  Write-Host 'No PID file found.'
  exit 0
}

$pid = Get-Content $pidFile | Select-Object -First 1
if ($pid) {
  Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped PID=$pid"
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
