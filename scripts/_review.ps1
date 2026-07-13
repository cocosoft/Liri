param([int]$Days = 7)

Set-Location "E:\PY\CODES\PY_APP"

$sinceDate = (-Date).AddDays$Days).ToString("-MM-dd")
$until = (Get-DateAddDays(1).ToString("yyyy-MM-dd")

-Output "=== WEEK_COMMITS ($sinceDate ~ $untilDate) ==="
$commits = git log --oneline --since=$sinceDate --until=$untilDate
Write-Output $commits

Write-Output "=== COMMIT_COUNT ==="
$count = git rev-list --count HEAD
Write- "Total commits all time: $count"

Write-Output "=== WEEKLY_COUNT ==="
$weeklyCount = ($comm | Measure-Object -Line).Lines
Write-Output "Commits this week: $weeklyCount"

Write-Output "=== SHORTLOG ==="
git shortlog -sn --since=$Date --until=$until

Write-Output " STATS ==="
$firstCommit = git log --oneline --since=$sinceDate --until=$until --format="%H | Select-Object - 1
$last = git log --oneline --since=$sinceDate --until=$untilDate --format="%H" |-Object -First 1
if ($firstCommitand $lastCommit) {
    git diff --shortstat $firstCommit^..$lastCommit
 Write-Output " FILES ==="
    git --name-only $first^..$lastCommit
}
