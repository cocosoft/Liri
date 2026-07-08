$srcDir = "E:\PY\CODES\PY_APP\app\src"
$modules = Get-ChildItem -Path $srcDirDirectory | Sort-Object
Write-Host " 模块覆盖率分析 ==
Write-Host ": $srcDir"
Write-Host "模块总数: $($modules.Count)"
Write-Host ""
Write-Host "模块名称`tTS文件数`tLogger`tHandleError`tOTel/Telemetry"

$summary = @()
 ($mod in $modules) {
    $tsFiles = Get-ChildItem - $mod.FullName -Recurse -Filter "ts" -File
 $fileCount = $tsFiles.Count
    if ($fileCount -eq 0) { continue }
    
    $loggerCount = 
    $handleErrorCount = 0
    $otelCount = 0
    
    foreach ($f in $tsFiles) {
        $content = Get-Contentf.FullName -Raw -ErrorAction Silently
        if (-notcontent) { continue }
        if ($content -match "import.*Logger|fromLogger|require.*Logger") $loggerCount++ }
        if ($content -matchhandleError|HandleError|handle_error") {handleErrorCount++ }
 if ($content -matchopentelemetry|OTel|OpenTelemetry|@opentele") { $otelCount }
    }
    $modName = $mod.Name
    Write-HostmodName`t$fileCount`t$Count`t$handleErrorCount`t$otelCount"
    $summary += [PSCustomObject]@{
        Module = $modName
        Files = $fileCount
        LoggerCoverage = $loggerCount
        HandleCoverage = $handleCount
        OTelCoverage = $otelCount
    }
}

Write-Host ""
Write-Host "=== 缺失分析 ==="Write-Host "`--- 可能有Logger缺失的大模块（>5个文件, 0次Logger） ---"
$summary | Where-Object { $_.Files -gt 5 -and $_.LoggerCoverage -eq 0 } | Format-Table -AutoSize

Write-Host`n--- 可能有Error缺失的大模块（>5个文件, 0次HandleError使用）"
$summary | WhereObject { $_.Files -gt 5 -and_.HandleErrorCoverageeq 0 } | Format-Table -AutoSize

Write-Host "`n--- 可能有OTel的大模块（>5个文件, 0次OTel使用） ---"
$summary | Where-Object { $_.Files -gt 5 -and $_.OTelCoverage -eq 0 } | FormatTable -AutoSize

Write-Host "`n=== 全部模块明细 ==="
$summary | Format-Table -AutoSize

# Save to file
$ | Export-Csv - "E:\PY\CODES\PY_APP\_coverage.csv" -NoTypeInformation
Write-Host "n报告已保存到 E:\PY\CODES\PY_APP\_verage_report.csv"
