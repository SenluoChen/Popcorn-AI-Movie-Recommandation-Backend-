$src = Get-ChildItem -Path 'C:\Users\Louis\Downloads' -Filter 'gggfgfg*' -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if ($src -and $src.Length) {
  $legacy = 'C:\Users\Louis\Visual Studio\Popcorn\Popcorn\public\image.png'
  $split = 'C:\Users\Louis\Visual Studio\Popcorn\frontend\Popcorn\public\image.png'
  $dest = if (Test-Path $split) { $split } else { $legacy }
  Copy-Item -Path $src -Destination $dest -Force
  Write-Output "COPIED: $src"
  exit 0
} else {
  Write-Output "NO_MATCH"
  exit 2
}
