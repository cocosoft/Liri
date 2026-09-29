---
description: 文件路径使用规范与统一路径管理规则，适用于所有涉及磁盘读写、文件持久化、数据存储等需要文件路径操作的场景。包含路径分层架构（L1/L2/L3）、路径使用决策矩阵、七条红线与审查清单。
---

# 文件路径使用规范 / Path Usage Rules

> 所有涉及磁盘读写、数据持久化、配置文件加载等需要文件路径操作的场景，遵循本规则。
>
> **详细规范说明见**：[`.trae/docs/路径使用规范.md`](file:///e:/PY/CODES/PY_APP/.trae/docs/路径使用规范.md)

---

## §1 核心原则

**所有文件路径操作必须通过 `core/paths.ts` 获取，禁止绕过。**

`core/paths.ts` 是统一的路径管理中心，提供 36+ 个 `resolve*` 导出函数，覆盖以下三层架构：

| 层级 | 目录 | Git 跟踪 | 用途 | 根函数 | 典型数据 |
|------|------|----------|------|--------|---------|
| **L1：代码文档** | `app/`（除 `app/data/`） | ✅ | 源代码、文档、内置资源 | `resolveProjectRoot()` | — |
| **L2：项目数据** | `app/data/` | ❌ | 项目级运行时数据 | `resolveDataDir()` | 数据库、会话、日志、缓存、项目记忆、治理审计 |
| **L3：用户数据** | `~/.pyapp/` | ❌ | 用户级跨项目数据 | `resolvePyappHome()` | 用户配置、个人记忆、OAuth 令牌、权限规则、附件 |

**数据归属判断标准**：属于「这个项目」→ L2，属于「这个用户」→ L3，属于「这段代码」→ L1。

---

## §2 路径使用决策矩阵

| 场景 | 函数 |
|------|------|
| 项目根目录 | `resolveProjectRoot()` |
| 数据库 | `resolveDbPath()` |
| 会话数据 | `resolveSessionsDir()` / `resolveSessionFilePath(id)` |
| 日志 | `resolveLogsDir()` |
| 缓存 | `resolveCacheDir()` |
| 记忆 | `resolveMemoryDir()` / `resolveTeamMemoryDir()` / `resolveUserMemoryDir()` |
| 附件 | `resolveAttachmentsDir()` / `resolveAttachmentsDateDir()` |
| 文档 | `resolveDocsDir()` |
| 用户配置 | `resolveUserConfigPath()` / `resolveUserSettingsPath()` |
| 安全数据 | `resolveSecurityDir()` / `resolveOAuthDir()` / `resolvePermissionsDir()` |
| 治理审计 | `resolveGovernanceDir()` |
| 确保目录存在 | `ensureDir(dirPath)` |
| 新增数据子目录 | `resolveDataSubDir(name)` |

**决策树**：`L1（代码/文档）→ resolveProjectRoot() 拼接 | L2（项目数据）→ resolveDataDir() 或专用函数 | L3（用户数据）→ resolvePyappHome() 或专用函数 | 用户工作目录 → process.cwd()（仅工具操作的目标目录）`

---

## §3 路径使用红线

| # | 禁止项 | 正确做法 |
|---|--------|---------|
| R1 | `__dirname`（编译 exe 后指向临时目录） | 用 `resolve*` 函数 |
| R2 | `process.cwd()` 做持久化 | 用 `resolve*` 函数 |
| R3 | 在 `core/paths.ts` 外自建路径解析逻辑 | 收敛到 `core/paths.ts` |
| R4 | 在 `pyapp.ts` 外自行解析根目录 | 由 `pyapp.ts` 统一处理 |
| R5 | 硬编码路径字符串（含 `./` 或绝对路径） | 用 `resolve*` 函数 |
| R6 | 新模块自己实现路径函数 | 必须用 `core/paths.ts` |
| **R7** | **L2/L3 数据混放** | 严格区分项目数据 vs 用户数据 |

> **R7 是最重要的规则**。`process.cwd()` 仅在「获取用户当前工作目录」场景下允许（如 Bash/CD 等工具操作的目标目录），**禁止用于持久化**。

### 数据归属速查

| L2（项目数据 → `resolveDataDir()`） | L3（用户数据 → `resolvePyappHome()`） |
|--------------------------------------|---------------------------------------|
| 数据库（`app.db`）、会话文件、日志、缓存 | 用户配置、设置、个人记忆 |
| 项目记忆、团队记忆、治理数据、安全审计 | OAuth 令牌、权限规则、附件、技能 |

---

## §4 典型错误速查

| 错误写法 | 正确写法 | 风险 |
|---------|---------|:----:|
| `join(process.cwd(), 'app', 'data', 'app.db')` | `resolveDbPath()` | P0 数据丢失 |
| `join(__dirname, '..', 'sessions')` | `resolveSessionsDir()` | P1 写入临时目录 |
| `join(__dirname, '..', 'skills')` | `join(resolveProjectRoot(), 'app', 'skills')` | P2 资源加载失败 |
| `join(process.cwd(), 'data', 'logs')` | `resolveLogsDir()` | P0 日志丢失 |
| `join(resolvePyappHome(), 'app.db')` | `resolveDbPath()` | P0 L2 数据写 L3 |
| `join(resolveProjectRoot(), 'user-config.json')` | `resolveUserConfigPath()` | P0 L3 数据写 L2 |

---

## §5 新增路径流程 & 参考

**流程**：确定层级 → 在 `core/paths.ts` 新增导出函数 → 若是目录则加入 `ensureDataDirectories()` 创建列表 → `bun run typecheck`

**参考文档**：
- [core/paths.ts](file:///e:/PY/CODES/PY_APP/app/src/core/paths.ts) — 路径管理中心
- [pyapp.ts](file:///e:/PY/CODES/PY_APP/app/src/pyapp.ts) — 启动引导层
- [project_rules.md §1.13](file:///e:/PY/CODES/PY_APP/.trae/rules/project_rules.md) — 路径与依赖管理规范
