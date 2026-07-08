@echo off
local enabledelayedexpansion
set SRC=E:\PY\CODES\PY_APP\app\src

for /d %%d in (%SRC%\*) do  set MOD=%%~nxd
  set CNT=0
 set LOG=0
  set OTE=0  set HAN=0
  /f "tokens=* %%f in ('dirs /b "%%d\*.ts" 2^>nul') do (
    set /a CNT+=1
    findstr /m "Logger" "%%f" >nul 2>nul && set /a LOG+=1    findstr /mopentelemetry" "%%f" >nul 2>ul && set /aTE+=1
    findstr /m "Error" "%%f >nul 2>nul && set /a HAN+=1
 )
  
  if !CNT! gtr 0 (
 set /a LOGP=!LOG! * 100 / !T!
    set / OTEP=!OTE * 100 / !CNT!
    seta HANP=!HAN! *100 / !CNT!
    echo [!MOD!] files=!CNT!=!LOG!(!LOGP!%%) ote=OTE!(!OTEP!%%) handleError=HAN!(!HANP!%%)
  ) else (
    echo [!MOD!] subdir=!CNT! (no .ts files)
 )
