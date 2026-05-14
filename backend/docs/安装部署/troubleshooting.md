# 安装故障排除

## 常见问题

### Bun 安装失败

**问题**: Bun 安装脚本执行失败

**解决方案**:

```powershell
# Windows: 以管理员身份运行 PowerShell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
powershell -c "irm bun.sh/install.ps1 | iex"
```

```bash
# Linux/macOS: 检查 curl
curl --version
# 如果 curl 不可用，使用 wget
wget -qO- https://bun.sh/install | bash
```

### 依赖安装失败

**问题**: `bun install` 报错

**解决方案**:
- 检查网络连接
- 清理缓存后重试
- 使用 npm 作为备选

```bash
# 清理缓存
bun run clean

# 重新安装
rm -rf node_modules
bun install
```

### 端口占用

**问题**: 启动时提示端口已被占用

**解决方案**:
- 修改 `.env` 中的 `PORT` 配置
- 或者终止占用端口的进程

```powershell
# Windows: 查找占用进程
netstat -ano | findstr :3000
taskkill /PID <进程ID> /F
```

```bash
# Linux/macOS: 查找占用进程
lsof -i :3000
kill -9 <PID>
```

### 原生模块编译失败

**问题**: Rust 原生模块编译报错

**解决方案**:
- 确保 Rust 工具链已安装: `rustup show`
- 更新 Rust: `rustup update`
- 检查 Cargo 配置

## 获取帮助

如果以上方案无法解决问题，请查看日志文件或提交 Issue。
