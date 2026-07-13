param([int]$DaysBack = 7)

$repo = "E:\PY\CODES\PY_APP"
Set-Location $repo
$since = (Get-Date).AddDays(-$DaysBack).ToString("yyyy-MM-dd")
$ = (Get-Date).ToString("yyyy-MM-ddWrite-Host "=============================================="
Writeost "     Liri 周回顾"
Write-H "    周期: $ 至 $until"
-Host "=========================================="
Write-Host ""

# 1. Total commits this week
-Host "=== 📊 本周提交数 ==="
$count = & git rev-list --count HEAD --after="$since" --before="$until" 2>$null
 (-not $count) $count = 0 }
Write-Host "本周提交: $count"
Write-Host ""

# 2. Commits list
Write-Host "=== 📝 提交列表 ==="
& git log --oneline --after="$since" --before="$until" 2>$null
Write-Host ""

# 3. Detailed commits
Write-Host "=== 📋 提交详情 ==="
& git log --after="$since" --before="$until" --format="%h | %ai | %an | %s" 2>$null
Write-Host ""

# 4. Authors
Write-Host "=== 👤 贡献者 ==="
& git log --after="$since" --before="$until" --format="%an" 2>$null | Sort-Object -Unique
Write-Host ""

# 5. Changes stats
Write-Host "=== 📁 变更统计 ==="
$firstHash = & git log --after="$since" --before="$until" --format="%H" --reverse 2>$null | Select-Object -First 
if ($firstHash {
    & git diff --shortstat "$firstHash)^..HEAD" 2>$null
    Write-Host ""
    Write-Host "涉及文件:"
    & git diff --name-only "$($firstHash)^..HEAD" 2>$null
} else {
    Write-Host "本周无提交"
}
Write-Host ""

# 6. Overall project stats
Write-Host "=== 🌐 项目总览 ==="
Write-Host "总提交数: $(git rev-list --count HEAD)"
$totalFiles = & git ls-f 2>$null | Measure-Object | Select- -ExpandProperty Count
Write-Host "跟踪文件数: $totalFiles"
Write-Host ""

Write-Host "=============================================="
