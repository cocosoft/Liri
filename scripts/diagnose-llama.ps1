# diagnose-llama.ps1 - llama.cpp service diagnostic script
# Usage: powershell -File scripts/diagnose-llama.ps1
# Features: Check llama-server process, health, slots, logs

param(
  [string]$TargetHost = "127.0.0.1",
  [int]$Port = 11435,
  [int]$LogLines = 100
)

$ErrorActionPreference = "Continue"
$logDir = Join-Path $env:USERPROFILE ".pyapp\logs"
$logFile = Join-Path $logDir "llama-server.log"

Write-Host "===== llama.cpp Diagnostic Tool =====" -ForegroundColor Cyan
Write-Host ""

# 1. Check process
Write-Host "[1] Checking llama-server process..." -ForegroundColor Yellow
$procs = Get-Process -Name "llama-server" -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host "  [OK] Running:" -ForegroundColor Green
  $procs | ForEach-Object {
    $uptime = (Get-Date) - $_.StartTime
    $memMB = [Math]::Round($_.WorkingSet64 / 1MB, 1)
    $upMin = [Math]::Round($uptime.TotalMinutes, 1)
    Write-Host "    PID=$($_.Id) | CPU=$($_.CPU)s | Mem=$memMB MB | Uptime=$upMin min | Start=$($_.StartTime)"
  }
} else {
  Write-Host "  [FAIL] No llama-server process found" -ForegroundColor Red
}
Write-Host ""

# 2. Health check
Write-Host "[2] Checking /health endpoint..." -ForegroundColor Yellow
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $health = Invoke-WebRequest -Uri "http://${TargetHost}:${Port}/health" -TimeoutSec 3 -UseBasicParsing
  $sw.Stop()
  Write-Host "  [OK] Response: $($health.StatusCode) ($($sw.ElapsedMilliseconds)ms)" -ForegroundColor Green
  Write-Host "    $($health.Content)"
} catch {
  Write-Host "  [FAIL] No response: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# 3. Slots status
Write-Host "[3] Checking /slots endpoint..." -ForegroundColor Yellow
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $slots = Invoke-WebRequest -Uri "http://${TargetHost}:${Port}/slots" -TimeoutSec 5 -UseBasicParsing
  $sw.Stop()
  $slotData = $slots.Content | ConvertFrom-Json
  $total = @($slotData).Count
  $busy = @($slotData | Where-Object { $_.is_processing }).Count
  Write-Host "  [OK] Response: $($slots.StatusCode) ($($sw.ElapsedMilliseconds)ms)" -ForegroundColor Green
  Write-Host "    Total slots: $total"
  Write-Host "    Processing:  $busy"
  $slotData | ForEach-Object {
    if ($_.is_processing) {
      $slotStatus = "[BUSY]"
    } else {
      $slotStatus = "[IDLE]"
    }
    Write-Host "    Slot $($_.id): $slotStatus | n_ctx=$($_.n_ctx) | prompt=$($_.n_prompt_tokens) | predicted=$($_.n_tokens_predicted)"
  }
} catch {
  Write-Host "  [FAIL] No response: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  TIP: /health OK but /slots timeout = llama-server is stuck" -ForegroundColor Magenta
}
Write-Host ""

# 4. Log file
Write-Host "[4] Checking log file..." -ForegroundColor Yellow
if (Test-Path $logFile) {
  $logSize = (Get-Item $logFile).Length
  Write-Host "  Log file: $logFile"
  Write-Host "  Size: $([Math]::Round($logSize / 1KB, 1)) KB"
  Write-Host ""
  Write-Host "  --- Last $LogLines lines ---"
  Get-Content $logFile -Tail $LogLines
  Write-Host "  --- End ---"
} else {
  Write-Host "  [WARN] Log file not found ($logFile)" -ForegroundColor Magenta
  Write-Host "  TIP: Logs are created after first app start"
}
Write-Host ""

# 5. Model file check
Write-Host "[5] Checking model config..." -ForegroundColor Yellow
$configFile = Join-Path $env:USERPROFILE ".pyapp\config.json"
if (Test-Path $configFile) {
  $config = Get-Content $configFile -Raw | ConvertFrom-Json
  if ($config.llama.model) {
    $modelPath = $config.llama.model
    Write-Host "  Config model: $modelPath"
    if (Test-Path $modelPath) {
      $modelSize = [Math]::Round((Get-Item $modelPath).Length / 1GB, 2)
      Write-Host "  [OK] Model exists: $modelSize GB" -ForegroundColor Green
    } else {
      Write-Host "  [FAIL] Model file not found" -ForegroundColor Red
    }
    Write-Host "  contextWindow: $($config.llama.contextWindow)"
    Write-Host "  gpuLayers: $($config.llama.gpuLayers)"
  }
}
Write-Host ""

# 6. Memory
Write-Host "[6] System memory..." -ForegroundColor Yellow
$os = Get-CimInstance Win32_OperatingSystem
$totalGB = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeGB = [Math]::Round($os.FreePhysicalMemory / 1MB, 2)
$usedGB = [Math]::Round($totalGB - $freeGB, 2)
$usedPct = [Math]::Round(($usedGB / $totalGB) * 100, 1)
Write-Host "  Total:  $totalGB GB"
Write-Host "  Used:   $usedGB GB ($usedPct %)"
Write-Host "  Free:   $freeGB GB"
Write-Host ""

Write-Host "===== Diagnostic Complete =====" -ForegroundColor Cyan
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  Watch logs:    Get-Content $logFile -Wait"
Write-Host "  Restart llama: Stop-Process -Name 'llama-server' -Force"
Write-Host "  Clear logs:    Remove-Item $logFile" -ForegroundColor Gray