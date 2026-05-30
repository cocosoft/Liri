# =============================================================================
#  Liri — Docker 一键管理
#  用法：
#    进入 app/docker/ 目录后执行：
#      make setup     一键配置 + 构建
#      make build     构建镜像
#      make run       交互模式（等同双击 exe）
#      make up        后台服务模式
#      make logs      查看日志
#      make down      停止服务
#      make clean     清理镜像和数据
# =============================================================================

COMPOSE_FILE := docker-compose.yml
COMPOSE_CMD := docker compose -f $(COMPOSE_FILE)

# ── 一键配置 + 构建 ──
.PHONY: setup
setup: check-env build
	@echo "✅ 配置完成。运行 make run 进入交互模式"

# ── 构建镜像 ──
.PHONY: build
build:
	docker compose -f ../$(COMPOSE_FILE) build

# ── 交互模式（等同 Windows 版双击 exe） ──
.PHONY: run
run:
	docker compose -f ../$(COMPOSE_FILE) run --rm app

# ── 后台服务模式 ──
.PHONY: up
up:
	docker compose -f ../$(COMPOSE_FILE) up -d

# ── 查看日志 ──
.PHONY: logs
logs:
	docker compose -f ../$(COMPOSE_FILE) logs -f

# ── 停止服务 ──
.PHONY: down
down:
	docker compose -f ../$(COMPOSE_FILE) down

# ── 清理 ──
.PHONY: clean
clean:
	docker compose -f ../$(COMPOSE_FILE) down -v
	docker rmi py_app-app:latest 2>/dev/null || true

# ── 检查 .env ──
.PHONY: check-env
check-env:
	@if [ ! -f ../.env ]; then \
		echo "📝 未找到 .env 文件，正在从 .env.example 创建..."; \
		cp ../.env.example ../.env; \
		echo "⚠️  请编辑 ../.env 填入 DEEPSEEK_API_KEY 等配置"; \
	fi
