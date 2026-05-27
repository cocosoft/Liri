# Docker 部署

## 前提条件

- Docker Engine >= 24.0
- Docker Compose >= 2.20（可选，推荐使用 `docker compose` 插件）

## 概述

PY_APP 的 Docker 镜像采用**多阶段构建**策略，与 Windows 版使用相同的 `bun build --compile` 方式生成独立二进制：

1. **native-builder**：编译 Rust 原生加速插件（cdylib）
2. **app-builder**：`bun install` + `bun build --compile` 生成独立二进制
3. **runtime**：将产物放入最小化 `alpine:3.21` 镜像

最终镜像仅包含 Alpine 基础层 + 编译好的独立二进制 + Rust 原生插件 + 文档，无需 Node.js 或 Bun 运行时。

> 所有 Docker 相关文件统一放在 `backend/docker/` 目录下：
> - [docker/Dockerfile](../../docker/Dockerfile)
> - [docker/docker-compose.yml](../../docker/docker-compose.yml)
> - [docker/Docker引导说明.txt](../../docker/Docker引导说明.txt)

## 快速开始

### 1. 配置环境变量

```bash
cd backend
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY
```

### 2. 构建镜像

```bash
cd backend
docker compose -f docker/docker-compose.yml build
```

构建过程说明：
- 阶段 1（native-builder）：编译 Rust 原生插件（首次约 2-3 分钟）
- 阶段 2（app-builder）：安装依赖 + 编译 TypeScript 为独立二进制（约 1 分钟）
- 阶段 3（runtime）：组装最小运行镜像（约 10 秒）

### 3. 交互模式运行（等同 Windows 版双击 exe）

```bash
docker compose -f docker/docker-compose.yml run --rm app
```

这会打开 REPL 交互界面，输入 `exit` 退出。

### 4. 后台服务模式

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f
docker compose -f docker/docker-compose.yml down
```

> **简便方式**：也可以 `cd backend/docker` 后直接运行 `docker compose`（省略 `-f` 参数）：
> ```bash
> cd backend/docker
> docker compose build
> docker compose run --rm app
> ```

## 手动构建（不使用 Compose）

```bash
cd backend
docker build -t py-app:latest -f docker/Dockerfile .
```

### 运行容器

```bash
docker run -it --rm \
  --name py-app \
  -e DEEPSEEK_API_KEY=your_key_here \
  -v pyapp_data:/app/backend/data \
  -v pyapp_logs:/app/backend/logs \
  py-app:latest
```

指定启动模式：

```bash
# MCP 服务模式
docker run -it --rm py-app:latest mcp

# 守护进程模式
docker run -it --rm py-app:latest daemon
```

## 数据持久化

镜像使用 Docker 命名卷持久化运行时数据：

| 卷名 | 容器路径 | 说明 |
|------|---------|------|
| `pyapp_data` | `/app/backend/data` | 数据库、会话、记忆、附件等 |
| `pyapp_logs` | `/app/backend/logs` | 日志文件 |

数据卷独立于容器生命周期，`docker compose down` 不会删除数据。

## 生产环境建议

### 资源限制

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

### 健康检查

后台服务模式可启用健康检查：

```yaml
services:
  app:
    healthcheck:
      test: ["CMD-SHELL", "pgrep py_app_coding || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

### 反向代理

建议使用 Nginx 或 Traefik 作为反向代理，暴露端口 3000。

### 日志管理

```bash
# 查看实时日志
docker compose -f docker/docker-compose.yml logs -f

# 查看最近 100 行
docker compose -f docker/docker-compose.yml logs --tail 100
```

## 更新镜像

```bash
docker compose -f docker/docker-compose.yml build --no-cache app
docker compose -f docker/docker-compose.yml up -d
```

## 常见问题

**构建失败，提示 "bun: command not found"？**
确保 Docker 可以正常拉取 `oven/bun:1.2-alpine` 镜像。

**Rust 原生插件编译失败？**
Rust 编译失败不影响应用核心功能，原生插件会优雅降级。

**数据卷权限问题？**
```bash
docker compose -f docker/docker-compose.yml run --rm app chown -R 1000:1000 /app
```

## 参考

- [docker-compose.yml](../../docker/docker-compose.yml)
- [Dockerfile](../../docker/Dockerfile)
- [Docker 引导说明](../../docker/Docker引导说明.txt)
- [Windows 版说明](../../dist/Windows引导说明.txt)
