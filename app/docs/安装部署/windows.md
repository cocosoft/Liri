# Windows 安装指南

## 系统要求

- Windows 10 版本 1803 (10.0.17134) 或更高版本
- Windows Server 2019 或更高版本
- 内存: 最低 512MB，推荐 2GB+
- 磁盘空间: 最低 500MB

## 安装 Bun

### 使用 PowerShell

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 使用 npm（备选）

```powershell
npm install -g bun
```

## 安装项目依赖

```powershell
cd backend
bun install
```

## 配置环境

```powershell
# 复制环境变量模板
copy .env.example .env

# 编辑配置文件（使用记事本）
notepad .env
```

## 启动应用

```powershell
# 开发模式
bun run dev

# 生产模式
bun run build
bun run start
```

## 使用 Windows Terminal（推荐）

建议使用 Windows Terminal 以获得更好的终端体验：

```powershell
# 通过 winget 安装
winget install Microsoft.WindowsTerminal
```

## 注意事项

- 确保 PowerShell 执行策略允许运行脚本: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- 如果遇到端口冲突，修改 `.env` 中的 `PORT` 配置
- 防火墙可能需要放行应用端口
