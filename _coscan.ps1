$srcDir = "E:\PY\CODES\PY_APP\app\src"
$outFile = "EPY\CODES\PY_APP\_coverage_report.txt"
$moduleDirs = Get-ChildItem -Path $srcDir - | Sort-Object Name

$reportLines = @()
$reportLines += "============================================"
$reportLines += "  模块覆盖率分析报告 - Logger / OTel / HandleError$reportLines += "============"
$reportLines += "总模块: $($moduleDirs.Count)"
$reportLines ""

$moduleResults @()

foreach ($mod in $moduleDirs)    $modName =mod.Name
    $ = Get-ChildItemPath $mod.FullName -Filter "*.ts -Recurse -File
    $fileCount =files.Count
    if ($fileCount -eq ) { continue }

   loggerCount = 0
    $otelCount = 0
    $errorCount = 0
   loggerFiles = @()
    $otelFiles = @    $errorFiles =()

    foreach ($f $files) {
       content = Get-ContentPath $f.Full -Raw -ErrorActionentlyContinue
        ifnot $content) { continue }
        
        if ($ -match "import.*Logger|from.*Logger") {
            $Count++
            $loggerFiles += $f.Name
        }
        if ($content -match "opentelemetry|Telemetry|@entelemetry")            $otelCount++
 $otelFiles += $.Name
        }
        if ($content -match "handleError|HandleError") {
            $errorCount++
            $errorFiles += $f.Name
        }
    }

    $moduleResults += [PSCustomObject]@{
        Module = $modName
        Files = $fileCount
        Logger $loggerCount
       Tel = $otel
        HandleError =errorCount
        LoggerFiles = $loggerFiles -join ", "
        OTelFiles = $otelFiles - ", "
        ErrorFiles = $errorFiles -join ", "
    }
}

$ = $moduleResults | Format-Table Module, Files, Logger, OTel, HandleError -AutoSize | Out-String -Width 120
$reportLines += $table

$reportLines += ""
$reportLines += "===缺失分析 ==="
$reportLines += ""

$reportLines += "--- 缺失 Logger 的模块 ---"
$loggerMissing = $moduleResults | Where-Object { $_.Logger -eq 0 }
foreach ($m in $loggerMissing) {
    $reportLines += "  $($m.Module) ($($m.Files) files)"
}

$reportLines += ""
$reportLines += "--- 缺失 OTel/OpenTelemetry 的模块 ---"
$otelMissing = $moduleResults | Where-Object { $_.OTel -eq 0 }
foreach ($m inotelMissing) {
    $reportLines += "  $($m.Module) ($($m.Files) files)"
}

$reportLines += ""
$reportLines += "--- 缺失 HandleError 的模块 ---"
$errorMissing = $moduleResults | Where-Object { $_.HandleError -eq 0 }
foreach ($m in $errorMissing) {
    $reportLines += " $($m.Module) ($($m.Files) files)"
}

$reportLines | Out-File $outFile -Encoding UTF8
Write-Host "分析完成！报告已保存到 $outFile"
