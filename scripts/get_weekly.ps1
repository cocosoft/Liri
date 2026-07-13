param([int]$Days = )

Set-Location 'E:\PY\CODES\PY_APP'

$weekAgo = (Get-Date).AddDays(-$Days).ToString('yyyy-MM-dd')
$today = (Get-Date).('yyyy-MM-dd')

-Host "=== Weekly Review ($weekAgo ~ $today) ==="
Write-Host ""

# Weekly commits
Write-Host " COMMITS THIS WEEK ==="
$commits = git log --oneline --since="$weekAgo" --until="$today"
$commits
$commitCount = ($commits | Measure-Object -Line).
Write-Host ""
Write-Host " commits this week: $commitCount"
Write-Host ""

# Commit details format
Write-Host=== DETAILED LOG ==
$log = git --since="$weekA" --until="$today" --format="%h|%ai|%an%s"
$logWrite-Host ""

# Stats
Write-Host=== FILE CHANGE STATS="
$firstCommit = git rev-listmax-parents= HEAD
$stats = git diff --shortstat "$firstCommit^..HEAD" 2>$null
 (-not $stats)    $stats = git diff --shortstat "$firstCommit..HEAD" 2>$null
}
$stats
Write-Host ""

# Total project stats
Writeost "=== TOTAL COMMITS ==="
$total = git rev-list --count HEAD
Write-H "Total commits (all time): $total"
Write-Host ""

# Author contributions this week
Write-Host "=== CONTRIBUTORS THIS WEEK ==="$contributors = git shortlog -sn --since="$weekAgo" --until="$today"
$contributors
