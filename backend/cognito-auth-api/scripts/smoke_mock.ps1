$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Build once so dist exists
npm run build | Out-Null

$port = if ($env:PORT) { [int]$env:PORT } else { 3011 }

$env:AUTH_MODE = 'mock'
if (-not $env:MOCK_JWT_SECRET) { $env:MOCK_JWT_SECRET = 'dev-only-change-me' }
if (-not $env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN = 'http://localhost:3000' }
$env:PORT = "$port"

Write-Host "Starting cognito-auth-api (mock) on port $port..."

$job = Start-Job -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  Set-Location $using:root
  node dist/index.js
}

try {
  # Wait for health
  $health = $null
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $health = Invoke-RestMethod -Method GET -Uri "http://localhost:$port/health" -TimeoutSec 2
      if ($health) { break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $health) { throw "Server did not become healthy on port $port" }
  Write-Host ("/health => " + ($health | ConvertTo-Json -Compress))

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $payload = @{ email = 'test@example.com'; password = 'pass1234' } | ConvertTo-Json

  $signup = Invoke-RestMethod -Method POST -Uri "http://localhost:$port/auth/signup" -ContentType 'application/json' -Body $payload -WebSession $session -TimeoutSec 2
  Write-Host ("/auth/signup => " + ($signup | ConvertTo-Json -Compress))

  $login = Invoke-RestMethod -Method POST -Uri "http://localhost:$port/auth/login" -ContentType 'application/json' -Body $payload -WebSession $session -TimeoutSec 2
  Write-Host ("/auth/login => " + ($login | ConvertTo-Json -Compress))

  $me = Invoke-RestMethod -Method GET -Uri "http://localhost:$port/auth/me" -WebSession $session -TimeoutSec 2
  Write-Host ("/auth/me => " + ($me | ConvertTo-Json -Compress))

  $refresh = Invoke-RestMethod -Method POST -Uri "http://localhost:$port/auth/refresh" -WebSession $session -TimeoutSec 2
  Write-Host ("/auth/refresh => " + ($refresh | ConvertTo-Json -Compress))

  $logout = Invoke-RestMethod -Method POST -Uri "http://localhost:$port/auth/logout" -WebSession $session -TimeoutSec 2
  Write-Host ("/auth/logout => " + ($logout | ConvertTo-Json -Compress))

  $meAfterOk = $false
  try {
    Invoke-RestMethod -Method GET -Uri "http://localhost:$port/auth/me" -WebSession $session -TimeoutSec 2 | Out-Null
    $meAfterOk = $true
  } catch {
    # expected 401
  }

  if ($meAfterOk) {
    throw 'Expected /auth/me to fail after logout, but it succeeded.'
  }

  Write-Host 'Smoke test OK'
  exit 0
}
finally {
  # Windows PowerShell 5.1: Stop-Job does not support -Force
  Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $job -Force -ErrorAction SilentlyContinue | Out-Null
}
