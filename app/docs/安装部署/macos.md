# macOS 安装指南

## 系统要求

- macOS 12 (Monterey) 或更高版本
- 内存: 最低 512MB，推荐 2GB+
- 磁盘空间: 最低 500MB

## 安装 Bun

```bash
# 使用 curl 安装
curl -fsSL https://bun.sh/install | bash

# 使用 Homebrew 安装
brew install oven-sh/bun/bun

# 使用 npm 安装
npm install -g bun
```

## 安装项目依赖

```bash
cd backend
bun install
```

## 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置
vim .env
# 或
code .env
```

## 启动应用

```bash
# 开发模式
bun run dev

# 生产模式
bun run build
bun run start
```

## 注意事项

- 如果使用 Apple Silicon (M1/M2/M3)，Bun 原生支持 ARM64
- Gatekeeper 可能阻止未签名的应用，进入 系统设置 -> 隐私与安全性 放行
