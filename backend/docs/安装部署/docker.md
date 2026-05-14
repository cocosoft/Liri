# Docker 部署

## 前提条件

- Docker Engine >= 20.10
- Docker Compose >= 2.0 (可选)

## 使用 Dockerfile

### 构建镜像

```bash
cd backend
docker build -t py-app:latest .
```

### 运行容器

```bash
docker run -d \
  --name py-app \
  -p 3000:3000 \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  -v .env:/app/.env \
  py-app:latest
```

## 使用 Docker Compose（推荐）

```bash
cd backend
docker compose up -d
```

### docker-compose.yml 配置

```yaml
version: '3.8'
services:
  py-app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./.env:/app/.env
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

## 生产环境配置

### 资源限制

```yaml
services:
  py-app:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'
        reservations:
          memory: 512M
```

### 健康检查

```yaml
services:
  py-app:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 日志管理

```bash
# 查看实时日志
docker logs -f py-app

# 查看最近 100 行
docker logs --tail 100 py-app
```

## 更新容器

```bash
docker compose pull
docker compose up -d
```
