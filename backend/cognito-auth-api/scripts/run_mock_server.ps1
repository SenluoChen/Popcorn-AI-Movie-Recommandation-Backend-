$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:PORT) { $env:PORT = '3001' }
$env:AUTH_MODE = 'mock'
if (-not $env:MOCK_JWT_SECRET) { $env:MOCK_JWT_SECRET = 'dev-only-change-me' }
if (-not $env:FRONTEND_ORIGIN) { $env:FRONTEND_ORIGIN = 'http://localhost:3000' }

npm run build
node dist/index.js
