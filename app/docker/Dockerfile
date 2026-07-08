# =============================================================================
#  Liri — Docker 多阶段构建
#  官网：https://openliri.com
#  策略：bun build (tauri 编译) → JS bundle → bun 直接运行
#  不用 bun build --compile（不支持 tsconfig paths 别名）
# =============================================================================
#  构建阶段 1：Rust 原生插件编译
# =============================================================================
FROM rust:1.84-slim-bookworm AS native-builder

WORKDIR /native

# 仅复制 Cargo 清单以缓存依赖（利用 Docker 层缓存）
COPY app/native/Cargo.toml app/native/Cargo.lock* ./
RUN mkdir src && echo 'fn main() {}' > src/lib.rs && \
    cargo build --release 2>/dev/null || true && \
    rm -rf src

# 复制真实源码并编译
COPY app/native/ .
RUN cargo build --release && \
    cp target/release/libliri_native.so /libliri_native.so

# =============================================================================
#  构建阶段 2：Bun 打包 JS bundle
# =============================================================================
FROM oven/bun:latest AS app-builder

# 安装编译原生模块所需的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖清单（利用 Docker 层缓存）
COPY app/package.json app/bun.lock* ./
RUN bun install --frozen-lockfile --no-progress 2>/dev/null || bun install --no-progress

# 复制源码（app/ → /app/）
COPY app/ .

# 复制 shared/ 目录（供 @shared/* 路径别名解析）
COPY shared/ /shared/

# 复制编译好的原生插件
COPY --from=native-builder /libliri_native.so native/target/release/libliri_native.so

# 生成版本 Feature Flags
RUN bun run scripts/build-variant.ts --variant=coding

# 打包（bun build 原生支持 tsconfig paths，--target=bun 需要 --outdir）
RUN bun build \
    --target=bun \
    --external pdfjs-dist \
    --external sharp \
    --outdir=/app/dist \
    src/pyapp.ts

# 复制外部运行时依赖（sharp 等原生模块 → dist/deps/）
RUN bun run scripts/copy-external-deps.ts --target=/app/dist

# =============================================================================
#  运行阶段：Bun 运行时
# =============================================================================
FROM oven/bun:latest AS runtime

# 安装运行时系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# 创建运行用户
RUN useradd -r -s /bin/false -m liri

WORKDIR /app

# ── 复制编译产物 ──
# dist/ 目录（pyapp.js + 原生资源 + deps/）
COPY --from=app-builder /app/dist /app/dist

# 原生插件（运行时按需加载，不存在时优雅降级）
COPY --from=app-builder /app/native/target/release/libliri_native.so \
    /app/native/target/release/libliri_native.so

# 文档目录（/docs 命令加载用）
COPY --from=app-builder /app/docs /app/docs

# 配置文件模板
COPY --from=app-builder /app/.env.example /app/.env.example

# ── 预创建数据目录（同 pyapp.ts 中的 ROOT_LEVEL_DIRS） ──
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
RUN chown -R liri:liri /app

USER liri

# ── 环境变量 ──
ENV LIRI_PROJECT_DIR=/app \
    LIRI_HOME=/app/app/data \
    LIRI_DATA_DIR=/app/app/data \
    NODE_ENV=production

EXPOSE 3000

CMD ["bun", "/app/dist/pyapp.js"]
