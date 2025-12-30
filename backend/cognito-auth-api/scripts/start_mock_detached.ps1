$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Defaults
if (-not $env:PORT) { $env:PORT = '3001' }
$env:AUTH_MODE = 'mock'
if (-not $env:MOCK_JWT_SECRET) { $env:MOCK_JWT_SECRET = 'dev-only-change-me' }
if (-not $env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN = 'http://localhost:3000' }

npm run build | Out-Null

$pidFile = Join-Path $root '.mock_server.pid'
if (Test-Path $pidFile) {
  try {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) {
      Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
    }
  } catch {}
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$node = (Get-Command node).Source
$proc = Start-Process -FilePath $node -ArgumentList @('dist/index.js') -WorkingDirectory $root -PassThru -WindowStyle Hidden
$proc.Id | Out-File -FilePath $pidFile -Encoding ascii

Write-Host "Started mock auth server PID=$($proc.Id) on http://localhost:$($env:PORT)"
