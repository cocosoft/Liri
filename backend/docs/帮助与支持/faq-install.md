# 安装 FAQ

## Windows

### PowerShell 执行策略限制

**问题**: 运行安装脚本时提示 "无法加载文件，因为在此系统上禁止运行脚本"

**解决方案**:
```powershell
# 以管理员身份运行 PowerShell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 路径包含空格

**问题**: 项目路径包含空格导致安装失败

**解决方案**: 将项目移动到不包含空格的路径。

### 防火墙阻止

**问题**: 安装过程中被防火墙拦截

**解决方案**: 允许 Bun 通过防火墙，或临时关闭防火墙。

## macOS

### "bun" 命令未找到

**解决方案**:
```bash
# 将 Bun 添加到 PATH
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Gatekeeper 阻止

**解决方案**: 进入 系统设置 → 隐私与安全性 → 仍要打开。

## Linux

### 权限错误

**解决方案**:
```bash
# 使用 sudo 安装（如需要）
curl -fsSL https://bun.sh/install | sudo bash
```

### 缺少依赖

**解决方案**:
```bash
# Ubuntu/Debian
sudo apt-get install -y build-essential

# CentOS/RHEL
sudo yum groupinstall -y "Development Tools"
```
