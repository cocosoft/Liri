---
description: 版本管理规范。适用于版本号规划、发布流程、版本升级等场景。
---

# 版本管理规范 / Versioning Management

> 基于语义化版本（SemVer）原则，适配 Liri 多语言多包的实际结构。
> 每次发布严格按此规则执行，非经协商不得越级跳版本。

## 一、版本号格式

```
v<主版本>.<次版本>.<修订号>
```

由三段非负整数组成，例如 `v0.1.0`、`v0.1.23`、`v0.2.0`、`v1.0.0`。

## 二、版本升级规则

### 2.1 阶段定义

当前处于 **v0.x 快速迭代阶段**（正式发布 API 稳定版之前）。

| 阶段 | 版本范围 | 策略 |
|------|---------|------|
| 快速迭代 | v0.x.y | 每月升次版本，按需升修订号 |
| 稳定版 | v1.x.y | 严格遵循语义化版本 |

### 2.2 升级触发条件

| 版本位 | 何时升级 | 示例 |
|--------|---------|------|
| **修订号** | Bug 修复、文档更新、小重构、日常合并 | `0.4.1` → `0.4.2` |
| **次版本** | 每月迭代发版、新增功能、新通道接入、架构重构 | `0.4.1` → `0.5.0` |
| **主版本** | Plugin SDK 不兼容、ACP 协议破坏性变更、配置/数据格式破坏性变更 | `0.x.x` → `1.0.0` |

### 2.3 发版节奏

```
修订号 — 按需升，每次发版 +1
次版本 — 每月/每迭代 +1（修订号归零）
主版本 — 达到 v1.0.0 标准时一次性从 0.x.x 跳到 1.0.0
```

### 2.4 禁止行为

- ❌ 不要每次 commit 改版本号 — 只在发版时改
- ❌ 不要靠堆修订号来进位次版本 — 有功能迭代就主动升次版本
- ❌ 不要用次版本号堆到 10 来进位主版本 — 主版本只代表兼容性断裂

## 三、版本文件清单

所有组件版本号必须保持一致，每次升级统一更新以下 **6 个版本文件 + 2 个 Rust 锁文件的根包版本**，并**强制同步 `README.md`**（不得只改其一）：

| 组件 | 版本文件 | 版本字段 |
|------|---------|---------|
| 后端核心 | `app/package.json` | `version` |
| 后端原生模块 | `app/native/package.json` | `version` |
| 后端 Rust 模块 | `app/native/Cargo.toml` | `[package] version` |
| 后端 Rust 锁文件 | `app/native/Cargo.lock` | 根包 `liri-native` 的 `version` |
| 前端客户端 | `client/package.json` | `version` |
| Tauri 配置 | `client/src-tauri/tauri.conf.json` | `version` |
| Tauri Rust 模块 | `client/src-tauri/Cargo.toml` | `[package] version` |
| Tauri Rust 锁文件 | `client/src-tauri/Cargo.lock` | 根包 `liri_client` 的 `version` |
| 项目主页 | `README.md` | **三处必须同步**：① badge URL 版本号（`badge/version-X.Y.Z-blue`）；②「📋 版本」下的「当前版本：**vX.Y.Z**」；③「🚀 版本更新记录」**仅保留最新一版摘要**并指向 `CHANGELOG.md` |
| 更新日志 | `CHANGELOG.md` | **版本变更的完整历史（单一事实源）**：每次发版**追加**本版段落（最新在上）；历史条目为 2026-10-05 由 README 原「版本更新记录」17 条**逐字迁移**，不改写 |

> **强制要求（2026-10-04 用户明确）**：版本升级时**必须同步 README.md** —— 上述 badge / 「当前版本」/ 最新版摘要**三处缺一不可**（v0.4.58 起执行）。
>
> **单一事实源分工（2026-10-05 用户裁定）**：`CHANGELOG.md` 为**完整历史**的权威落点；`README.md` 的「🚀 版本更新记录」**只留最新一版 + 指向链接** ⇒ **不得两处重复维护同一份条目**（避免双源漂移，CS01）。
> ⚠️ 本文 §四 原引用的 `RELEASE.md` **在仓内不存在**（该链接指向旧目录 `E:/PY/CODES/Liri/`）⇒ 已改为以本文件 §四 为准。

## 四、发布流程

```bash
# 1. 改版本号：app/package.json 的 version = "X.Y.Z"
# 2. 同步到所有版本文件（6 个版本文件 + 2 个 Rust 锁文件根包 = 8 处；推荐 `bun run scripts/sync-version.ts`）
#    —— 该脚本同时写入 README 的 ① badge 与 ②「当前版本」，故这两处无需手改
# 3. 写 CHANGELOG.md：在「## [未发布]」之后**新增本版段落**（最新在上）   ← 完整历史（单一事实源）
# 4. 同步 README.md「🚀 版本更新记录」：**只留最新一版摘要**（旧条目不再在 README 累积；完整历史看 CHANGELOG.md）
# 5. 校验：`bun run version:check`（6 个 JSON/TOML 版本文件必须一致）
# 6. git commit -m "chore: bump version to vX.Y.Z"
# 7. git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
# 8. git push && git push origin vX.Y.Z
# 9. GitHub Actions 自动构建 Release
```

> 详细操作以**本文**为准；原引用的 `RELEASE.md` 在仓内**不存在**（链接指向旧目录 `E:/PY/CODES/Liri/`）。

## 五、v0 → v1 的退出条件

满足以下任一条件时升主版本到 1.0.0：

- Plugin SDK 有外部使用者
- ACP 协议被外部项目集成
- 配置格式连续 3 个月无破坏性变更
- 项目正式对外发布

## 六、版本号查看

```bash
# 查看当前版本
node -e "console.log(require('./app/package.json').version)"

# 查看所有 tags（按版本排序）
git tag --sort=-version:refname

# 查看两个版本间的提交
git log --oneline --no-decorate v0.1.0..HEAD
```
