#!/bin/bash
# =============================================================================
#  PY_APP — macOS 一键启动脚本
#  双击此文件即可运行（.command 文件在 Finder 中双击会用终端打开）
#  等同 Windows 版双击 运行PY_APP.bat
# =============================================================================
#  配置方式：
#    首次运行会自动创建 .env 配置文件
#    编辑 .env 中的 DEEPSEEK_API_KEY 后重新运行即可
# =============================================================================

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYAPP_PROJECT_DIR="$SCRIPT_DIR"

# 编译产物路径（macOS 版二进制没有扩展名）
EXE_PATH="$SCRIPT_DIR/dist/py_app_coding"
ENV_FILE="$SCRIPT_DIR/.env"

echo "===================================="
echo "        PY_APP is starting..."
echo "===================================="
echo ""

# ── 检查编译产物是否存在 ──
if [ ! -f "$EXE_PATH" ]; then
    echo "[ERROR] Cannot find program file: $EXE_PATH"
    echo "Please make sure py_app_coding is in the dist folder"
    echo ""
    echo "If you haven't built the macOS binary yet, run:"
    echo "  cd app && bun run build:mac-apple-silicon"
    echo "  # or for Intel Mac:"
    echo "  cd app && bun run build:mac-intel"
    read -p "Press Enter to exit"
    exit 1
fi

# ── 检查 .env 配置文件 ──
if [ ! -f "$ENV_FILE" ]; then
    echo "[INFO] Creating .env config file..."
    cat > "$ENV_FILE" << 'ENVEOF'
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
ENVEOF
    echo "[DONE] .env file created successfully!"
    echo ""
    echo "[IMPORTANT] Please edit the .env file and set your"
    echo "           DEEPSEEK_API_KEY before using AI features."
    echo "           Get one for free at: https://platform.deepseek.com/api_keys"
    echo ""
fi

# ── 启动 ──
cd "$SCRIPT_DIR"
echo "[START] Loading program, please wait..."
echo ""

# 执行编译二进制（macOS 上需要通过 exec 替换当前进程）
exec "$EXE_PATH" --project-dir "$SCRIPT_DIR"
