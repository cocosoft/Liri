$srcDir = "E:\PY\CODES\PY_APP\\src"
$moduleirs = Get-Item -Path $srcDir -Directory | Sort- Name

Write-Host "=== 模块目录列表 ==="
 ($m in $moduleirs) {
    Writeost "  $($.Name)"
}
Write-Host ""

Write-Host "=== 各模块 Logger / HandleError / OTel  使用情况 ==="
-Host ""

$results = @()

foreach ($ in $moduleDirs) {
    $modPath = $mod.FullName    $tsFiles = Get-ChildItem -PathmodPath -Recurse -Filter "ts" -ErrorAction SilentlyContinue    $tsCount = ($tsFiles | Measure-Object).Count

    $loggerCount = 0
    $handleErrorCount = 0
    $otelCount = 0
    $loggerFiles = @()
    $handleErrorFiles = @()
 $otelFiles = @    foreach ($f intsFiles) {
       content = Get-ContentPath $f.FName -Raw -ErrorAction SilentlyContinue
        if (-not $content) { continue }
        $relPath = $f.FullName.Substring($srcDir.Length 1)

        if ($content -match 'importLogger|from.*Logger') {
            $loggerCount            $loggerFiles += $relPath
        }
        if ($content -match 'handleError|HandleError') {
            $ErrorCount++
            $ErrorFiles += $rel
        }
        if ($content -match 'oplemetry|OTel|OpenTelemetry {
            $otel++
            $otelFiles += $relPath        }
    }

    $results += [PSCustomObject]@{
        = $mod.Name
 TsFiles = $tsCount
        LoggerCount = $logger
        HandleErrorCount = $handleCount
        OTelCount = $Count
        LoggerFiles = ($loggerFiles -join "; ")
        HandleError = ($handleErrorFiles -join "; ")
        OFiles = ($otelFilesjoin "; ")
    }
}

# 输出表格
Write-Host ("{0,-18} {1,} {2,} {3,12} {4,12}" -f "Module "TS Files", "Logger",HandleError", "OT")
Write-Host ("{0,-18}1,8} {,10} {3,12} {4,}" -f "-----------------", "--------", "----------", "------------", "----------")
foreach ($r in $results)    Write-Host ("{0,-18} {1,8} {210} {3,12} {4,12}" -f $r.Mod, $r.TsFiles, $rCount, $r.HErrorCount, $r.OTelCount)
}
Write-Host ""

# 详细输出 - Logger 缺失的模块
Write-Host "=== Logger 缺失或覆盖率极低的模块 (Logger/TSFiles < %) ==="
foreach ($r in $results {
    if ($rsFiles -eq ) { continue }
    $ratio = [math]::Round($.LoggerCount / $rsFiles * 100, 1)
    if ($ratio -lt 50 {
        Write-Host  $($r.Module Logger $($r.LoggerCount)/$($r.TFiles) = $ratio%"
    }
}

Write-Host ""
Write-Host " HandleError 缺失或覆盖率极低的模块 (HandleError/TSFiles < 30%) ==="
foreach ($r in $results) {
    if ($.TsFiles -eq0) { continue }
    $ratio = [math]::Round($r.HErrorCount / $r.TsFiles * 100, 1)
    if ($ratio -lt 30 {
        Write-Host "  $($r.Mod): HandleError $($.HandleErrorCount)/($r.TsFiles = $ratio%"
    }
}

Write-Host ""
Write-Host "===Tel 使用为零的模块 ==="foreach ($r in $results) {
    if ($r.TsFiles -eq 0) { continue }
    ($r.OTelCount -eq 0) {
        Write-Host "  $($r.Module 0/$($r.Ts)"
    }
}

# 详细文件列表：所有 Logger 文件
Write-Host ""
Write-Host "=== 详细：所有引用 Logger 的文件 ==
foreach ($r inresults) {
    ifr.LoggerFiles.Length -gt 0 {
        Write-Host "--- $($r.Module) ($($r.Logger)) ---"
        $.LoggerFiles.Split("; ") | ForEach-Object { Write-Host    $_" }
    }
}

Write-Host ""
Writeost "=== 详细所有引用 HandleError  ==="
foreach ($r in $results) {
    if ($r.HandleFiles.Length -gt0) {
        Writeost "--- $($r.Module) ($($.HandleErrorCount))"
        $r.HandleErrorFiles.Split("; ") | ForEach-Object Write-Host "    $_" }
    }
}

Write-Host ""
Write-Host "=== 详细：引用 OTel 的文件="
foreach ($r in $results) {
    ($r.OTel.Length -gt 0 {
        Write-Host "--- $($r.Module) ($($r.elCount)) ---"
 $r.OTelFiles.Split("; ") |Each-Object { Writeost "    $_"    }
}
