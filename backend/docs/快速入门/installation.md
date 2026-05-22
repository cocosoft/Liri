# 安装指南

## 系统要求

- **操作系统**: Windows 10+ / macOS 12+ / Linux (内核 5.x+)
- **运行时环境**: Node.js >= 20 或 Bun >= 1.0
- **内存**: 最低 512MB（推荐 2GB+）
- **磁盘空间**: 最低 500MB

## 安装依赖

### 使用 Bun（推荐）

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 进入项目目录
cd backend

# 安装依赖
bun install
```

### 使用 Node.js

```bash
# 确保已安装 Node.js >= 20
node --version

# 进入项目目录
cd backend

# 安装依赖
npm install
# 或
yarn install
# 或
pnpm install
```

## 环境配置

复制环境变量模板并修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置必要的参数：

```ini
# AI 模型配置
DEEPSEEK_API_KEY=在此填入你的 DeepSeek API 密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# 日志级别
LOG_LEVEL=info

# 服务端口
PORT=3000
```

## 启动应用

```bash
# 开发模式（支持热重载）
bun run dev

# 生产模式
bun run build
bun run start

# 直接运行
bun --bun run src/index.ts
```

## 验证安装

启动后进入交互式 REPL 模式，输入 `/help` 查看可用命令。如果看到欢迎信息，说明安装成功。
