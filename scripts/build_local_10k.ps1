param(
  [int]$Target = 10000,
  [int]$Pages = 500,
  [int]$MinVotes = 500,
  [double]$MinVoteAverage = 6.5,
  [double]$MinImdbRating = 6.5,
  [int]$DelayMs = 350,
  [switch]$Fast,
  [switch]$TopRated,
  [switch]$Fresh
)

$ErrorActionPreference = 'Stop'

# Expected env vars:
# - LOCAL_DATA_PATH (e.g. C:\Users\Louis\Visual Studio\Popcorn\Movie-data)
# - OPENAI_API_KEY
# - TMDB_API_KEY
# Optional:
# - OMDB_API_KEY

if (-not $env:LOCAL_DATA_PATH) { throw 'Missing LOCAL_DATA_PATH env var.' }
if (-not $env:OPENAI_API_KEY) { throw 'Missing OPENAI_API_KEY env var.' }
if (-not $env:TMDB_API_KEY) { throw 'Missing TMDB_API_KEY env var.' }

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$cmd = @(
  'node',
  '.\\Popcorn\\movie-api-test\\fetchMovie.js',
  'build-popular',
  '--count', $Target,
  '--pages', $Pages,
  '--min-votes', $MinVotes,
  '--delay-ms', $DelayMs,
  '--moodtags'
)

if ($MinVoteAverage -gt 0) { $cmd += @('--min-vote-average', $MinVoteAverage) }
if ($MinImdbRating -gt 0) { $cmd += @('--min-imdb-rating', $MinImdbRating) }
if ($Fast) { $cmd += '--fast' }
if ($TopRated) { $cmd += '--top-rated' }
if ($Fresh) { $cmd += '--fresh' }

Write-Host ('Running: ' + ($cmd -join ' '))
& $cmd[0] $cmd[1..($cmd.Length-1)]

# Build FAISS index (requires python deps in Popcorn/vector-service).
Write-Host 'Building FAISS index...'
Push-Location .\Popcorn\vector-service
python .\build_index.py --local-data-path $env:LOCAL_DATA_PATH
Pop-Location

Write-Host 'Done.'
Write-Host ('Local data folder: ' + $env:LOCAL_DATA_PATH)
Write-Host 'Next: start the vector service (optional):'
Write-Host '  cd Popcorn/vector-service'
Write-Host '  $env:LOCAL_DATA_PATH="..."'
Write-Host '  python app.py'
