$root = 'C:\Users\DELL\.zcode\workspace\default\Arise'
$files = @(Get-ChildItem $root -File -Filter *.js)
$files += @(Get-ChildItem "$root\features" -Recurse -File -Filter *.js)
$out = @()
foreach ($f in $files) {
  $t = [System.IO.File]::ReadAllText($f.FullName)
  $si = ([regex]::Matches($t, 'setInterval')).Count
  $sx = ([regex]::Matches($t, '\.open\(\s*["''](GET|HEAD)["'']\s*,\s*[^,)]+,\s*(?:!1|false)\s*\)')).Count
  $cl = ([regex]::Matches($t, 'clearInterval')).Count
  if ($si -gt 0 -or $sx -gt 0) {
    $out += ('{0,-50} setInterval={1} clearInterval={2} syncXHR={3}' -f $f.Name, $si, $cl, $sx)
  }
}
$out | Sort-Object -Descending
Write-Output '=== top-level fetch usage in big widgets (line numbers) ==='
foreach ($name in @('competitive-programming-widget.js','attendance-tracker-widget.js','expenses.js','placement-tracker.js','certificates-widget.js')) {
  $p = Join-Path $root $name
  if (-not (Test-Path $p)) { $p = Get-ChildItem $root -Recurse -File -Filter $name | Select-Object -First 1 -ExpandProperty FullName }
  if ($p) {
    $lines = [System.IO.File]::ReadAllLines($p)
    Write-Output "--- $name ---"
    for ($i = 0; $i -lt $lines.Count; $i++) {
      if ($lines[$i] -match 'fetch\(|XMLHttpRequest') { Write-Output ('{0,6}: {1}' -f ($i+1), $lines[$i].Trim().Substring(0, [Math]::Min(150, $lines[$i].Trim().Length))) }
    }
  }
}
