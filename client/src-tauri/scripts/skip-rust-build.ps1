# Tauri build runner: skip Rust compilation, use existing binary
$binaryName = "liri_client.exe"
$targetDir = Join-Path $PSScriptRoot "..\target\release"
$binaryPath = Join-Path $targetDir $binaryName

if (-not (Test-Path $binaryPath)) {
    Write-Error "ERROR: Binary not found at $binaryPath"
    exit 1
}

Write-Host "[skip-rust-build] Using existing binary: $binaryPath"
exit 0
