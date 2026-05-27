#!/bin/bash

# 部署脚本
# 用于部署和启动PY_APP应用

echo "=== PY_APP 部署脚本 ==="

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "错误: Node.js 未安装"
    exit 1
fi

# 检查npm是否安装
if ! command -v npm &> /dev/null; then
    echo "错误: npm 未安装"
    exit 1
fi

echo "1. 安装依赖..."
npm install

if [ $? -ne 0 ]; then
    echo "错误: 依赖安装失败"
    exit 1
fi

echo "2. 检查环境变量文件..."
if [ ! -f .env ]; then
    echo "警告: .env 文件不存在，将使用 .env.example 作为模板"
    cp .env.example .env
    echo "请编辑 .env 文件配置必要的环境变量"
fi

echo "3. 启动应用..."
if [ "$NODE_ENV" = "production" ]; then
    echo "以生产模式启动..."
    npx ts-node src/index.ts
else
    echo "以开发模式启动..."
    npx ts-node src/index.ts
fi