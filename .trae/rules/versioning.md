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

所有组件版本号必须保持一致，每次升级统一更新以下 **6 个版本文件**，并**强制同步 `README.md`**（不得只改其一）：

| 组件 | 版本文件 | 版本字段 |
|------|---------|---------|
| 后端核心 | `app/package.json` | `version` |
| 后端原生模块 | `app/native/package.json` | `version` |
| 后端 Rust 模块 | `app/native/Cargo.toml` | `[package] version` |
| 前端客户端 | `client/package.json` | `version` |
| Tauri 配置 | `client/src-tauri/tauri.conf.json` | `version` |
| Tauri Rust 模块 | `client/src-tauri/Cargo.toml` | `[package] version` |
| 项目主页 | `README.md` | **三处必须同步**：① badge URL 版本号（`badge/version-X.Y.Z-blue`）；②「📋 版本」下的「当前版本：**vX.Y.Z**」；③「🚀 版本更新记录」新增本版 changelog 段落 |

> **强制要求（2026-10-04 用户明确）**：版本升级时**必须同步 README.md** —— 上述 badge / 「当前版本」/ changelog 三处缺一不可（v0.4.58 起执行）。

## 四、发布流程

```bash
# 1. 更新版本号（手动或跑 sync-version.ts 脚本）
# 2. 同步到所有版本文件（共 6 个）
# 3. 同步 README.md（强制）：badge URL + 「当前版本」文案 + 新增本版 changelog 段落
# 4. 更新 CHANGELOG.md
# 5. git commit -m "chore: bump version to vX.Y.Z"
# 6. git tag -a "vX.Y.Z" -m "Release vX.Y.Z"
# 7. git push && git push --tags
# 8. GitHub Actions 自动构建 Release
```

详细操作步骤见 [RELEASE.md](file:///E:/PY/CODES/Liri/RELEASE.md)。

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
