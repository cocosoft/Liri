# PY_APP 一键启动脚本 (PowerShell版)
# 双击运行即可，首次会自动创建 .env 配置文件

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Set environment variable so the compiled exe knows where the project is
$env:PYAPP_PROJECT_DIR = $ProjectDir

$ExePath = Join-Path $ProjectDir "dist\py_app_coding.exe"
$EnvFile = Join-Path $ProjectDir ".env"

Write-Host "===================================="
Write-Host "        PY_APP is starting..."
Write-Host "===================================="
Write-Host ""

if (-not (Test-Path $ExePath)) {
    Write-Host "[ERROR] Cannot find program file: $ExePath"
    Write-Host "Please make sure py_app_coding.exe is in the dist folder"
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path $EnvFile)) {
    Write-Host "[INFO] Creating .env config file..."
    @"
# PY_APP Configuration
# Get your API key from: https://platform.deepseek.com/api_keys
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

APP_NAME=PY_APP
APP_VERSION=1.0.0

JWT_SECRET=auto_generated_change_me
CORS_ORIGIN=*
NODE_ENV=development
"@ | Out-File -FilePath $EnvFile -Encoding Default
    Write-Host "[DONE] .env file created successfully!"
    Write-Host ""
    Write-Host "[IMPORTANT] Please edit the .env file and set your"
    Write-Host "           DEEPSEEK_API_KEY before using AI features."
    Write-Host "           Get one for free at: https://platform.deepseek.com/api_keys"
    Write-Host ""
}

Set-Location $ProjectDir
Write-Host "[START] Loading program, please wait..."
Write-Host ""

& $ExePath $args

Write-Host ""
Write-Host "===================================="
Write-Host "         Program exited"
Write-Host "===================================="
Read-Host "Press Enter to close"
