param(
  [string]$Root = "c:\Users\Louis\Visual Studio\Popcorn"
)

$ErrorActionPreference = "Stop"

function Stop-ListenerOnPort([int]$Port) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c -and $c.OwningProcess) {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  } catch {
    # ignore
  }
}

Stop-ListenerOnPort 3000
Stop-ListenerOnPort 3001

$frontend = Join-Path $Root "frontend"
$backend  = Join-Path $Root "backend"
New-Item -ItemType Directory -Force -Path $frontend, $backend | Out-Null

$src = Join-Path $Root "Popcorn"
$dst = Join-Path $frontend "Popcorn"

if (!(Test-Path -LiteralPath $src)) {
  if (Test-Path -LiteralPath $dst) {
    Write-Host "Already split: frontend is at $dst; backend is at $backend" -ForegroundColor Green
    exit 0
  }
  throw "Source folder not found: $src"
}
if (Test-Path -LiteralPath $dst) {
  throw "Destination already exists: $dst"
}

Write-Host "Moving $src -> $dst ..."
Move-Item -LiteralPath $src -Destination $dst

$backendProjects = @(
  "infra",
  "movie-api-test",
  "my-chatgpt-app",
  "openai-vector-search",
  "vector-service"
)

foreach ($name in $backendProjects) {
  $p = Join-Path $dst $name
  if (Test-Path -LiteralPath $p) {
    $target = Join-Path $backend $name
    if (Test-Path -LiteralPath $target) {
      throw "Backend destination already exists: $target"
    }
    Write-Host "Moving $p -> $target ..."
    Move-Item -LiteralPath $p -Destination $target
  }
}

Write-Host "OK: frontend is at $dst; backend is at $backend"