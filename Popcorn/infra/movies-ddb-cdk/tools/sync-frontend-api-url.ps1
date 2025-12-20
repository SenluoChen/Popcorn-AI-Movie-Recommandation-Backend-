param(
  [string]$StackName = "ReLivreAppStack",
  # Default to the CRA app root (this repo has Popcorn/Popcorn as the React app).
  [string]$FrontendRoot = "..\\..",
  [string]$VarName = "REACT_APP_RELIVRE_API_URL",
  [string]$OutputKey = "ApiUrl",
  [string]$OutputsFile = "cdk-outputs.json",
  [switch]$AlsoWriteEnvLocal
)

$ErrorActionPreference = "Stop"

function Resolve-PathSafe([string]$p) {
  return (Resolve-Path -LiteralPath $p).Path
}

$cdkDir = Resolve-PathSafe (Join-Path $PSScriptRoot "..")
$frontendDir = Resolve-PathSafe (Join-Path $cdkDir $FrontendRoot)

$outputsPath = $OutputsFile
if (-not [System.IO.Path]::IsPathRooted($outputsPath)) {
  $outputsPath = Join-Path $cdkDir $outputsPath
}

Push-Location $cdkDir
try {
  # CDK v2 CLI in this repo does NOT expose `cdk outputs`.
  # Preferred path: use `cdk deploy --outputs-file cdk-outputs.json` to generate outputs,
  # then read them here.
  if (-not (Test-Path -LiteralPath $outputsPath)) {
    Write-Host "Outputs file not found: $outputsPath" -ForegroundColor Yellow
    Write-Host "Run: npx cdk deploy $StackName --require-approval never --outputs-file $OutputsFile" -ForegroundColor Yellow
    throw "Missing outputs file."
  }

  $raw = Get-Content -LiteralPath $outputsPath -Raw -Encoding UTF8
  $all = $raw | ConvertFrom-Json

  if (-not ($all.PSObject.Properties.Name -contains $StackName)) {
    $known = ($all.PSObject.Properties.Name -join ", ")
    throw "Stack '$StackName' not found in CDK outputs. Known: $known"
  }

  $stackOutputs = $all.$StackName
  if (-not ($stackOutputs.PSObject.Properties.Name -contains $OutputKey)) {
    $keys = ($stackOutputs.PSObject.Properties.Name -join ", ")
    throw "Output '$OutputKey' not found for stack '$StackName'. Available: $keys"
  }

  $apiUrl = [string]$stackOutputs.$OutputKey
  $apiUrl = $apiUrl.Trim()
  if (-not $apiUrl) {
    throw "Output '$OutputKey' is empty."
  }
  if (-not $apiUrl.EndsWith("/")) { $apiUrl = "$apiUrl/" }

  $envProdLocal = Join-Path $frontendDir ".env.production.local"
  $envLocal = Join-Path $frontendDir ".env.local"

  $line = "$VarName=$apiUrl"

  Set-Content -LiteralPath $envProdLocal -Value $line -Encoding UTF8

  if ($AlsoWriteEnvLocal) {
    Set-Content -LiteralPath $envLocal -Value $line -Encoding UTF8
  }

  Write-Host "Wrote $VarName to: $envProdLocal" -ForegroundColor Green
  if ($AlsoWriteEnvLocal) {
    Write-Host "Wrote $VarName to: $envLocal" -ForegroundColor Green
  }
  Write-Host "Value: $apiUrl" -ForegroundColor DarkGray
} finally {
  Pop-Location
}
