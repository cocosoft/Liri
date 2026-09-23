$ErrorActionPreference = 'SilentlyContinue'

# 1) 探测所有候选 session 目录
$roots = @()
$tmp = Join-Path $env:LOCALAPPDATA 'Temp'
Get-ChildItem $tmp -Directory -Filter '*cg3*' | ForEach-Object {
  $s = Join-Path $_.FullName 'sessions'
  if (Test-Path $s) { $roots += $s }
}
# 其它可能的真实数据目录
foreach ($cand in @(
    (Join-Path $env:USERPROFILE '.liri'),
    (Join-Path $env:USERPROFILE '.pyapp'),
    (Join-Path $env:APPDATA 'liri'),
    (Join-Path $env:LOCALAPPDATA 'liri')
  )) {
  if (Test-Path $cand) { $roots += $cand }
}

Write-Output "=== roots ==="
$roots | ForEach-Object { Write-Output $_ }

$sessions = @()
foreach ($r in $roots) {
  Get-ChildItem $r -Directory | ForEach-Object {
    Get-ChildItem $_.FullName -Directory | Where-Object {
      (Test-Path (Join-Path $_.FullName 'messages.jsonl')) -or (Test-Path (Join-Path $_.FullName 'events.jsonl'))
    } | ForEach-Object { $sessions += $_.FullName }
  }
}

Write-Output "=== session count: $($sessions.Count) ==="
$sessions | Select-Object -First 5 | ForEach-Object {
  Write-Output "SAMPLE $_"
  Get-ChildItem $_ | ForEach-Object { Write-Output ("   {0}  {1} bytes" -f $_.Name, $_.Length) }
}
