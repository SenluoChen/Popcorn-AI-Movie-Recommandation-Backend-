param(
  [string]$EnvFile = "..\..\..\.env",
  [string]$Name = "/relivre/openai_api_key",
  [string]$Region = "eu-west-3"
)

$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot $EnvFile
if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Env file not found: $envPath"
}

$lines = Get-Content -LiteralPath $envPath -ErrorAction Stop
$pair = $lines | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^OPENAI_API_KEY=' } | Select-Object -First 1
if (-not $pair) {
  throw "OPENAI_API_KEY not found in $envPath"
}

$key = $pair -replace '^OPENAI_API_KEY=', ''
$key = $key.Trim()
if (-not $key) { throw "OPENAI_API_KEY is empty in $envPath" }
if ($key.Contains('<') -or $key.Contains('>') -or -not $key.StartsWith('sk-')) {
  throw "Key value does not look valid. Aborting."
}

Write-Host "Putting OpenAI key into SSM parameter: $Name (region=$Region)" -ForegroundColor Cyan

aws ssm put-parameter --name $Name --type SecureString --overwrite --value $key --region $Region --output json | Out-Null

$version = aws ssm get-parameter --name $Name --region $Region --query "Parameter.Version" --output text
Write-Host "OK. Updated SSM parameter version: $version" -ForegroundColor Green

# Clear sensitive vars
$key = $null
$pair = $null
$lines = $null

Write-Host "Done. Proceed to remove .env from git tracking." -ForegroundColor Cyan
