---
alwaysApply: true
---
# Liri 项目规则文档
**版本**: 7.9.0 | **更新**: 2026-06-06

## §1 基础规则

### 1.1 安全与合规
- 严禁硬编码敏感信息；禁止出现 Anthropic/CLAUDE 相关内容；严禁删除数据库结构（仅允许新增/修改字段）

### 1.2 开源协议规范
**MIT License**：Rust `.rs` 文件 **必须添加** 协议头，TS/TSX 建议添加。模板见 `.license-header.txt`。
检查命令：
```powershell
# Rust/TS 文件协议头检查
gci -Recurse -Include *.rs | % { if ($(gc $_.FullName -Raw) -notmatch "MIT License") { "Missing: $($_.FullName)" } }
gci -Recurse -Include *.ts,*.tsx | % { if ($(gc $_.FullName -Raw) -notmatch "MIT License") { "Missing: $($_.FullName)" } }
```

### 1.3 开发规范
- 技术栈：TypeScript + Rust；禁止模拟数据；方法禁止重复；禁止 `any` 类型（`@typescript-eslint/no-explicit-any: error`），新代码零 any
- **向后兼容策略**：当前应用无正式用户，所有重构/迁移**无需考虑向后兼容**。旧类型、旧文件、旧接口可直接删除或重写，无需保留兼容层或 deprecation 过渡期。待有用户后重新评估此策略。

### 1.4 环境变量规范
前缀分类：`DEEPSEEK_*`(AI)、`SECURITY_*`(安全)、`LOG_*`(日志)、`DATABASE_*`(数据库)、`PERMISSION_*`(权限)、`TOOL_*`(工具)

**运行时注入（main.ts 自动设置，子进程继承）**：
| 环境变量 | 对应函数 | 路径 | 用途 |
|----------|---------|------|------|
| `OUTPUT_DIR` | `resolveOutputDir()` | `~/.pyapp/output/` | AI 生成文件 |
| `DOWNLOADS_DIR` | `resolveDownloadsDir()` | `~/.pyapp/downloads/` | AI 下载材料 |

### 1.5 文件存储规范

#### 三层分离架构
| 层级 | 根路径 | Git 跟踪 | 定位 |
|------|--------|---------|------|
| 第一层：代码文档 | `app/docs/` | ✅ | 知识库、帮助文档（跟随安装目录） |
| 第二层：项目数据 | `~/.pyapp/data/` | ❌ | 运行时数据 — 部署安全，Program Files 安装也具备写入权限 |
| 第三层：用户数据 | `~/.pyapp/` | ❌ | 配置、记忆、技能（跨项目） |

**细目**：详见 [paths.ts](file:///E:/PY/CODES/PY_APP/app/src/core/paths.ts)。命名统一 `~/.pyapp/`，禁用 `~/.Liri/`。

#### 数据库统一约定
所有模块共用唯一 `app.db`，通过 `resolveDbPath()` 获取。
```typescript
import { resolveDbPath } from '@modules/core/paths';
constructor(dbPath: string = resolveDbPath()) { this.dbPath = dbPath; }
```
表名规则：`{模块前缀}_{表名}`，`CREATE TABLE IF NOT EXISTS` 安全创建。
已注册表：`cost_records/ cost_session_summary/ scheduled_tasks/ task_execution_history/ cron_tasks/ cron_jobs/ cron_executions/ task_states/ task_states_fts/ task_flow/ checkpoints/ suggestion_history/ system_config/ query_logs/ queue_tasks/ sessions/ messages`
- ❌ 禁止新建 `.db` 文件（已合并为 `app.db`）；禁止 `join(resolveDataDir(), 'xxx.db')`；表名必须加模块前缀

#### 1.4.1 文件上传规范（强制执行）
上传入口统一：client 端使用 `fileService.upload()`/`uploadBase64()`，app 端使用 `AttachmentManager` 保存到 `~/.pyapp/attachments/`。
禁止 `path.resolve(process.cwd(), 'uploads')` 或任何项目目录下的自定义 upload 目录。

### 1.5 模型数据一致性规范（数出同源）

**核心原则**：数据库（SQLite）是模型和 Provider 配置的**唯一事实来源**，运行时状态必须从数据库同步，不允许出现"数据库有但运行时无"或"UI 显示但实际不可用"的情况。

**强制规则**：
1. `handleListModels()` 返回的模型列表，其对应的 Provider 必须在 `ProviderRegistry` 中已注册（通过 `syncDBProvidersToRegistry()` 确保）
2. Provider 的所有创建/更新/删除操作必须通过 `ProviderManager`（写入 DB `providers` 表），再通过 `ProviderSyncService` 同步到运行时 `ProviderRegistry`
3. 启动入口（`repl.ts`、`main.ts`）不得使用 `providerRegistry.getOrCreate()` 手动注册 Provider，必须从 `syncDBProvidersToRegistry()` 获取
4. 环境变量回退（如 `DEEPSEEK_API_KEY`）仅在 DB 中无对应记录时作为 fallback

**实现管线**：
```
用户配置（UI/CLI）→ ProviderManager（写入 DB providers 表）
                                   ↓
                    ProviderSyncService.syncDBProvidersToRegistry()
                                   ↓
                    ProviderRegistry（运行时，含 providerTypeToId 类型别名映射）
                                   ↓
                    getByModel() / getByType() 动态查找
```

**红线**：
- ❌ 在 `repl.ts` / `main.ts` 中手动 `getOrCreate('ollama', ...)`（应走 DB 同步）
- ❌ `handleListModels()` 返回的模型对应的 Provider 在运行时不存在
- ❌ 绕过 `ProviderManager` 直接修改 `ProviderRegistry`

### 1.6 规则文件索引
| 文件 | 生效 | 用途 |
|------|------|------|
| `Liri.md` | 始终 | 通用行为准则 |
| `project_rules.md` | 始终 | 编码规范 |
| `paths.md` | 磁盘IO时 | 路径使用规范 |
| `frontend.md` | 前端开发 | 前端规则 |
| `architecture.md` | 架构/重构 | 架构原则 |
| `architecture-compliance.md` | 架构/代码审查 | 架构合规规则（R01-R04，AI 可执行） |
| `development-workflow.md` | 开发任务 | 开发流程 |
| `versioning.md` | 版本规划 | 版本管理 |
| `operations.md` | 部署/安全 | 运维Checklist |
| `benchmark-rules.md` | 手动`#Rule` | 对标分析规范 |

> **架构合规规则**（`architecture-compliance.md`）基于 6 轮双轨制扫描 + 实现模式深度分析制定，配套检查脚本 `scripts/lint-architecture.ts`（`bun run lint:arch`）。涉及基础设施复用、数据模型统一、模块边界控制等场景时必须查阅。

#### 1.6.1 前后端接口清单（强制）

前后端接口的唯一事实来源为 **[api-spec.md](file:///e:/PY/CODES/PY_APP/.trae/docs/api-spec.md)**（`.trae/docs/` 目录，随项目持续更新）。

涉及以下场景时，**必须先查阅该文档**：
- 新增或修改前端 HTTP 请求 / Tauri IPC 调用
- 新增或修改后端 HTTP 路由 / Rust Tauri 命令
- 调试前后端数据不一致问题
- PR Review 中发现跨端变更

**核心原则**：
1. 后端 HTTP 路由和 Rust IPC 命令都必须在清单中有对应条目
2. 前端服务的方法必须与清单 §4 映射表一致
3. 新增接口优先 HTTP 路由（`/v1/*`），Rust IPC 仅作 fallback
4. 清单中标注的已知缺口（§5），新增功能时应同步补齐

### 1.7 前端规范
详见 [frontend.md](file:///E:/PY/CODES/Liri/.trae/rules/frontend.md)。React 18 + TS + Tauri 2 + TailwindCSS + Zustand；禁止 Mock；PascalCase + `.tsx`。

### 1.8 日志规范
**唯一入口**：`monitoring/logs/Logger.ts`。新代码从 `@modules/monitoring/logs/Logger` 导入 `Logger` + `LogLevel`。
❌ 禁止 `utils/log`（兼容层）、`utils/logger`（已删除）、`utils/monitoring`、`console.log`。
```typescript
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
const logger = new Logger({ level: LogLevel.INFO });
logger.info('完成', { toolName, duration: elapsedMs });  // ✅
// ❌ import { Logger } from '@modules/utils/logger';
// ❌ console.log / console.error
```

### 1.9 错误处理规范
禁止吞异常；必须使用 `AppError` + `ErrorCodes`；用户端中文、日志端英文。
```typescript
try { await executeTool(); }
catch (e) { throw new AppError(ErrorCodes.TOOL_EXEC_FAILED, { module: 'ToolExecutor', cause: e }); }
```

#### 1.9.1 预存错误记录（发现即记录）
发现的预存错误（非本次引入）必须**立即记录**到 `dev_docs/error_repairs/预存错误与待处理问题.md`，按 A-G 类分类。不得跳过、不得补记。

### 1.10 入口与启动规范
- 编译入口：`src/pyapp.ts`（`process.chdir()` + 根目录解析）
- 模块入口：`src/main.ts`（`launch()` 统一分发）
- ❌ 禁止直接调用 `main.tsx` / `main_with_modules.tsx` / `index.ts`
- 启动模式：`CLI | REPL | MCP | DAEMON | TEST`

### 1.11 MCP 模块架构
- 标准层：`services/mcp/`（核心类型、客户端、传输层）
- 增强层：`mcp/`（引用标准层，不重复实现）
- ❌ 禁止两套实现重复定义相同类型

### 1.12 术语规范（歧义消除）
| 术语 | 中文 | 含义 | 涉及模块 |
|------|------|------|---------|
| token (LLM) | **词元** | 文本最小单位，按词计费 | `TokenTracker`, `CostTracker` |
| token (Security) | **令牌** | 安全凭据 | JWT, OAuth, API Key |
| memory (Knowledge) | **记忆** | 持久化上下文 | `memory/` 模块 |
| memory (RAM) | **内存** | 运行时资源 | 堆检查、`StorageFactory` |

### 1.13 路径与依赖管理规范

#### 路径导入约定（强制）
路径注册表唯一入口：`core/paths.ts`（核心基础设施）。
```typescript
import { resolveOutputDir, resolveDbPath, ... } from '@modules/core/paths';  // ✅
// ❌ import { ... } from '@modules/config/paths';  // 旧路径，已删除
// ❌ import { ... } from './config/paths';         // 相对路径导入，禁止
// ❌ path.join(homedir(), '.pyapp');               // 硬编码用户目录
```
- ❌ 禁止任何 `@modules/config/paths` 引用（文件已删除，无兼容层）
- ❌ 禁止在 constants.ts 或其他文件中定义路径常量（如 `TEMP_DIR`, `LOG_DIR`）
- ❌ 禁止 `join(resolveDataDir(), 'xxx')` 绕过已有解析函数

#### 路径解析总则
所有路径通过 `@modules/core/paths` 获取，禁止硬编码。入口 `pyapp.ts` 已执行 `process.chdir()`。

#### 三层路径使用规则
| 层级 | 解析函数 | 路径 |
|------|---------|------|
| 第一层 | `resolveDocsDir()` | `{root}/app/docs/` |
| 第二层 | `resolveDataDir()` / `resolveDataSubDir()` | `~/.pyapp/data/` |
| 第三层 | `resolvePyappHome()` | `~/.pyapp/` |
| 数据库 | `resolveDbPath()` | `{dataDir}/app.db` |
| 输出目录 | `resolveOutputDir()` | `~/.pyapp/output/` |
| 下载目录 | `resolveDownloadsDir()` | `~/.pyapp/downloads/` |
| 临时文件 | `resolveTempDir()` | `~/.pyapp/temp/` |
| 附件目录 | `resolveAttachmentsDir()` | `~/.pyapp/attachments/` |
| 媒体存储 | `resolveMediaDir()` | `~/.pyapp/media/` |

完整函数列表见 [paths.ts](file:///E:/PY/CODES/PY_APP/app/src/core/paths.ts)。

#### 环境变量语义
| 变量 | 语义 | 设置位置 |
|------|------|---------|
| `PYAPP_PROJECT_DIR` | 项目根目录 | `pyapp.ts` |
| `PYAPP_DATA_DIR` | 项目数据目录（第二层） | `pyapp.ts` |
| `PYAPP_HOME` | 用户数据目录（第三层） | `pyapp.ts` |

#### 目录结构变更同步规则
修改目录结构时：①搜索 `backend/` 等旧路径 ②更新 `core/paths.ts` ③更新健康检查/监控服务路径引用 ④更新文档/Docker/`.gitignore` ⑤运行 `bun run typecheck` ⑥验证健康报告

#### Code Review 检查清单
- [ ] 使用 `@modules/core/paths` 而非 `path.join()`？
- [ ] 使用 `@modules/core/paths` 而非 `@modules/config/paths`（旧路径，已删除）？
- [ ] 路径前缀 `app/` 而非 `backend/`？
- [ ] 层级正确（项目级→`app/data/`，用户级→`~/.pyapp/`）？
- [ ] 文件工具（FileWrite/Read/Edit）相对路径是否以 `resolveOutputDir()` 为基准？
- [ ] 媒体生成工具（Image/Video/MusicGenerate）是否注入 `resolveOutputDir`？
- [ ] WebFetch 下载内容是否使用 `resolveDownloadsDir()`？
- [ ] 环境变量语义正确？

#### 红线（一票否决，不允许合并）
**路径**：❌ `join(homedir(), '.pyapp')` ❌ `join(resolveDataDir(), 'xxx')` 代替已有函数 ❌ `process.cwd()` 拼路径 ❌ 硬编码相对路径 ❌ 自行实现 fallback ❌ `from '@modules/config/paths'`（旧路径已删除，编译会失败）
**数据库**：❌ 新建 `.db` 文件 ❌ `join(resolveDataDir(), 'xxx.db')` ❌ 表名冲突

---

## §2 版本历史
- **v7.9.0**: §1.5 模型数据一致性规范（数出同源）—— DB 是模型/Provider 的唯一事实来源，运行时必须从 DB 同步，禁止手动硬编码注册
- **v7.8.0**: §1.6 第二层数据目录移至 `~/.pyapp/data/`（部署安全：Program Files 安装也具备写入权限）；pyapp.ts 清理遗留 PROJECT_DIRS
- **v7.7.0**: §1.12 路径导入约定（强制）：路径注册表迁移至 `core/paths.ts`，全项目 108 模块统一 `@modules/core/paths`，config/paths.ts 已删除；文件工具输出目录注入规范；Code Review 新增路径检查项
- **v7.6.0**: §1.5.1 前后端通信开发规则（强制）；新增 `api-spec.md` 接口清单
- **v7.5.0**: §1.4 OUTPUT_DIR/DOWNLOADS_DIR；§1.5 数据库统一约定（唯一 app.db）；§1.12 禁止行为清单
- **v7.4.0**: §1.5 规则文件索引迁移；§1.12 Code Review 清单、环境变量语义规范
- **v7.3.0**: §1.12 三层路径规则、环境变量语义、源码/运行时分离、目录变更同步
- **v7.2.0**: §1.12 路径解析、错误可读性、非关键服务降级、可选依赖检查
- **v7.1.0**: §1.11 token/memory 术语歧义消除
- **v7.0.2**: §1.8.1 预存错误"发现即记录"强化
- **v7.0.1**: §1.7 日志规范强化，Logger 唯一入口
- **v7.0.0**: 规则文件拆分
- **v6.x**: MCP/分区并发/FeatureFlag/安全/守护进程/测试/对标等规范确立
- **v5.x-v4.x**: 对标体系、依赖图、模型数据源等基础设施规则
