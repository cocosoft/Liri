# Liri Docker 安装指南

> 适用版本：v0.4.x+ | 最后更新：2026-07-09

---

## 一、概述

Liri 的 Docker 镜像采用**多阶段构建**策略，与 Windows 桌面版共享同一套源码：

| Windows 版 | Docker 版 |
|---|---|
| `bun build --target=bun` | Dockerfile 中 `bun build --target=bun` |
| `Liri_coding.exe` | 容器中 `bun /app/dist/pyapp.js` |
| 双击 exe 运行 | `docker compose run --rm app` |
| 启动脚本设置环境变量 | `.env` 文件 + `docker-compose.yml` |
| `dist/` 目录 | `docker` 镜像 `/app/dist/` |

**构建阶段**：

| 阶段 | 说明 | 耗时 |
|------|------|:--:|
| 1. native-builder | 编译 Rust 原生加速插件（`rust:1.84-slim-bookworm`） | 2-3 分钟 |
| 2. app-builder | `bun install` + `bun build` 打包 JS bundle（`oven/bun:latest`） | 1-2 分钟 |
| 3. runtime | 组装最小运行镜像（`oven/bun:latest`） | ~10 秒 |

**最终镜像**：约 60MB（不含基础层缓存），含 Bun 运行时 + 编译产物 + Rust 原生插件 + 文档。

---

## 二、系统要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| 操作系统 | Linux（Ubuntu 22.04+ / Debian 12+ / CentOS 9+） | Ubuntu 24.04 |
| Docker Engine | 24.0+ | 27.0+ |
| Docker Compose | 2.20+（或 `docker compose` 插件） | 2.29+ |
| 内存 | 512MB | 2GB+ |
| 磁盘空间 | 构建时 2GB+（含 Rust 编译缓存），运行时约 200MB | 5GB+ |

> Windows/macOS 用户可通过 Docker Desktop 运行，详见 [docker-run.bat](../../docker/docker-run.bat) 一键脚本。

---

## 三、快速开始（5 分钟）

### 3.0 获取代码

```bash
# 克隆仓库
git clone https://github.com/cocosoft/Liri.git
cd Liri
```

> 也可以直接 [下载 ZIP](https://github.com/cocosoft/Liri/archive/refs/heads/main.zip) 解压后进入目录。

### 3.1 配置 API Key

```bash
cd app
cp .env.example .env
```

编辑 `.env`，填入 API 密钥（以下任选一种方式）：

```bash
# 方式一（推荐 — 统一格式，支持任意供应商）
PROVIDER_DEEPSEEK_KEY=sk-xxx
PROVIDER_DEEPSEEK_BASE_URL=https://api.deepseek.com
PROVIDER_DEEPSEEK_MODEL=deepseek-chat

# 方式二（向后兼容）
DEEPSEEK_API_KEY=sk-xxx
```

### 3.2 构建镜像

```bash
cd app
docker compose -f docker/docker-compose.yml build
```

首次构建约 3-5 分钟，后续构建利用 Docker 层缓存会快很多。

> 如 Rust 编译失败，不影响核心功能 — 原生插件会优雅降级。可编辑 Dockerfile 注释掉 `native-builder` 阶段跳过。

### 3.3 启动

```bash
# 交互模式（等同 Windows 版双击 exe）
docker compose -f docker/docker-compose.yml run --rm app

# 后台服务模式
docker compose -f docker/docker-compose.yml up -d

# 指定启动模式
docker compose -f docker/docker-compose.yml run --rm app mcp     # MCP 服务
docker compose -f docker/docker-compose.yml run --rm app daemon  # 守护进程
```

> TIP：也可 `cd app/docker` 后直接运行，省略 `-f` 参数：
> ```bash
> cd app/docker
> docker compose build && docker compose run --rm app
> ```

---

## 四、数据持久化

Docker 版使用**命名卷**持久化数据，生命周期独立于容器：

| 卷名 | 容器路径 | 说明 |
|------|---------|------|
| `liri_data` | `/app/app/data` | 数据库、会话、记忆、附件、缓存等 |
| `liri_logs` | `/app/app/logs` | 日志文件 |

- `docker compose down` **不会删除数据**
- 彻底清理：`docker compose -f docker/docker-compose.yml down -v`

**备份数据**：

```bash
docker run --rm \
  -v liri_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/liri-backup-$(date +%Y%m%d).tar.gz -C /data .
```

---

## 五、目录结构

```
app/
├── .env                      ← 环境变量（需自行创建）
├── .env.example              ← 配置模板
├── docker/
│   ├── Dockerfile            ← 多阶段构建定义
│   ├── docker-compose.yml    ← Compose 服务配置
│   ├── docker-run.bat        ← Windows 一键启动脚本
│   ├── Makefile              ← Linux/Mac 一键管理
│   └── Docker引导说明.txt    ← 详细引导文档
└── docs/安装部署/
    └── docker.md             ← 本文档
```

---

## 六、常用命令速查

| 操作 | 命令 |
|------|------|
| 首次构建 | `docker compose -f docker/docker-compose.yml build` |
| 重新构建（不使用缓存） | `docker compose -f docker/docker-compose.yml build --no-cache` |
| 交互模式 | `docker compose -f docker/docker-compose.yml run --rm app` |
| MCP 服务 | `docker compose -f docker/docker-compose.yml run --rm app mcp` |
| 后台启动 | `docker compose -f docker/docker-compose.yml up -d` |
| 查看实时日志 | `docker compose -f docker/docker-compose.yml logs -f` |
| 查看最近 100 行 | `docker compose -f docker/docker-compose.yml logs --tail 100` |
| 停止服务 | `docker compose -f docker/docker-compose.yml down` |
| 彻底清理（含数据卷） | `docker compose -f docker/docker-compose.yml down -v` |
| 进入容器 shell | `docker compose -f docker/docker-compose.yml run --rm app /bin/sh` |
| 导出镜像 | `docker save liri-app:latest -o liri.tar` |
| 导入镜像 | `docker load -i liri.tar` |

### Makefile 快捷命令（Linux/Mac）

```bash
cd app/docker
make setup      # 一键配置 + 构建
make build      # 构建镜像
make run        # 交互模式
make up         # 后台服务模式
make logs       # 查看日志
make down       # 停止服务
make clean      # 清理镜像和数据
```

### Windows 一键脚本

```cmd
cd app\docker
docker-run          # 交互模式
docker-run setup    # 一键配置 + 构建 + 运行
docker-run build    # 构建镜像
docker-run up       # 后台服务模式
docker-run logs     # 查看日志
docker-run down     # 停止服务
```

---

## 七、生产部署建议

### 7.1 安全配置

```bash
# 必须设置强密码
JWT_SECRET=<your-64-char-random-string>

# 限制访问来源
CORS_ORIGINS=https://your-domain.com
```

### 7.2 资源限制

在 `docker-compose.yml` 中添加：

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'
        reservations:
          memory: 512M
```

### 7.3 反向代理

建议使用 Nginx 或 Traefik 作为反向代理，暴露端口 3000：

```nginx
# Nginx 示例
server {
    listen 443 ssl;
    server_name liri.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 7.4 健康检查

`docker-compose.yml` 已内置健康检查（`curl http://localhost:3000/health`），可在编排中依赖此状态。

### 7.5 日志管理

```bash
# 限制 Docker 日志大小（docker-compose.yml）
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

建议接入外部日志系统（Loki / ELK / CloudWatch）。

### 7.6 自动重启

```yaml
services:
  app:
    restart: unless-stopped   # 已在 docker-compose.yml 中启用
```

---

## 八、更新与升级

```bash
# 拉取最新代码
git -C ~/Liri pull origin main
# 如果是首次安装
git clone https://github.com/cocosoft/Liri.git ~/Liri

cd ~/Liri/app
docker compose -f docker/docker-compose.yml build --no-cache app

# 重启服务
docker compose -f docker/docker-compose.yml up -d

# 查看启动日志
docker compose -f docker/docker-compose.yml logs -f
```

> 更新不会删除数据卷，会话、记忆等数据保持完整。

---

## 九、构建变体

> 本节参考 [构建变体优化方案](../../dev_docs/20260709/build-variant-optimization.md)。

Liri 支持 4 种构建变体：`core`、`personal`、`coding`、`enterprise`。

Docker 构建默认为 `coding` 变体。如需构建其他变体：

```bash
# 方式一：修改 Dockerfile 中的 build-variant 命令
# RUN bun run scripts/build-variant.ts --variant=enterprise

# 方式二：通过构建参数传递（待 build-variant-optimization P0-2 实施）
docker build \
  --build-arg BUILD_VARIANT=enterprise \
  -t liri-enterprise:latest \
  -f docker/Dockerfile .
```

---

## 十、常见问题

**Q: 构建失败，提示 "bun: command not found"？**
A: 确保 Docker 可以正常拉取 `oven/bun:latest` 镜像。若网络受限，可预先 `docker pull oven/bun:latest`。

**Q: Rust 原生插件编译失败？**
A: 不影响核心功能，原生插件会优雅降级。如需跳过：编辑 `Dockerfile`，注释掉 `native-builder` 阶段和 `COPY --from=native-builder` 行。

**Q: 运行提示 "EPERM" 或权限错误？**
A: Dockerfile 已预创建数据目录并 `chown`。如遇权限问题：
```bash
docker compose -f docker/docker-compose.yml run --rm -u root app chown -R liri:liri /app
```

**Q: 交互模式中文显示乱码？**
A: 在 `docker-compose.yml` 的 `environment` 中添加：
```yaml
- LANG=C.UTF-8
- LC_ALL=C.UTF-8
```

**Q: 端口 3000 被占用？**
A: 修改 `docker-compose.yml` 中的端口映射，如 `"3001:3000"`。

**Q: 如何查看构建好的镜像大小？**
```bash
docker images | grep liri
```

---

## 参考文件

| 文件 | 说明 |
|------|------|
| [Dockerfile](../../docker/Dockerfile) | 多阶段构建定义 |
| [docker-compose.yml](../../docker/docker-compose.yml) | Compose 服务配置 |
| [Docker 引导说明](../../docker/Docker引导说明.txt) | 详细引导文档 |
| [docker-run.bat](../../docker/docker-run.bat) | Windows 一键启动脚本 |
| [Makefile](../../docker/Makefile) | Linux/Mac 管理脚本 |
| [.env.example](../../.env.example) | 环境变量模板 |
| [构建变体优化方案](../../dev_docs/20260709/build-variant-optimization.md) | 变体构建方案 |
