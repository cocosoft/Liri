# =============================================================================
#  Liri — Docker 多阶段构建
#  官网：https://openliri.com
#  策略：bun build (tauri 编译) → JS bundle → bun 直接运行
#  不用 bun build --compile（不支持 tsconfig paths 别名）
# =============================================================================
#  构建阶段 1：Rust 原生插件编译
# =============================================================================
# ── 2026-10-22：基础镜像由 `rust:1.84` 提到 `rust:1`（= 当前 stable）──
# 根因（实测 Deploy Docker 连续失败）：`app/native/Cargo.lock` 已锁到
# `icu_properties_data 2.3.0`，其 manifest 需要比 cargo 1.84 更新的解析器 ⇒
# `failed to parse manifest ... / icu_properties_data-2.3.0 / Cargo.toml`（exit 101）。
# 依赖确定性由下方 `cargo build --locked`（对齐已入库 Cargo.lock）保证，不靠旧工具链钉版本。
FROM rust:1-slim-bookworm AS native-builder

WORKDIR /native

# 仅复制 Cargo 清单以缓存依赖（利用 Docker 层缓存）
COPY app/native/Cargo.toml app/native/Cargo.lock* ./
RUN mkdir src && echo 'fn main() {}' > src/lib.rs && \
    cargo build --release 2>/dev/null || true && \
    rm -rf src

# 复制真实源码并编译（`--locked`：必须与入库 Cargo.lock 完全一致，禁重新解析）
COPY app/native/ .
RUN cargo build --release --locked && \
    cp target/release/libliri_native.so /libliri_native.so

# =============================================================================
#  构建阶段 2：Bun 打包 JS bundle
# =============================================================================
# 固定 bun 版本与本地/CI 一致（1.3.14），避免 latest 漂移导致 install/build 行为差异
# （2026-08-17 排查：Deploy Docker run 342 起 bun build 失败，root cause 为 install 环境 + 版本漂移）
FROM oven/bun:1.3.14 AS app-builder

# 安装编译原生模块所需的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖清单（利用 Docker 层缓存）
COPY app/package.json app/bun.lock* ./
# 2026-08-17 修复：原 `bun install --frozen-lockfile ... || bun install` 静默降级会掩盖
# install 失败（依赖树不完整 → bun build 报模块缺失）。frozen-lockfile 失败必须显式报错暴露根因。
RUN bun install --frozen-lockfile --no-progress

# 复制源码（app/ → /app/）
COPY app/ .

# 复制 shared/ 目录（供 @shared/* 路径别名解析）
COPY shared/ /shared/

# 复制内核包（P4 起内核物理独立于 app/src）：tsconfig 别名
# `@modules/core/*` → `../../packages/kernel/src/core/*`（相对 /app/src ⇒ /packages/kernel/src/core）。
# 漏掉这一步会让 `bun build` 直接报模块缺失。
COPY packages/ /packages/

# 复制编译好的原生插件
COPY --from=native-builder /libliri_native.so native/target/release/libliri_native.so

# 生成版本 Feature Flags
RUN bun run scripts/build-variant.ts --variant=coding

# 打包（bun build 原生支持 tsconfig paths，--target=bun 需要 --outdir）
# --external yoga-layout（2026-08-30）：yoga-layout dist/src/index.js 含 top-level await，
# bun build --target=bun 不支持 → 与 package.json build 脚本一致 external 跳过（运行时由
# node_modules 提供）。缺失时 Deploy Docker 的 Build and push 步骤失败（同 CI Test build 步骤）。
RUN bun build \
    --target=bun \
    --external pdfjs-dist \
    --external sharp \
    --external yoga-layout \
    --outdir=/app/dist \
    src/pyapp.ts

# 复制外部运行时依赖（sharp 等原生模块 → dist/deps/）
RUN bun run scripts/copy-external-deps.ts --target=/app/dist

# =============================================================================
#  运行阶段：Bun 运行时
# =============================================================================
FROM oven/bun:1.3.14 AS runtime

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
# LIRI_HTTP_PORT/LIRI_HTTP_HOST：HTTP 服务监听端口与地址（main.ts 读取）。
# 容器内必须绑定 0.0.0.0，否则 127.0.0.1 仅在容器内部可达，外部无法访问。
ENV LIRI_PROJECT_DIR=/app \
    LIRI_HOME=/app/app/data \
    LIRI_DATA_DIR=/app/app/data \
    LIRI_HTTP_PORT=3000 \
    LIRI_HTTP_HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 3000

CMD ["bun", "/app/dist/pyapp.js"]
