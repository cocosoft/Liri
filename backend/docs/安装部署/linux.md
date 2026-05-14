# Linux 安装指南

## 系统要求

- Linux 内核 5.x 或更高版本
- glibc >= 2.28 (Ubuntu 20.04+, Debian 10+, RHEL 8+)
- 内存: 最低 512MB，推荐 2GB+
- 磁盘空间: 最低 500MB

## 安装 Bun

```bash
# 一键安装
curl -fsSL https://bun.sh/install | bash

# 使用 npm 安装
npm install -g bun

# 使用 apt (Ubuntu/Debian)
curl -fsSL https://bun.sh/install | sudo bash
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
nano .env
```

## 启动应用

```bash
# 开发模式
bun run dev

# 生产模式
bun run build
bun run start

# 使用 systemd 作为服务
sudo cp deploy/py-app.service /etc/systemd/system/
sudo systemctl enable py-app
sudo systemctl start py-app
```

## Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 注意事项

- 确保 `~/.bun/bin` 在 PATH 中
- 生产环境建议使用 systemd 或 supervisor 管理进程
- 配置防火墙开放相应端口
