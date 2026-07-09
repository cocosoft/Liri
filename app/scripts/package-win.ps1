<#
.SYNOPSIS
    Liri Windows packaging script - Build + bundle nssm + external deps + installer
.DESCRIPTION
    Compiles Liri to Windows exe and bundles nssm, external dependencies,
    and install scripts into a distributable ZIP package.

    Usage:
        .\package-win.ps1                    # Default (coding variant)
        .\package-win.ps1 -Variant personal   # Personal variant

    Parameters:
        -Variant      Build variant: core / personal / coding / enterprise
        -OutDir       Output directory (default: ../dist/pkg)
        -NoBuild      Skip build, only package existing artifacts
        -NoZip        Skip ZIP creation, only prepare output directory
.NOTES
    Author: Liri Team
#>

param(
    [ValidateSet('core', 'personal', 'coding', 'enterprise')]
    [string]$Variant = 'coding',

    [string]$OutDir = '',

    [switch]$NoBuild,

    [switch]$NoZip
)

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir    = Resolve-Path (Join-Path $ScriptDir '..')
$ProjectDir = Resolve-Path (Join-Path $AppDir '..')
$DistDir     = Join-Path $ProjectDir 'dist'
$DefaultOut  = Join-Path $DistDir 'pkg'

if (-not $OutDir) { $OutDir = $DefaultOut }
$ServiceName = 'LiriAI'
$ExeName     = 'liri.exe'

function Write-Step($msg) {
    Write-Host "========================================" -ForegroundColor DarkCyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor DarkCyan
}

function Write-OK($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-ErrorMsg($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}

# Step 1: Build application
function Step-Build {
    Write-Step 'Step 1/4: Building application'

    if ($NoBuild) {
        Write-OK 'Skipping build (--NoBuild)'
        return
    }

    Push-Location $AppDir
    try {
        Write-Host "Building variant: $Variant"
        $env:LIRI_BUILD_VARIANT = $Variant
        bun run scripts/build-variant.ts --variant=$Variant 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'build-variant failed' }

        Write-Host 'Compiling Windows exe...'
        $outputExe = Join-Path $DistDir $ExeName
        bun build --compile `
            --target=bun-windows-x64-modern `
            --external pdfjs-dist `
            --external sharp `
            --external sqlite3 `
            --external bindings `
            --external file-uri-to-path `
            --outfile $outputExe `
            src/pyapp.ts 2>&1

        if ($LASTEXITCODE -ne 0) { throw 'bun build failed' }

        bun run scripts/copy-external-deps.ts 2>&1
        Write-OK "Build complete: $outputExe"
    }
    finally {
        Pop-Location
    }
}

# Step 2: Prepare package directory
function Step-PreparePackage {
    Write-Step 'Step 2/4: Preparing package directory'

    # Clean old output
    if (Test-Path $OutDir) {
        Remove-Item -Path $OutDir -Recurse -Force
    }

    # Create directory structure
    $dirs = @(
        $OutDir,
        (Join-Path $OutDir 'logs'),
        (Join-Path $OutDir 'nssm')
    )
    foreach ($dir in $dirs) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # 1. Copy exe
    $srcExe = Join-Path $DistDir $ExeName
    if (-not (Test-Path $srcExe)) {
        $fallbacks = @('py_app.exe', 'liri_coding.exe')
        foreach ($fb in $fallbacks) {
            $fbPath = Join-Path $DistDir $fb
            if (Test-Path $fbPath) {
                $srcExe = $fbPath
                break
            }
        }
    }

    if (-not (Test-Path $srcExe)) {
        Write-ErrorMsg "Compiled exe not found: $srcExe"
        exit 1
    }

    $targetExe = Join-Path $OutDir $ExeName
    Copy-Item -Path $srcExe -Destination $targetExe -Force
    Write-OK "Copied exe: $targetExe"

    # 2. Copy nssm
    $nssmSrc = Join-Path $AppDir 'scripts\nssm\nssm.exe'
    $nssmDst = Join-Path $OutDir 'nssm\nssm.exe'
    if (Test-Path $nssmSrc) {
        Copy-Item -Path $nssmSrc -Destination $nssmDst -Force
        Write-OK "Copied nssm: $nssmDst"
    } else {
        Write-ErrorMsg "nssm.exe not found: $nssmSrc"
        exit 1
    }

    # 3. Copy external dependencies（copy-external-deps 输出到 dist/deps/）
    $distDeps = Join-Path $DistDir 'deps'
    if (Test-Path $distDeps) {
        $targetDeps = Join-Path $OutDir 'deps'
        Copy-Item -Path $distDeps -Destination $targetDeps -Recurse -Force
        Write-OK "Copied external deps: $targetDeps"
    } else {
        Write-ErrorMsg "External deps not found: $distDeps (run copy-external-deps.ts first)"
    }

    # 4. Copy config and docs
    $appConfig = Join-Path $AppDir 'config'
    if (Test-Path $appConfig) {
        $targetConfig = Join-Path $OutDir 'config'
        Copy-Item -Path $appConfig -Destination $targetConfig -Recurse -Force
        Write-OK "Copied config: $targetConfig"
    }

    $appDocs = Join-Path $AppDir 'docs'
    if (Test-Path $appDocs) {
        $targetDocs = Join-Path $OutDir 'docs'
        Copy-Item -Path $appDocs -Destination $targetDocs -Recurse -Force
        Write-OK "Copied docs: $targetDocs"
    }

    # 5. Copy .env.example
    $envExample = Join-Path $AppDir '.env.example'
    if (Test-Path $envExample) {
        Copy-Item -Path $envExample -Destination (Join-Path $OutDir '.env.example') -Force
        Write-OK 'Copied .env.example'
    }

    # 5. Copy install script
    $installScript = Join-Path $ScriptDir 'install-nssm-service.ps1'
    if (Test-Path $installScript) {
        Copy-Item -Path $installScript -Destination (Join-Path $OutDir 'install-service.ps1') -Force
        Write-OK 'Copied install script'
    }

    Write-OK "Package directory ready: $OutDir"
}

# Step 3: Create installer batch file
function Step-CreateInstaller {
    Write-Step 'Step 3/4: Creating installer batch file'

    $batLines = @(
        '@echo off',
        'chcp 65001 >nul',
        'title Liri AI Setup',
        '',
        'echo ========================================',
        'echo   Liri AI Windows Setup',
        'echo ========================================',
        'echo.',
        '',
        'net session >nul 2>&1',
        'if %errorlevel% neq 0 (',
        '    echo [ERROR] Please run as Administrator!',
        '    echo.',
        '    pause',
        '    exit /b 1',
        ')',
        '',
        'set "SCRIPT_DIR=%~dp0"',
        'set "NSSM=%SCRIPT_DIR%nssm\nssm.exe"',
        'set "EXE=%SCRIPT_DIR%liri.exe"',
        'set "SERVICE_NAME=LiriAI"',
        '',
        'echo [..] Checking components...',
        'if not exist "%EXE%" (',
        '    echo [ERROR] liri.exe not found.',
        '    pause',
        '    exit /b 1',
        ')',
        'if not exist "%NSSM%" (',
        '    echo [ERROR] nssm.exe not found.',
        '    pause',
        '    exit /b 1',
        ')',
        'echo [OK] All components found.',
        'echo.',
        '',
        ':menu',
        'echo Select operation:',
        'echo.',
        'echo   [1] Install and start Liri service',
        'echo   [2] Start service',
        'echo   [3] Stop service',
        'echo   [4] Restart service',
        'echo   [5] Uninstall service',
        'echo   [6] View service status',
        'echo   [0] Exit',
        'echo.',
        'set /p choice="Enter number (0-6): "',
        '',
        'if "%choice%"=="1" goto install',
        'if "%choice%"=="2" goto start',
        'if "%choice%"=="3" goto stop',
        'if "%choice%"=="4" goto restart',
        'if "%choice%"=="5" goto uninstall',
        'if "%choice%"=="6" goto status',
        'if "%choice%"=="0" goto end',
        '',
        'echo Invalid input.',
        'echo.',
        'goto menu',
        '',
        ':install',
        'echo.',
        'echo [..] Installing Liri Windows service...',
        '"%NSSM%" install %SERVICE_NAME% "%EXE%" >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% DisplayName "Liri AI Backend Service" >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% Description "Liri - Your AI Personal Assistant" >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppDirectory "%SCRIPT_DIR%" >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% Start SERVICE_AUTO_START >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppStdout "%SCRIPT_DIR%logs\liri-stdout.log" >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppStderr "%SCRIPT_DIR%logs\liri-stderr.log" >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppRotateFiles 1 >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppRotateOnline 1 >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppRotateSeconds 86400 >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppExit Default Restart >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppRestartDelay 5000 >nul 2>&1',
        '"%NSSM%" set %SERVICE_NAME% AppEnvironmentExtra LIRI_SERVICE_MODE=1 >nul 2>&1',
        '"%NSSM%" start %SERVICE_NAME% >nul 2>&1',
        'if %errorlevel% equ 0 (',
        '    echo [OK] Liri service installed and started!',
        '    echo.',
        '    echo Service Name: %SERVICE_NAME%',
        '    echo Manage in: services.msc',
        ') else (',
        '    echo [ERROR] Installation failed.',
        ')',
        'echo.',
        'pause',
        'goto end',
        '',
        ':start',
        '"%NSSM%" start %SERVICE_NAME%',
        'if %errorlevel% equ 0 (echo [OK] Started) else (echo [ERROR] Failed)',
        'echo.',
        'pause',
        'goto end',
        '',
        ':stop',
        '"%NSSM%" stop %SERVICE_NAME%',
        'if %errorlevel% equ 0 (echo [OK] Stopped) else (echo [ERROR] Failed)',
        'echo.',
        'pause',
        'goto end',
        '',
        ':restart',
        '"%NSSM%" restart %SERVICE_NAME%',
        'if %errorlevel% equ 0 (echo [OK] Restarted) else (echo [ERROR] Failed)',
        'echo.',
        'pause',
        'goto end',
        '',
        ':uninstall',
        'echo.',
        'echo [..] Uninstalling...',
        '"%NSSM%" stop %SERVICE_NAME% >nul 2>&1',
        '"%NSSM%" remove %SERVICE_NAME% confirm',
        'if %errorlevel% equ 0 (echo [OK] Uninstalled) else (echo [ERROR] Failed)',
        'echo.',
        'pause',
        'goto end',
        '',
        ':status',
        '"%NSSM%" status %SERVICE_NAME%',
        'sc query %SERVICE_NAME% | findstr STATE',
        'echo.',
        'pause',
        'goto end',
        '',
        ':end',
        'exit /b 0'
    )

    $batContent = $batLines -join "`r`n"
    $batPath = Join-Path $OutDir 'install.bat'
    $batContent | Out-File -FilePath $batPath -Encoding utf8 -Force
    Write-OK "Installer batch created: $batPath"
}

# Step 4: Create ZIP package
function Step-CreateZip {
    Write-Step 'Step 4/4: Creating ZIP distribution package'

    if ($NoZip) {
        Write-OK 'Skipping ZIP (--NoZip)'
        return
    }

    $zipName = "LiriAI-Windows-$Variant-v0.4.25.zip"
    $zipPath = Join-Path $DistDir $zipName

    if (Test-Path $zipPath) {
        Remove-Item -Path $zipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $zipPath)

    Write-OK "ZIP package created: $zipPath"
}

# Display package content
function Show-PackageContent {
    Write-Step 'Package content'

    Write-Host "Output directory: $OutDir"
    Write-Host ''

    $items = Get-ChildItem -Path $OutDir -Recurse | Where-Object { -not $_.PSIsContainer }
    $totalSize = 0
    foreach ($item in $items) {
        $sizeKB = [math]::Round($item.Length / 1KB, 1)
        $totalSize += $item.Length
        $relPath = $item.FullName.Substring($OutDir.Length + 1)
        Write-Host ("  {0,8} KB  {1}" -f $sizeKB, $relPath)
    }

    $totalMB = [math]::Round($totalSize / 1MB, 2)
    Write-Host ''
    Write-Host "Total size: $totalMB MB"
    Write-Host ("File count: {0}" -f $items.Count)
}

# Main
function Main {
    Write-Host ''
    Write-Host '========================================' -ForegroundColor DarkCyan
    Write-Host '  Liri Windows Package Tool' -ForegroundColor Cyan
    Write-Host ('  Variant: {0}' -f $Variant) -ForegroundColor Cyan
    Write-Host '========================================' -ForegroundColor DarkCyan

    Step-Build
    Step-PreparePackage
    Step-CreateInstaller
    Step-CreateZip
    Show-PackageContent

    Write-Host ''
    Write-OK 'All done!'
    Write-Host ''
    Write-Host 'Instructions:'
    Write-Host ('  1. Extract LiriAI-Windows-{0}-v0.4.25.zip' -f $Variant)
    Write-Host '  2. Right-click install.bat and select Run as Administrator'
    Write-Host '  3. Select [1] Install and start Liri service'
    Write-Host ''
    Write-Host 'Or use PowerShell:'
    Write-Host '  .\install-service.ps1 install'
    Write-Host '  .\install-service.ps1 status'
    Write-Host '  .\install-service.ps1 uninstall'
    Write-Host ''
}

Main
