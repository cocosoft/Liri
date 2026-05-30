@echo off
chcp 65001 >nul
title PY_APP Docker 一键启动

:: =============================================================================
:: PY_APP — Docker 一键启动脚本（Windows）
:: 用法：
::   docker-run           交互模式（等同双击 exe）
::   docker-run build     构建镜像
::   docker-run up        后台服务模式
::   docker-run down      停止服务
::   docker-run logs      查看日志
::   docker-run setup     一键配置 + 构建 + 运行
:: =============================================================================

set COMPOSE_FILE=..\docker-compose.yml

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 检查 Docker 是否可用
docker version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Docker 未运行或未安装
    echo 请先安装 Docker Desktop：https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

:: 处理命令
if "%1"=="build" goto build
if "%1"=="up" goto up
if "%1"=="down" goto down
if "%1"=="logs" goto logs
if "%1"=="setup" goto setup
if "%1"=="clean" goto clean

:: ── 默认：交互模式（等同双击 exe） ──
echo [PY_APP] 启动交互模式...
echo 首次运行请先执行: %~nx0 setup
echo.
docker compose -f %COMPOSE_FILE% run --rm app
goto end

:build
echo [PY_APP] 构建镜像（首次约 3-5 分钟）...
docker compose -f %COMPOSE_FILE% build
if %errorlevel% equ 0 (
    echo [完成] 镜像构建成功
) else (
    echo [错误] 镜像构建失败
)
goto end

:up
echo [PY_APP] 启动后台服务...
docker compose -f %COMPOSE_FILE% up -d
goto end

:down
echo [PY_APP] 停止服务...
docker compose -f %COMPOSE_FILE% down
goto end

:logs
docker compose -f %COMPOSE_FILE% logs -f
goto end

:setup
echo [PY_APP] ========================================
echo [PY_APP] 一键配置 + 构建 + 运行
echo [PY_APP] ========================================
echo.

:: 检查 .env
if not exist ..\.env (
    echo [PY_APP] 未找到 .env 文件，正在从 .env.example 创建...
    copy ..\.env.example ..\.env >nul
    echo [警告] 请编辑 .env 填入必要的配置（如 DEEPSEEK_API_KEY）
    start notepad ..\.env 2>nul
    echo.
    echo 按任意键继续构建（请先保存 .env 文件）...
    pause >nul
) else (
    echo [PY_APP] .env 文件已存在
)

:: 构建镜像
echo [PY_APP] 构建镜像（首次约 3-5 分钟）...
docker compose -f %COMPOSE_FILE% build
if %errorlevel% neq 0 (
    echo [错误] 构建失败，请检查错误信息
    pause
    exit /b 1
)

:: 启动交互模式
echo [完成] 构建成功，启动交互模式...
echo.
docker compose -f %COMPOSE_FILE% run --rm app
goto end

:clean
echo [PY_APP] 清理数据...
docker compose -f %COMPOSE_FILE% down -v
docker rmi py_app-app:latest 2>nul
echo [完成] 已清理
goto end

:end
echo.
pause
