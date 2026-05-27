@echo off
title PY_APP

set "PROJECT_DIR=%~dp0"

:: Remove trailing backslash to avoid \" being interpreted as escaped quote
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

:: Set environment variable so the compiled exe knows where the project is
set "PYAPP_PROJECT_DIR=%PROJECT_DIR%"

set "EXE_PATH=%PROJECT_DIR%\dist\py_app_coding.exe"

echo ====================================
echo         PY_APP is starting...
echo ====================================
echo.

if not exist "%EXE_PATH%" (
    echo [ERROR] Cannot find program file: %EXE_PATH%
    echo Please make sure py_app_coding.exe is in the dist folder
    pause
    exit /b 1
)

:: Ensure the data directory exists before launching (compile exe may have path issues)
if not exist "%PROJECT_DIR%\app\data" (
    mkdir "%PROJECT_DIR%\app\data" > nul 2>&1
)

if not exist "%PROJECT_DIR%\.env" (
    echo [INFO] Creating .env config file...
    (
        echo # PY_APP Configuration
        echo # Get your API key from: https://platform.deepseek.com/api_keys
        echo DEEPSEEK_API_KEY=your_api_key_here
        echo DEEPSEEK_BASE_URL=https://api.deepseek.com
        echo DEEPSEEK_MODEL=deepseek-chat
        echo.
        echo APP_NAME=PY_APP
        echo APP_VERSION=1.0.0
        echo.
        echo JWT_SECRET=auto_generated_change_me
        echo CORS_ORIGIN=*
        echo NODE_ENV=development
    ) > "%PROJECT_DIR%\.env"
    echo [DONE] .env file created successfully!
    echo.
    echo [IMPORTANT] Please edit the .env file and set your
    echo            DEEPSEEK_API_KEY before using AI features.
    echo            Get one for free at: https://platform.deepseek.com/api_keys
    echo.
)

cd /d "%PROJECT_DIR%"
echo [START] Loading program, please wait...
echo.

:: Pass --project-dir as command line argument (most reliable way for compiled exe)
"%EXE_PATH%" --project-dir "%PROJECT_DIR%" %*

echo.
echo ====================================
echo         Program exited
echo ====================================
pause
