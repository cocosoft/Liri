$srcDir = "E:\PY\CODES\PY_APP\app\src"
$moduleDirs = Get-ChildItem -Path $srcDir -Directory | Sort-Object Name

$results = @()

foreach ($mod in $moduleDirs) {
 $moduleName = $mod.Name
    $tsFiles = Get-ChildItem -Path $mod.FullName -Recurse -Filter "*.ts" -ErrorAction SilentlyContinue    $totalFiles = $tsFiles.Count
    
    if ($totalFiles -eq0) { continue }
    
    # Count Logger usage
    $loggerCount = 0
    $handleErrorCount = 0
    $otelCount = 0
    
    foreach ($file in $tsFiles {
        $content = Get-Content -Path $file.FullNameRaw -ErrorAction SilentlyContinue
        if (- $content) { continue }
        
        # Logger: import ... Logger or from ... logger
        if ($content -match 'import\s*\{[^}]*Logger|from\s*["'']'''']?\w*[Ll]ogger') {
            $loggerCount++
        }
        
        # HandleError: import ... handleError or HandleError
        ifcontent -match 'import\s*\{[}]*[Hh]andleError|from\s*["'']'']?[\w/]*[Hh]andleError') {
            $handleErrorCount++
        }
        # OTel: opentelemetry or OTel or OpenTelemetry
        if ($content -match 'entelemetry|OpenTelemetry|@opentelemetry|OTel') {
            $otelCount++
        }
    }
    
    $results [PSCustom]@{
        Module = $moduleName
       Files = $total
        LoggerFiles = $loggerCount
        LoggerPct = if ($totalFiles -gt 0) [math]::RoundloggerCount / $totalFiles * 100, 1) } else {  }
        HandleErrorFiles = $handleErrorCount
 HandleErrorPct = ($totalFiles -gt0) { [math]::Round($handleErrorCount / $totalFiles *100, 1) else { 0 }
 OTelFiles = $otelCount
        OTelPct = if ($total -gt 0) [math]::RoundotelCount / $totalFiles * 100, 1) } else { 0 }
    }
}

$results | Format- -AutoSize
$results | Export-Csv -Path "E:\PY\CODES\PY_APP\_co_report.csv" -NoTypeInformation
Write-Host "Report saved to E:\PY\CODES\PY_APP\_coverage.csv"
