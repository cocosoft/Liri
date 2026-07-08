# =============================================================================
#  Liri — Docker 多阶段构建
#  官网：https://openliri.com
#  参考 Windows 版打包方式（bun build --compile），生成独立可执行文件
# =============================================================================
#  构建阶段 1：Rust 原生插件编译
# =============================================================================
FROM rust:1.84-slim-bookworm AS native-builder

WORKDIR /native

# 仅复制 Cargo 清单以缓存依赖（利用 Docker 层缓存）
COPY native/Cargo.toml native/Cargo.lock* ./
RUN mkdir src && echo 'fn main() {}' > src/lib.rs && \
    cargo build --release 2>/dev/null || true && \
    rm -rf src

# 复制真实源码并编译
COPY native/ .
RUN cargo build --release && \
    cp target/release/libpy_app_native.so /libpy_app_native.so

# =============================================================================
#  构建阶段 2：Bun 编译独立二进制
# =============================================================================
FROM oven/bun:1.2 AS app-builder

# 安装编译原生模块所需的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖清单（利用 Docker 层缓存）
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --no-progress 2>/dev/null || bun install --no-progress

# 复制源码
COPY . .

# 复制编译好的原生插件
COPY --from=native-builder /libpy_app_native.so native/target/release/libpy_app_native.so

# 编译为独立二进制（等同 Windows 版 bun build --compile --target=bun-windows-x64-modern）
RUN bun build --compile \
    --target=bun-linux-x64-modern \
    --outfile=/app/dist/liri_coding \
    src/pyapp.ts

# =============================================================================
#  运行阶段：最小化 Debian 镜像
# =============================================================================
FROM debian:bookworm-slim AS runtime

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# 创建运行用户
RUN useradd -r -s /bin/false -m pyapp

WORKDIR /app

# ── 复制编译产物 ──
# 独立二进制（等同 Windows 版的 liri_coding.exe）
COPY --from=app-builder /app/dist/liri_coding /app/liri_coding

# 原生插件（运行时按需加载，不存在时优雅降级）
COPY --from=app-builder /app/native/target/release/libpy_app_native.so \
    /app/native/target/release/libpy_app_native.so

# 文档目录（/docs 命令加载用）
COPY --from=app-builder /app/docs /app/docs

# 配置文件模板
COPY --from=app-builder /app/configs /app/configs
COPY --from=app-builder /app/.env.example /app/.env.example

# ── 预创建数据目录（同 pyapp.ts 中的 ROOT_LEVEL_DIRS） ──
# 避免运行时 mkdir {recursive: true} 触发 EPERM/ENOENT
RUN mkdir -p \
    app/data \
    app/data/governance \
    app/data/governance/audit \
    app/data/governance/strategies \
    app/data/sessions \
    app/data/transcripts \
    app/data/memory \
    app/data/attachments \
    app/data/cache \
    app/data/security \
    app/data/chronos \
    app/logs \
    logs

# 固定权限
RUN chown -R pyapp:pyapp /app

USER pyapp

# ── 环境变量 ──
ENV LIRI_PROJECT_DIR=/app \
    LIRI_HOME=/app/app/data \
    LIRI_DATA_DIR=/app/app/data \
    NODE_ENV=production

EXPOSE 3000

# 运行独立二进制（等同 Windows 版双击 liri_coding.exe）
# 可通过 docker run -e LAUNCH_MODE=mcp 切换为 MCP 服务模式
CMD ["/app/liri_coding"]
