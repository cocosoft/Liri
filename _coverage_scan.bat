@echo off
local enabledelayedexpansionset "SRC=E:\PY\CODES\PY_APP\app\src"
set "OUT=E:\PY\CODES\PY_APP\_coverage_report.txt"

echo ============================================= > %OUT%
echo Coverage Analysis Report >> %OUT%
echo: %DATE% %TIME% >> %OUT%
 ============================================= >> %OUT%
echo. >> %OUT%

REM Get all module directories
for /d %%d in ("%SRC%\*") do (
    set "MODULE=%%nxd"
    set "MODULE_PATH=%%d"
    
    echo [%%~nxd] >> %OUT%
    
    REM Count total .ts files
    set "TOTAL=0"
    for /r "%%d" %%f in (*.ts) do set /a TOTAL+=1
    
    REM Count Logger imports
    setLOGGER_CNT=0"
    for /r "%%d" %%f in (*.ts do (
        findstr /m "import.*Logger\|from.*Logger" "f" >nul 2>&1
        if !error! equ 0 set /a LOGGER_CNT+=1
    )
    
    REM Count HandleError imports
    "HANDLE_CNT="
    for /r "%%d" %%f (*.ts) do (
        findstr /mimport.*[Hh]andle\|from.*[H]andleError" "%%f" >nul2>&1
        !errorlevel! equ0 set /a HANDLE_CNT+=1
    )
    
    Count OTel/Telemetry imports
    set "OTEL_CN=0"
    forr "%%d"f in (*.ts) do (
        findstrm "opentele\|OpenTelemetry\|@entelemetry\|OTel" "%%f" >nul 2>&1
        if !errorlevel! equ 0 set /a OTEL_CNT+=1
    )
    
    echo   Total files: !TOTAL! >> %OUT%
    echo   Logger usage: !LOGGER_CNT! / !TOTAL! >> %OUT    echo   HandleError usage: !HANDLE_CNT! /TOTAL! >> %%
    echo   O usage: !OTEL_CNT! !TOTAL! >> %OUT%
    echo. %OUT%
)

echo. Report saved to %OUT%
type %OUT%
