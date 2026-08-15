#!/bin/bash

# 部署脚本
# 用于部署和启动Liri应用（Bun 工具链）

echo "=== Liri 部署脚本 ==="
echo "官网: https://openliri.com"
echo ""

# 检查 Bun 是否安装（项目为 Bun 工程，仅 bun.lock）
if ! command -v bun &> /dev/null; then
    echo "错误: Bun 未安装（项目使用 Bun 作为运行时与包管理器）"
    echo "安装: https://bun.sh/docs/installation"
    exit 1
fi

echo "1. 安装依赖..."
bun install --frozen-lockfile

if [ $? -ne 0 ]; then
    echo "错误: 依赖安装失败"
    exit 1
fi

echo "2. 构建应用..."
bun run build

if [ $? -ne 0 ]; then
    echo "错误: 应用构建失败"
    exit 1
fi

echo "3. 检查环境变量文件..."
if [ ! -f .env ]; then
    echo "警告: .env 文件不存在，将使用 .env.example 作为模板"
    cp .env.example .env
    echo "请编辑 .env 文件配置必要的环境变量"
fi

echo "4. 启动应用..."
if [ "$NODE_ENV" = "production" ]; then
    echo "以生产模式启动..."
    bun run start
else
    echo "以开发模式启动..."
    bun run dev
fi
