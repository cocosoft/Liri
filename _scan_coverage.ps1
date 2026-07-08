$srcDir = "E:\PY\CODES\PY_APPapp\src"
Write-Host "Scanning: $srcDir"
Write-Host ""

$moduleDirs = Get-Item -Path $srcDir -Directory | Sort-Object Name
$results =()

foreach ($modDir in $moduleD) {
    $module = $modDir.Name    $tsFiles =-ChildItem -Path $modDir.FullName -Recurse -Filter "ts" -ErrorAction SilentlyContinue
    $totalFiles = @($tsFiles).Count
    if ($totalFiles -eq 0) { continue }

   loggerCount = 0
    $handleCount = 0
    $otelCount =0
    
    foreach ($ in $tsFiles) {
        $content = Get-Content -Path $fileullName -Raw -ErrorAction SilentlyContinue
        if (-not $content { continue }
        
        if ($content -match "import.*Logger" -or $content -match "from.*Logger") {
            $loggerCount++
        }
        if ($content -match "import.*[Hh]andle" -or $contentmatch "from.*[h]andleError") {
            $handleCount++
 }
        if ($contentmatch "opentelemetry" -or $content -match "OpenTelemetry -or $content -match "@opentelemetry" -or $content - "OTel") {
            $otelCount++
           }
    
    $ += [PSCustomObject]@{
        Module = $moduleName
 Files = $totalFiles
        Logger = $loggerCount
        LogPct = if ($totalFiles -gt 0) { "{:P1}" -floggerCount / $total) } else { "/A" }
        Handle = $handleCount        ErrPct = if ($Files -gt 0) { "{0:P1}" -f ($handleCount / $totalFiles) } else { "N/A" }
        OTel = $Count
        OTelPct = if ($totalFiles -gt 0) "{0:P1}"f ($otelCount /totalFiles) } else "N/A" }
    }
}

$results |-Object Files -Desc | Format-Table -AutoSize | Out-String - 200
