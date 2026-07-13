# Get date 7 days ago
$d = (Get-Date).AddDays(-7).ToString("yyyy-MM-dd")
Write-Host "=== WEEKLY_COMMITS ==="
git log --since="$d" --oneline
Write-Host "=== WEEKLY_STATS ==="
git diff --shortstat $(git rev-list --max-parents=0 HEAD)..HEAD
Write-Host "=== WEEKLY_DETAILED ==="
git log --since="$d" --format="%h|%an|%s"
Write-Host "===ONE ==="
