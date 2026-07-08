@echo off
setlocal enabledelayedexpansion

 SRC=E:\PYCODES\PY_APP\app\src

echo ========================================
echo Module Coverage Analysis
echo ========
echo.

for /d %%d in ("%SRC%\*") do (
  set "mod=%%~nxd"
  set "_count=0"
  
  rem Count .ts files in the module
  for /f %%c in ('dir /s /b "%%d\*.ts" ^>nul ^ find /c /v') do set ts_count=%%c
  
  if !ts_count! gtr 0 (
    rem Logger imports
    set "logger=0"
    for /f %%c in ('findstr /m /i "import.*Logger\|from.*Logger" "%%d\*.ts" 2^>ul ^| find /c /v ""') do set logger=%%c
    
    rem handleError imports
    set "hndl=0"
    /f %%c infindstr /m /i "import.*handleError\|import.*HandleError\|from.*handleError\|.*HandleError" "%%d\*.ts 2^>nul ^| find /cv ""') do set hndl=%%c    rem OTel references
    set "otel=0"
    for /f %%c in ('findstr /m /iopentelemetry\|OpenTelemetry\|@opentelemetry\|OTel\|Telemetry" "%%d\*.ts" 2^>nul ^| find /c /v ""') do set otel=%%c
    
    echo Module: !mod! (!ts_count! files)
    echo   Logger: !logger! files
    echo   HandleError: !hndl! files
    echo   OTel: !otel! files
    echo.
  )
)

echo ========================================
echo Summary: Modules with LOW coverage
echo ========================================
echo.

for /d %%d in ("%SRC%\*") do (
  "mod=%%~xd"
  set "ts_count=0"
 set "logger=0  set "hnd=0"
  set "otel=0"
  
  for /f %%c in ('dirs /b "%%d\*.ts" 2^>nul| find /c /v ""') set ts_count=%%
  
  if !ts_count! gtr 0 (
    for /f %%c in ('findstr /m /iimport.*Logger\|from.*Logger" "%%d\*.ts" ^>nul ^ find /c /v ""') do set logger=%%c
    for /f %%c in ('findstr /m /i ".*handleError\|import.*HandleError\|from.*handleError\|fromHandleError" "%%\*.ts" 2^>nul ^ find /c /v ""') do set hndl=%%c
    for /f %%c in ('findstr /m /i "opentelemetry\|OpenTelemetry\|@opentelemetry\|OTel\|Telemetry" "%%d\*.ts" 2^>nul ^| find /c /v ""') do set otel=%%c
    
    if !ts_count! geq 3 (
      if !logger!==0 echo WARNING !mod!: NO Logger usage (!ts_count! files)
      if !hndl!==0 echo WARNING !mod!: NOError usage (!ts_count! files)
      if !otel!== echo WARNING !mod!: NO OTel usage (!ts_count! files)
    )
  )
)

.
echo Done.
