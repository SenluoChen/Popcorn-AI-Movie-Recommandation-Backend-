param(
  [Parameter(Mandatory = $false)]
  [string]$Name = "/relivre/openai_api_key",

  [Parameter(Mandatory = $false)]
  [string]$Region = "eu-west-3"
)

$ErrorActionPreference = "Stop"

Write-Host "Updating SSM SecureString: $Name (region=$Region)" -ForegroundColor Cyan
Write-Host "Paste your OpenAI key when prompted. It will not be echoed." -ForegroundColor Cyan

$secure = Read-Host -Prompt "OpenAI API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

if (-not $plain) {
  throw "No key provided."
}

# Minimal validation to catch the common mistake of using a placeholder like <NEW_KEY>
if ($plain.Contains("<") -or $plain.Contains(">") -or -not $plain.StartsWith("sk-")) {
  throw "Key does not look valid (expected it to start with 'sk-' and not contain '<' or '>')."
}

# Put/overwrite without printing the value.
aws ssm put-parameter `
  --name $Name `
  --type SecureString `
  --overwrite `
  --value $plain `
  --region $Region `
  --output json | Out-Null

# Confirm update without decrypting.
$version = aws ssm get-parameter --name $Name --region $Region --query "Parameter.Version" --output text
Write-Host "OK. Updated SSM parameter version: $version" -ForegroundColor Green

# Best-effort cleanup
$plain = $null
$secure = $null
