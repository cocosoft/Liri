<#
.SYNOPSIS
    使用 nssm 将 Liri 应用安装为 Windows 服务
.DESCRIPTION
    使用 nssm (Non-Sucking Service Manager) 将编译后的 py_app.exe
    注册为真正的 Windows 服务，支持 services.msc / sc / net 管理。

    用法:
        # 安装服务
        .\install-nssm-service.ps1 install

        # 卸载服务
        .\install-nssm-service.ps1 uninstall

        # 启动/停止/重启/状态
        .\install-nssm-service.ps1 start
        .\install-nssm-service.ps1 stop
        .\install-nssm-service.ps1 restart
        .\install-nssm-service.ps1 status

        # 编辑服务的 GUI 配置窗口
        .\install-nssm-service.ps1 edit

    参数:
        -ServiceName   服务名称（默认: LiriAI）
        -BinaryPath    指定 exe 路径（默认自动查找 dist/py_app.exe）
        -DisplayName   服务显示名称
        -Description   服务描述
        -LogDir        日志输出目录（默认: 服务目录下的 logs/）
.NOTES
    作者: Liri Team
    要求: 管理员权限
#>

param(
    [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'edit')]
    [string]$Action = 'status',

    [string]$ServiceName = 'LiriAI',

    [string]$BinaryPath = '',

    [string]$DisplayName = 'Liri AI 后端服务',

    [string]$Description = 'Liri — 你的 AI 私人助手,基于 TypeScript + Rust 架构',

    [string]$LogDir = ''
)

# ── 配置 ─────────────────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir    = Resolve-Path (Join-Path $ScriptDir '..')
$DistDir   = Resolve-Path (Join-Path $AppDir '..\dist')
$NssmDir   = Join-Path $AppDir 'scripts\nssm'

# ── 辅助函数 ─────────────────────────────────────────────────────────────────

function Write-Step($msg) {
    Write-Host ">> $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-Error($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}

function Write-Warn($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

# ── 管理员权限检查 ───────────────────────────────────────────────────────────
function Check-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error '此脚本需要管理员权限才能安装/管理 Windows 服务。'
        Write-Error '请以管理员身份重新运行 PowerShell，然后重试。'
        exit 1
    }
}

# ── 查找 nssm.exe ───────────────────────────────────────────────────────────
function Find-Nssm {
    # 1. 检查项目内置的 nssm
    $localNssm = Join-Path $NssmDir 'nssm.exe'
    if (Test-Path $localNssm) {
        return $localNssm
    }

    # 2. 检查 PATH
    $pathNssm = Get-Command 'nssm.exe' -ErrorAction SilentlyContinue
    if ($pathNssm) {
        return $pathNssm.Source
    }

    # 3. 未找到
    return $null
}

# ── 查找编译后的 exe ────────────────────────────────────────────────────────
function Find-Binary {
    if ($BinaryPath -and (Test-Path $BinaryPath)) {
        return (Resolve-Path $BinaryPath).Path
    }

    $candidates = @(
        (Join-Path $DistDir 'py_app.exe'),
        (Join-Path $DistDir 'liri_coding.exe')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    return $null
}

# ── 确保日志目录 ────────────────────────────────────────────────────────────
function Ensure-LogDir {
    if (-not $LogDir) {
        $serviceDir = Split-Path -Parent (Find-Binary)
        $global:LogDir = Join-Path $serviceDir 'logs'
    }
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    return $LogDir
}

# ── 服务操作 ─────────────────────────────────────────────────────────────────

function Install-Service($nssm, $exe) {
    Write-Step '安装 Liri Windows 服务（使用 nssm）...'

    $logPath = Ensure-LogDir

    # 使用 nssm 安装服务（命令行方式，不弹 GUI）
    & $nssm install $ServiceName $exe 2>$null

    # 配置服务参数
    & $nssm set $ServiceName DisplayName $DisplayName
    & $nssm set $ServiceName Description $Description
    & $nssm set $ServiceName AppDirectory (Split-Path -Parent $exe)

    # 启动类型: 自动启动
    & $nssm set $ServiceName Start SERVICE_AUTO_START

    # 日志配置
    & $nssm set $ServiceName AppStdout (Join-Path $logPath 'liri-stdout.log')
    & $nssm set $ServiceName AppStderr (Join-Path $logPath 'liri-stderr.log')
    & $nssm set $ServiceName AppRotateFiles 1
    & $nssm set $ServiceName AppRotateOnline 1
    & $nssm set $ServiceName AppRotateSeconds 86400  # 每天轮转

    # 服务失败后自动重启
    & $nssm set $ServiceName AppThrottle 1500
    & $nssm set $ServiceName AppExit Default Restart
    & $nssm set $ServiceName AppRestartDelay 5000    # 5秒后重启

    # 停止方式: 先发控制台事件，再发 WM_CLOSE，最后 TerminateProcess
    & $nssm set $ServiceName AppStopMethodSkip 0
    & $nssm set $ServiceName AppStopMethodConsole 3000
    & $nssm set $ServiceName AppStopMethodWindow 3000
    & $nssm set $ServiceName AppStopMethodThreads 3000

    # 设置环境变量
    & $nssm set $ServiceName AppEnvironmentExtra LIRI_SERVICE_MODE=1

    if ($LASTEXITCODE -eq 0) {
        Write-OK "服务 '$ServiceName' 安装成功"
    } else {
        Write-Error "服务安装失败，退出码: $LASTEXITCODE"
        exit 1
    }
}

function Uninstall-Service($nssm) {
    Write-Step '卸载 Liri Windows 服务...'

    # 先停止服务
    & $nssm stop $ServiceName 2>$null
    Start-Sleep -Seconds 2

    # 删除服务
    & $nssm remove $ServiceName confirm

    if ($LASTEXITCODE -eq 0) {
        Write-OK "服务 '$ServiceName' 已卸载"
    } else {
        Write-Warn "服务卸载可能失败，退出码: $LASTEXITCODE"
        Write-Warn '可尝试手动命令: nssm remove $ServiceName confirm'
    }
}

function Start-ServiceAction($nssm) {
    Write-Step "正在启动服务 '$ServiceName'..."
    & $nssm start $ServiceName

    if ($LASTEXITCODE -eq 0) {
        Write-OK "服务 '$ServiceName' 已启动"
    } else {
        Write-Error "启动失败，退出码: $LASTEXITCODE"
        exit 1
    }
}

function Stop-ServiceAction($nssm) {
    Write-Step "正在停止服务 '$ServiceName'..."
    & $nssm stop $ServiceName

    if ($LASTEXITCODE -eq 0) {
        Write-OK "服务 '$ServiceName' 已停止"
    } else {
        Write-Error "停止失败，退出码: $LASTEXITCODE"
        exit 1
    }
}

function Restart-ServiceAction($nssm) {
    Write-Step "正在重启服务 '$ServiceName'..."
    & $nssm restart $ServiceName

    if ($LASTEXITCODE -eq 0) {
        Write-OK "服务 '$ServiceName' 已重启"
    } else {
        Write-Error "重启失败，退出码: $LASTEXITCODE"
        exit 1
    }
}

function Get-ServiceStatus($nssm) {
    Write-Step "查询服务 '$ServiceName' 状态..."

    $status = & $nssm status $ServiceName 2>$null

    Write-Host ""
    Write-Host "========================================" -ForegroundColor DarkCyan
    Write-Host "  Liri 服务状态" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor DarkCyan
    Write-Host "  服务名称:     $ServiceName"
    Write-Host "  显示名称:     $DisplayName"

    if ($status -eq 'SERVICE_RUNNING') {
        Write-Host "  运行状态:     运行中" -ForegroundColor Green
    } elseif ($status -eq 'SERVICE_STOPPED') {
        Write-Host "  运行状态:     已停止" -ForegroundColor Red
    } else {
        Write-Host "  运行状态:     $status"
    }

    # 通过 Get-Service 获取详细信息
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Host "  启动类型:     $($svc.StartType)"
        Write-Host "  状态:         $($svc.Status)"
    }

    $exe = Find-Binary
    if ($exe) {
        Write-Host "  可执行文件:   $exe"
    }

    if ($LogDir -and (Test-Path $LogDir)) {
        Write-Host "  日志目录:     $LogDir"
    }

    Write-Host "----------------------------------------" -ForegroundColor DarkCyan
    Write-Host "  管理命令:"
    Write-Host "    $PSCommandPath start"
    Write-Host "    $PSCommandPath stop"
    Write-Host "    $PSCommandPath restart"
    Write-Host "    $PSCommandPath uninstall"
    Write-Host "========================================" -ForegroundColor DarkCyan
    Write-Host ""
}

function Edit-ServiceGui($nssm) {
    Write-Step "打开 nssm 服务配置 GUI（服务: $ServiceName）..."
    & $nssm edit $ServiceName
}

# ── 主流程 ───────────────────────────────────────────────────────────────────

function Main {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor DarkCyan
    Write-Host "  Liri Windows 服务管理器 (nssm)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor DarkCyan
    Write-Host ""

    # 需要管理员权限的操作
    $needAdmin = @('install', 'uninstall', 'start', 'stop', 'restart')
    if ($Action -in $needAdmin) {
        Check-Admin
    }

    # 查找 nssm
    $nssm = Find-Nssm
    if (-not $nssm) {
        Write-Error '未找到 nssm.exe。请先下载 nssm 放到 scripts/nssm/ 目录，或将其加入 PATH。'
        Write-Error "下载地址: https://github.com/HandSonic/nssm/releases/tag/2.24"
        Write-Error "下载后解压，将 win64/nssm.exe 复制到: $NssmDir"
        exit 1
    }
    Write-OK "nssm: $nssm"

    # 安装/编辑外需要 exe
    if ($Action -in @('install', 'edit')) {
        $exe = Find-Binary
        if (-not $exe) {
            $exe = $BinaryPath
        }
        if (-not $exe -or -not (Test-Path $exe)) {
            Write-Error '未找到编译后的 py_app.exe。请先运行 "bun run build:exe" 编译。'
            exit 1
        }
        Write-OK "可执行文件: $exe"
    }

    # 执行操作
    switch ($Action) {
        'install'   { Install-Service $nssm $exe }
        'uninstall' { Uninstall-Service $nssm }
        'start'     { Start-ServiceAction $nssm }
        'stop'      { Stop-ServiceAction $nssm }
        'restart'   { Restart-ServiceAction $nssm }
        'status'    { Get-ServiceStatus $nssm }
        'edit'      { Edit-ServiceGui $nssm }
    }

    Write-Host ""
    Write-OK "操作完成"
    Write-Host ""
}

Main
