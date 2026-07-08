$srcDir = "E:\PY\CODES\PY_APP\app\src"
$moduleDirs = Get-ChildItem -Path $srcDir -Directory | Sort-Object Name
$results = @()
foreach ($mod in $moduleDirs) {
    $moduleName = $mod.Name
    $tsFiles = Get-ChildItem -Path $mod.FullName -Recurse -Filterts -ErrorAction SilentlyContinue
    $totalFiles = @($tsFiles).Count
    if ($totalFileseq 0) { continue }
    $loggerCount = 0
    $handleCount = 0
    $otelCount = 0
    foreach ($file $tsFiles) {
        $content = Get-Content -Path $file.FName -Raw -ErrorAction SilentlyContinue
        (-not $content) { continue }
        if ($content -match 'import.*Logger|from.*Logger') $loggerCount++ }
 if ($content -matchimport.*[Hh]andleError|from[Hh]andle') { $handleCount++ }
        if ($content -match 'opentelemetry|OpenTelemetry|OTel|@opentelemetry') { $otelCount++ }
    }
    $results += [PSCustomObject]@{
        Module = $moduleName
        Files = $totalFiles
        LoggerFiles = $loggerCount
        LoggerPct = if ($totalFiles -gt 0) { [math]::Round($loggerCount / $totalFiles *100, 1) } else { 0 }
        HandleErrorFiles = $handleCount
        HandlePct = if ($totalFiles -gt 0) { [math]::Round($handleCount / $totalFiles * 100, 1) } else { 0 }
        OTelFiles = $otelCount
        OTelPct = if ($totalFiles -gt 0) { [math]::Round($otelCount / $totalFiles * 100, 1) } else { 0 }
    }
}
$results | Format-Table -AutoSize
$results | Export-Csv -Path "E:\PY\CODES\PY_APP\_co_report.csv" -NoTypeInformation
Write-HostDONE"
