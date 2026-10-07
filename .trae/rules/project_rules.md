---
alwaysApply: true
---
# Liri 项目规则文档
**版本**: 7.18.0 | **更新**: 2026-10-07

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
- 技术栈：TypeScript + Rust；禁止模拟数据；方法禁止重复；禁止 `any` 类型——**新代码零 any**（2026-09-14 校正：本行原写 `@typescript-eslint/no-explicit-any: error`，与实际不符；实际为 `client/eslint.config.js#L32` 的 `'warn'`，且同文件 L59-L63 对部分文件关闭该规则。存量 `any` 11 处 / 8 文件待专项清理，清理后应提升为 `error`）
- **向后兼容策略**：当前应用无正式用户，所有重构/迁移**无需考虑向后兼容**。旧类型、旧文件、旧接口可直接删除或重写，无需保留兼容层或 deprecation 过渡期。待有用户后重新评估此策略。

### 1.4 环境变量规范
前缀分类：`DEEPSEEK_*`(AI)、`SECURITY_*`(安全)、`LOG_*`(日志)、`DATABASE_*`(数据库)、`PERMISSION_*`(权限)、`TOOL_*`(工具)、`CHANNEL_*`(通道)、`A2A_*`(对外 Agent 协议：`A2A_ENABLED` / `A2A_API_KEYS` / `A2A_PUBLIC_URL` / `A2A_DELEGATE_MAX_WAIT_MS`)

**运行时注入（main.ts 自动设置，子进程继承）**：
| 环境变量 | 对应函数 | 路径 | 用途 |
|----------|---------|------|------|
| `OUTPUT_DIR` | `resolveOutputDir()` | `~/.pyapp/output/` | AI 生成文件 |
| `DOWNLOADS_DIR` | `resolveDownloadsDir()` | `~/.pyapp/downloads/` | AI 下载材料 |

**安全相关功能开关（默认值 / 生效语义 / 回退方式）—— R07-2 清单（2026-10-07）**

> **唯一事实源约定**：本表与 `app/src/core/featureFlags.ts` 的**字面默认值**必须一致，由
> `bun run lint:doc-code`（`scripts/check-doc-code-consistency.js` 的 `SAFETY_SWITCHES`）**逐项断言**
> —— 任一侧改单边即 **CI 阻断**（防「误翻转安全开关」静默改变安全姿态）。
> 改默认值时必须**同批**更新本表 + 断言表，并在台账登记理由。
>
> 清单规模：**11 项**（2026-10-07 起；P26-2 P4 新增 `OUTPUT_GUARD_KEEP_ORIGINAL`）。

| 开关 | 默认 | 生效语义 | 回退方式 |
|------|:----:|---------|---------|
| `VERIFIER_FAIL_CLOSED` | `true` | 验证器失败即判失败（**不静默通过**） | `FEATURE_VERIFIER_FAIL_CLOSED=false`（灰度回退旧行为） |
| `PERMISSION_CHECKS` | `true` | 工具执行前权限校验 | `FEATURE_PERMISSION_CHECKS=false` |
| `SECURITY_SCAN` | `true` | 输入安全扫描 | `FEATURE_SECURITY_SCAN=false` |
| `SECURITY_AUDIT` | `true` | 安全审计留痕 | `FEATURE_SECURITY_AUDIT=false` |
| `SANDBOX` | `true` | 沙箱隔离执行 | `FEATURE_SANDBOX=false` |
| `UNATTENDED_MODE` | `false` | 无人值守（**默认关**，须显式开启） | `FEATURE_UNATTENDED_MODE=true` |
| `OUTPUT_GUARD` | `false` | 输出侧护栏（PII 打码 / 注入回显观测） | `FEATURE_OUTPUT_GUARD=true`；**翻转前须满足 [guardrails-dual-side.md §9.2](../specs/guardrails-dual-side.md) 的 P1–P5 前置**（MIT 协议头邮箱与密钥字段 FP、静默改写、不可逆落盘） |
| `OUTPUT_GUARD_BLOCK` | `false` | 护栏改为**阻断**（仅 `OUTPUT_GUARD=true` 时生效） | `FEATURE_OUTPUT_GUARD_BLOCK=true` |
| `OUTPUT_GUARD_KEEP_ORIGINAL` | `false` | 护栏**改写审计**（`validation/output_guard_applied`）是否连**原文**一起落盘；**默认只记元数据**（动作/护栏名/原文长度/原文 SHA-256） | `FEATURE_OUTPUT_GUARD_KEEP_ORIGINAL=true`；**开 = 未打码内容落入本地事件日志**（P26-2 P4 隐私取舍） |
| `RESOURCE_GOVERNOR` | `false` | 跨会话准入 / 抢占 / 排队（P26-1） | `FEATURE_RESOURCE_GOVERNOR=true` |
| `PRO_SECURITY_SUITE` | `false` | 高级安全套件 | `FEATURE_PRO_SECURITY_SUITE=true` |

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

### 1.6 Write-Ahead Persistence（写前持久化）规范

**核心原则**：渲染所依赖的数据必须先落盘，再从持久层读取后渲染。禁止"内存优先 → 异步落盘"模式。

#### 适用范围
所有流式数据、会话状态、消息数据、Block 数据。

#### 具体规则

1. **关键节点即时落盘**：以下节点必须立即（immediate=true）触发持久化，不可依赖防抖：
   - tool_call 完成/失败时（`status === 'completed' | 'failed'`）
   - 输出截断/流结束时（`finishReason === 'length'`）
   - 会话切换前（`flushPendingSaves` 必须 await 完成，超时保护 3 秒）

2. **非关键节点防抖**：中间文本 chunk 等非关键变更可用 200ms 防抖，减少写放大。

3. **前端渲染从持久层读**：切换会话时必须从后端 HTTP `getSessionMessages()` 读取完整数据再渲染，禁止依赖内存缓存。当前实现：
   - `sessionStore.switchSession()` → `sessionService.getMessages(id)` → `chatCoordinator().setMessages(messages)`

4. **读一致性保证**：落盘操作完成（HTTP 响应返回）后，切换会话的读取操作才能开始。`stopMessage()` 和 `flushPendingSaves()` 必须在 `getMessages()` 之前完成。

5. **超时保护**：所有 flush/落盘操作必须有超时保护（上限 3 秒），防止 HTTP 挂起阻塞用户体验。

6. **后端消息持久化**：`ChatManager.streamMessage()` 中生成的助手消息必须在 yield `done` chunk 之前完成 `_addAndPersistMessage()` 持久化。`CoreAPIImpl.chatStream()` 从 `result.value` 中读取已持久化的消息 ID 构建最终响应。

#### 违反示例
```typescript
// ❌ 禁止：切换会话前不等待落盘完成
chatCoordinator().stopMessage();
// 直接切换到新的会话 — flushPendingSaves 未调用

// ✅ 正确：先停止流，再落盘，确认后切换
chatCoordinator().stopMessage();
await chatCoordinator().flushPendingSaves();  // 超时保护 3 秒
const session = await sessionService.switch(id);
const messages = await sessionService.getMessages(id);  // 从盘读
chatCoordinator().setMessages(messages);
```

#### 「模型可见 ⇔ 已落盘」红线（强制，2026-09-22 新增；对标 deepseek-harness）

**任何进入模型请求的内容，都必须能从事件日志（`events.jsonl`）重建。新增"模型可见输入"必须同批新增一个 session 事件。**

- **事实源**：`app/src/session/types/events.ts` 的 `LiriEventType`（类型联合）与 `LiriEventMap`（载荷）；读取/写入校验在 `app/src/session/types/knownEventTypes.ts`。（2026-10-01 B11 本体：原 `app/src/chat/types/` 整目录迁入 `app/src/session/types/`，**拍平**；见 [layer-inversion-service-app-app-ui.md](../specs/layer-inversion-service-app-app-ui.md) 的 B11 执行记录）
- **三处必须同批同步**（现由**编译期**强制，不依赖人工记得）：
  1. `LiriEventType` 联合；
  2. `LiriEventMap` 载荷 —— 由 `LiriEvent<T>.data: LiriEventMap[T]` 的泛型索引强制；
  3. `ALL_SESSION_EVENT_TYPES` 登记清单 —— 由 `knownEventTypes.ts` 末尾的**穷尽断言**强制（漏登记 ⇒ `TS2322: Type 'true' is not assignable to type 'never'`）。
- ❌ 禁止：把提示词、工具/技能清单、注入上下文、检索结果等**模型可见输入**只写进内存或投影（`messages.jsonl`），而不落为事件。
- ❌ 禁止：事件类型变更只改类型联合/载荷而不改登记清单（或反之）。
- **为什么需要**：这是轨迹视图、回放与审计"可复现"的前提 —— 缺了它，"模型当时看到了什么"无法回答，且新增输入可绕过事件日志而**不被任何机制发现**（本约束在参照仓库以仓库级 `AGENTS.md` 红线强制同一语义）。

**验收**：`bun run typecheck` 必须能捕获漏登记（改 ①/② 而不改 ③ ⇒ 编译失败，已实测：移除一个登记项即报 `TS2322`）；涉及模型可见输入的功能变更，须在方案/PR 中给出对应的事件类型。

#### 1.4.1 文件上传规范（强制执行）
上传入口统一：client 端使用 `fileService.upload()`/`uploadBase64()`，app 端使用 `AttachmentManager` 保存到 `~/.pyapp/attachments/`。
禁止 `path.resolve(process.cwd(), 'uploads')` 或任何项目目录下的自定义 upload 目录。

### 1.5 模型数据一致性规范（数出同源）

**核心原则**：数据库是模型/Provider 的**唯一事实来源**，运行时必须从 DB 同步。禁止"数据库有但运行时无"或"UI 显示但实际不可用"。

**强制规则**：
1. `handleListModels()` 返回的 Provider 必须在 `ProviderRegistry` 中已注册（`syncDBProvidersToRegistry()` 确保）
2. 所有创建/更新/删除操作必须通过 `ProviderManager`（写 DB `providers` 表），再通过 `ProviderSyncService` 同步到运行时
3. 启动入口不得 `providerRegistry.getOrCreate()` 手动注册，必须从 `syncDBProvidersToRegistry()` 获取
4. 环境变量回退仅当 DB 中无对应记录时作为 fallback

**实现管线**：`用户配置 → ProviderManager（写 DB providers 表） → ProviderSyncService.syncDBProvidersToRegistry() → ProviderRegistry（运行时） → getByModel() / getByType()`

**红线**：
- ❌ `repl.ts`/`main.ts` 中手动 `getOrCreate('ollama', ...)` ❌ 返回的 Provider 在运行时不存在 ❌ 绕过 `ProviderManager` 直接修改 `ProviderRegistry`

### 1.6 规则文件索引
| 文件 | 生效 | 用途 |
|------|------|------|
| `project_rules.md` | 始终 | 本文件，编码规范 |
| `coding-standards.md` | 始终 | 编码铁律（CS01-CS07，AI 可执行） |
| `paths.md` | 磁盘IO时 | 路径使用规范 |
| `frontend.md` | 前端开发 | 前端规则 |
| `architecture.md` / `architecture-compliance.md` | 架构/重构/审查 | 架构原则 + 合规规则（R01–R06；**R00 分层**见下方事实源） |
| `development-workflow.md` | 开发任务 | 开发流程 |
| `versioning.md` | 版本规划 | 版本管理 |
| `operations.md` | 部署/安全 | 运维Checklist |
| `benchmark-rules.md` | 手动`#Rule` | 对标分析规范 |

> 架构合规规则配套检查脚本 `bun run lint:arch`。涉及基础设施复用、数据模型统一、模块边界控制时必须查阅。
>
> **分层模型唯一事实源**：`scripts/modules-to-layers.json`（`layerOrder` / `allowedDependencies` / `modules`）。层序 `entry > ui > app > service > infra > core`；任何规则文档中的层表若与之冲突，**以事实源为准**（层表与判据见 `architecture-compliance.md#R06-008`，2026-10-01 已按事实源重写）。

#### 1.6.1 前后端接口清单（强制）

接口唯一事实来源为 **[api-spec.md](file:///E:/PY/CODES/PY_APP/.trae/docs/api-spec.md)**。涉及新增/修改 HTTP/IPC 调用、调试数据不一致、PR 跨端变更时必须先查阅。

**核心原则**：
1. 后端 HTTP 路由和 Rust IPC 命令必须在清单中有对应条目
2. 前端服务方法必须与清单 §4 映射表一致
3. 新增接口优先 HTTP（`/v1/*`），Rust IPC 仅 fallback
4. 清单中标注的已知缺口（§5），新增功能时应同步补齐

### 1.7 前端规范
详见 [frontend.md](file:///E:/PY/CODES/Liri/.trae/rules/frontend.md)。React 19 + TS + Tauri 2 + TailwindCSS + Zustand；禁止 Mock；PascalCase + `.tsx`。（2026-09-15 校正：本行原写 "React 18"，与实测不符——`client/package.json` 实际为 `react` / `react-dom` **19.3.0**（校正前实测 19.2.8）、`@testing-library/react` **16.3.3**、`@types/react(-dom)` 19.3.0。同批已同步：`frontend.md §3.1` 技术栈表、`AGENTS.md` 第二层规则表。）

### 1.8 日志规范
**唯一入口**：`monitoring/logs/Logger.ts`。❌ 禁止 `utils/log`、`utils/logger`（已删除）、`utils/monitoring`、`console.log`。

**优先使用门面 `getLogger(module)`**，命名约定 `<大模块>:<子模块>`（如 `channels:registry`、`session:gateway`）。

```typescript
import { getLogger } from '@modules/monitoring';
const logger = getLogger('channels:registry');  // ✅ 推荐（默认 INFO/json，同 module 复用单例）

// 仅当需**自定义配置**（level / format / source / colorize / otelTraceEnabled 等）时才直接构造，
// 并注明理由：
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
const logger = new Logger({ level: LogLevel.DEBUG, module: 'channels:registry' });  // ✅ 例外（需注明理由）
const logger = new Logger({ level: LogLevel.INFO });  // ❌ 缺 module
```

> 架构门禁 **R11-001** 会扫描任何直接构造（`new Logger(`）并记 warning：**默认形态（INFO/json）一律走 `getLogger(module)`**；
> 自定义配置属"存量回退清单"，需人工确认。2026-09-24 已按此收敛 `monitoring/memProfile.ts`、`monitoring/memoryPressure/MemoryPressureMonitor.ts`。

### 1.9 错误处理规范
**唯一入口**：`error/types.ts` 的 `AppError`。**所有 catch 块必须通过 `handleError()` 统一处理**，禁止手写 `logger.error + tracker.record`。

```typescript
import { handleError } from '@modules/error/handleError';
try { await riskyOperation(); }
catch (e) { await handleError(e, { module: 'channels:web', action: 'connect' }); }

// ❌ 禁止：手写分散处理 + 空 catch
catch (e) { logger.error(e.message); tracker.record(e); }
try { nonCriticalOp(); } catch { /* @ignore-catch 缺注释 */ }
```

**`handleError()` 内部职责**：非 `AppError` 自动包装 → Logger 记录 → `ErrorTracker.record()` → 可选 `rethrow`。不做 EventBus publish（由桥接层订阅 ErrorTracker 事件后转发）。

**`@ignore-catch` 注释规范**：非关键路径 catch 块如不调 `handleError()` 必须标注原因。

#### 1.9.1 其他关键规则
- **业务异常必须 `throw new AppError()`**，禁止 `logger.warning` 替代（错误到不了 ErrorTracker）
- **failure-logs JSON schema** 必须包含 AppError 核心字段（`error`、`category`、`severity`、`errorCode`、`errorStack`、`context`、`retryCount`/`maxRetries`、`startedAt`/`failedAt`）
- **预存错误发现即记录**到 `dev_docs/error_repairs/预存错误与待处理问题.md`
- **全局异常兜底**：main.ts 必须注册 `unhandledRejection` + `uncaughtException`，调 `handleError()` 处理
- **顶层 catch**：`AppError` 仅 CRITICAL/HIGH 级别 publish 到 globalEventBus

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

**路径注册表唯一入口**：`core/paths.ts`，所有路径通过 `@modules/core/paths` 获取。❌ 禁止 `@modules/config/paths`（已删除）、`path.join(homedir(), '.pyapp')`、`process.cwd()` 拼路径、`join(resolveDataDir(), 'xxx')` 绕过已有函数、在 constants.ts 中自建路径常量。

```typescript
import { resolveOutputDir, resolveDbPath } from '@modules/core/paths';  // ✅
```

**三层路径**：
| 层级 | 函数 | 路径 |
|------|------|------|
| 第一层（代码文档） | `resolveDocsDir()` | `{root}/app/docs/` |
| 第二层（项目数据） | `resolveDataDir()` / `resolveDataSubDir()` | `~/.pyapp/data/` |
| 第三层（用户数据） | `resolvePyappHome()` | `~/.pyapp/` |
| DB / 缓存 | `resolveDbPath()` / `resolveCacheDir()` | `~/.pyapp/data/`（DB: `~/.pyapp/data/app.db`；缓存: `~/.pyapp/data/cache/`） |
| 输出 / 下载 / 临时 / 附件 / 媒体 | `resolveOutputDir/DownloadsDir/TempDir/AttachmentsDir/MediaDir()` | `~/.pyapp/{output,downloads,temp,attachments,media}/` |

完整函数列表见 [paths.ts](file:///E:/PY/CODES/PY_APP/app/src/core/paths.ts)。命名统一 `~/.pyapp/`，禁用 `~/.Liri/`。

**环境变量语义**（⚠️ 2026-09-11 O11 修正：此处原写作 `PYAPP_*`，与代码不符，按文档配置会**静默失效**）：`LIRI_PROJECT_DIR`（项目根目录）、`LIRI_DATA_DIR`（第二层）、`LIRI_HOME`（第三层），均由 `pyapp.ts` 设置。代码常量定义见 [paths.ts](file:///E:/PY/CODES/PY_APP/app/src/core/paths.ts)（`ENV_LIRI_PROJECT_DIR` / `ENV_LIRI_DATA_DIR` / `ENV_LIRI_HOME`）。

**目录变更步骤**：①搜索 `backend/` 等旧路径 ②更新 `core/paths.ts` ③更新健康检查/监控引用 ④更新文档/Docker/`.gitignore` ⑤`bun run typecheck` ⑥验证健康报告

**红线（一票否决）**：❌ `join(homedir(), '.pyapp')` ❌ `process.cwd()` 拼路径 ❌ 硬编码相对路径 ❌ 自建 fallback ❌ 新建 `.db` 文件 ❌ 表名冲突

### 1.14 通道系统规范

**唯一真相源**：`src/channels/` 为实现层，`core/gateway/` 为遗留兼容层（仅状态同步）。

**注册唯一入口**：`ChannelBootstrapper.bootstrap()` → `channelRegistry.register()`。❌ 绕过 Registry 直接注册 ❌ 新模块依赖 `core/gateway/` ❌ `ChannelManager` 新增业务逻辑（已 @deprecated）。`register()` 内置双重注册守卫。

**消息路由统一**：所有入站消息必须走 `routeChannelMessage()`。管线：`①帧验证(非空/时间戳/格式/大小/安全) → ②去重(channels/dedup/index.ts) → ③共享会话写入 → ④会话创建/复用 → ⑤CoreAPI.chat() → ⑥出站回调`。❌ 绕过 `routeChannelMessage()` 直调 `CoreAPI.chat()` ❌ 自建去重 ❌ 适配器自建帧验证。

**事件总线分层**：`ChannelEventBus`（独立实例）与 `globalEventBus` 选择性桥接：
- **不上桥**：`heartbeat`、`streaming_token`（高频，通道内部）
- **上桥**：`message_inbound → task:created`、`error → channel:critical_error`、`connected_count_changed`、`registered`、`config_changed/app:shutdown/app:initialized` 向下桥接
- **红线**：❌ `globalEventBus` 上发布高频通道事件 ❌ 通道模块直接依赖 `globalEventBus`

**通道上限**：环境变量 `CHANNEL_MAX_COUNT`，默认 **10**（非 Infinity）。启动日志输出配额比率，超限输出 warning。

**废弃代码**：遗留模块（`ChannelManager`、`GatewaySetup`、`GatewayTool`）构造函数必须 `process.emitWarning('已废弃', 'DeprecationWarning')`。

**DevicePairingService**：归属 `channels/`，通过 `ChannelEventBus` 通信，不依赖具体通道实现。

**Logger module 命名约定**：`channels:<子模块>`（如 `channels:registry`、`channels:web`、`channels:routing`、`channels:setup`）。

### 1.15 技能系统规范（来源归一化）

**三来源唯一模型（物理目录隔离，禁止混放）**：

| 来源 | 唯一事实源 | 位置 |
|------|-----------|------|
| 内置 | `BundledSkillLoader`（程序化数组，10 个 prompt 型） | `src/skills/loaders/sources/BundledSkillLoader.ts`，启动经 `initBuiltinSkills` 注册到 `skillRegistry` 单例 |
| 用户 | SKILL.md（YAML front matter） | `~/.pyapp/skills/<name>/SKILL.md` |
| 第三方 | ClawHub 等市场安装 | `~/.pyapp/skills/vendor/<safeId>/`（`resolveVendorSkillsDir()`，`LocalSkillStore` 默认路径，`getSkillInstallPath` 做 `[:\/\\]→_` 映射） |

**强制规则**：
1. ❌ 禁止重建 `src/skills/builtin/` 目录——内置唯一来源是 BundledSkillLoader，SKILL.md 目录从未存在
2. ❌ 禁止把第三方技能存到 `~/.pyapp/skills/` 根目录（用户目录）——物理隔离是来源识别的唯一依据
3. ❌ 禁止用 `path.join(homedir(), '.pyapp', 'skills')` 等拼路径——统一 `resolveUserSkillsDir()` / `resolveVendorSkillsDir()`
4. **verify 不是技能**：机械验证是工具函数 `query/verifyProject.ts`（TAORLoop/PDCA reviewStep 直连），禁以 skill 形式重造；BundledSkillLoader 中的 `verify` 仅为 prompt 型指导技能
5. **启动自动加载**：已安装第三方技能由 `init.ts` `adapter.loadSkills()` 注册进 registry（仅安装时实时注册不够）
6. **技能仅提示词注入**：❌ 禁止 shell 执行（SkillPreprocessor 无 execSync、SkillTool 无 shell 分支）；危险能力（shell/paths/allowed-tools/hooks）必须用户确认
7. **文件操作入口**：删除/克隆/列表/关联内容/启用禁用/导入一律 `validateSkillId`（safeSkillId.ts 在 `skills/loaders/adapter/`）
8. **文档一致性**：`app/docs/SKILLS.md` 与 `插件系统/skills.md` 列出的内置技能必须与 BundledSkillLoader 实际数组一致，禁止虚构技能名
9. **统一来源契约（SkillProvider）**：新增技能来源必须实现 `SkillProvider`（`skills/loaders/SkillProvider.ts`：name/list/get/invalidate，候选含 rank/locator）；Bundled/File/MCP/Plugin 四加载器 + ClawHub 适配器已实现。❌ 禁止新增"只实现 loadSkills 的来源"——统一经 `collectSkillsFromProviders` 聚合
10. **技能注入索引全量（2026-09-01 根源修复）**：`<available_skills>` 注入必须列出**全部** prompt 型启用技能名（渐进披露仅列名，token 极小）；❌ 禁止按数量截断注入列表（曾致用户新增技能按注册顺序靠后被挤出、模型永不可见——"添加的技能死活找不到"根因）。`SkillInjectionService.maxActiveSkills` 仅作历史兼容字段，不再参与截断
11. **`impl` 为必填（2026-10-06 订正；原「可选」表述失实）**：`skills/types/index.ts` 的 `Skill.impl: SkillImplementation` **必填** —— 全部 **5 处生产构造点**均提供 `impl`（`skills/services/SkillInjectionService.ts` · `skills/utils/skillParser.ts` · `skills/loaders/sources/BundledSkillLoader.ts` · `skills/loaders/adapter/RemoteSkillHubAdapter.ts` · `skills/loaders/adapter/clawhub/{ClawHubConverter,ClawHubAdapter}.ts`；2026-10-06 取证）。**原第 6 处 `skills/services/skillService.ts` 已于 2026-10-07 随 P2-8 ② B 类复核删除**（全仓零消费者；连带其专用的 4 个 Track C 桥接类型 `SkillInfo`/`SkillExecutionResult`/`SkillServiceConfig`/`SkillDefinition`）。**不存在「合法的无 `impl` 技能」**：无 `impl` 既不能展示也不能执行，无对应语义 ⇒ 读取点**无需**写缺失回退（CS03：不为生产中不可达的形态加防御）。`SkillRegistry.register` 内的 `skill.impl?.kind` **仅**为历史测试 mock 的容错（其注释所指回归用例现已不存在）。❌ 禁止 `!` 非空断言、`as any`、`@ts-ignore` 绕过类型；新增读取点以 `impl` 必填为准，`bun run typecheck` 是强制检查点
    > ⚠️ **订正依据**：原表述（"2026-09-13 V-14 类型契约收敛：`Skill.impl?` 可选 + 所有读取方必须处理缺失 + 改回必填即编译失败"）**在代码与台账中均无落地证据**（类型始终为必填；台账无 V-14 记录）⇒ 按**代码事实**订正。取证见 `dev_docs/任务计划-20261004.md §17.4-B`。

**前端展示**：`GET /v1/skills/system` 的 `source` 按真实来源映射（builtin/official/third_party/user）；`handleListSystemSkills` 用户扫描必须 `exclude:['vendor']` 避免用户/第三方混淆。

### 1.16 工具注册表与生命周期规范（归一化 2026-09-01）

**工具注册表单一（唯一写入口）**：
- 唯一写入口：`getToolRegistry()`（`src/tools/ToolRegistry.ts` 全局单例）
- `ToolManager` 为兼容门面：构造统一 `options.registry || getToolRegistry()`。❌ 禁止 `new ToolRegistry()` + `setToolRegistry()` 覆盖全局（曾致 MCP/插件注册目标分裂）
- `globalToolManager`（`tools/core/ToolManager.ts`，**Proxy 包装层**，暴露 `getInner(): EnhancedToolManager`）与 `getToolManager()`（`tools/ToolManager.ts`，**增强层本体**，暴露 `loadBuiltinTools()` / `getRegistry()`）是**两个同名类**、**不是同一实例** —— 包装层经 `getInner()` 取到增强层。
  - ⚠️ **2026-10-02（D-229）订正**：本行原文写「二者为同一实例」，**与实测不符**（D-227 依赖反转改造时实际抛 `TypeError: this.toolManager.getInner is not a function`）。需要「加载内置工具 + 取注册表」时须经 `getInner()`；`getCoreAPI().getToolManager()` 门面返回的是**包装层**。取证见 `dev_docs/error_repairs/预存错误与待处理问题.md`（§1.16 表述不准条）

**注册 → disposer 约定（EffectScope 模式）**：
- skill/plugin/MCP 三方统一：注册返回 disposer，注销按 LIFO 逆序执行
- MCP：`MCPToolBridge.registerServerTools` 返回 disposer（ToolManager 注销 + mcpToolRegistry 清理 + dependencyRegistry.withdraw）

---

## §2 版本历史
- **v7.18.0**: §1.4 安全开关清单 **10 → 11 项**，新增 **`OUTPUT_GUARD_KEEP_ORIGINAL`**（默认 `false`）—— 承接 **P26-2 P4**（护栏改写审计）：`validation/output_guard_applied` 事件**默认只记元数据**（动作/护栏名/原文长度/原文 SHA-256），**开 = 未打码内容落入本地事件日志**（用户裁定 2026-10-07「默认元数据 + 开关放行原文」）。同批已按 R07-2 机制更新 `SAFETY_SWITCHES` 断言（10 → 11）
- **v7.17.0**: §1.4 `A2A_*` 清单中 `A2A_API_KEY` → **`A2A_API_KEYS`**（**多钥清单**，逗号分隔；每项 `key` 或 `key@<ISO-8601>` 过期时刻）—— 承接用户裁定「零中断轮换」（2026-10-07；`A2A_ENABLED` 仍默认关闭、**无有效钥 ⇒ 401** 不变）。设计与流程见 `.trae/specs/a2a-multikey-rotation.md`（§8.4 原为"不做"占位，本批改为已实施）
- **v7.16.0**: §1.4 新增「**安全相关功能开关**」清单（**10 项**默认值 + 生效语义 + 回退方式），并由 `bun run lint:doc-code` 的 `SAFETY_SWITCHES` **逐项断言**（代码 `featureFlags.ts` 字面值 **∩** 本表）—— 单边改动（尤其**误翻转 `OUTPUT_GUARD`**）即 CI 阻断。来源：台账 §24-**R07-2**（外部报告 §五-P1-3）
- **v7.15.0**: §1.15-11 **订正** —— 「`impl` 为可选（V-14 契约收敛）」**表述失实**（类型始终必填、台账无 V-14 记录、6 处生产构造点全部提供 `impl`）⇒ 改为如实表述「**`impl` 为必填**；无合法的无 `impl` 技能，读取点无需缺失回退」。取证：`dev_docs/任务计划-20261004.md §17.4-B`（来源 `.pyapp/output/技能系统缺陷排查报告.md` 复核）
- **v7.14.0**: §1.4 增补 `A2A_*` 环境变量前缀（对外 Agent 协议：`A2A_ENABLED` / `A2A_API_KEY` / `A2A_PUBLIC_URL` / `A2A_DELEGATE_MAX_WAIT_MS`）—— 承接 A2A 对外面（P3-1 / F2，2026-09-29；分发=OS 环境变量、轮换=单钥文档化，见 `.trae/specs/a2a-external-exposure.md` §8）
- **v7.13.0**: §1.8 日志规范口径与门禁 R11-001 对齐 —— 优先 `getLogger(module)`（默认 INFO/json，同 module 复用单例）；仅需自定义配置（level/format/source/colorize/otelTraceEnabled）时才直接构造并注明理由。同批已按此收敛 `memProfile.ts`、`MemoryPressureMonitor.ts` 两处默认形态
- **v7.12.0**: §1.6 新增「模型可见 ⇔ 已落盘」红线（事件类型三处同步改为**编译期强制**：`ALL_SESSION_EVENT_TYPES` 清单 + 穷尽断言；`KNOWN_SESSION_EVENT_TYPES` 从清单派生）—— 对标 deepseek-harness 仓库级约束，补齐"可重建性"的制度落点（轨迹对标 P0-2）
- **v7.11.0**: §1.15 技能来源契约（SkillProvider：list/get/invalidate + rank/locator，四加载器 + ClawHub 收敛）与技能注入索引全量（根治用户技能被截断不可见）；§1.16 工具注册表单一 + 注册→disposer 生命周期约定（MCPToolBridge 对齐 EffectScope）
- **v7.10.0**: §1.9 错误处理强化（handleError 统一入口、@ignore-catch、全局兜底）；§1.14 通道规范（双轨制收敛、注册/路由/事件总线/上限/废弃标记）；§1.6 Write-Ahead Persistence 规范；§1.15 技能系统规范（来源归一化：BundledSkillLoader/用户/第三方 vendor 三源隔离，verify 降级工具函数）
- **v7.9.0**: §1.5 模型数据一致性规范（数出同源）
- **v7.8.0**: §1.5 第二层数据目录移至 `~/.pyapp/data/`
- **v7.7.0**: §1.13 路径注册表迁移至 `core/paths.ts`，全项目统一 `@modules/core/paths`
- **v7.6.0**: §1.6.1 前后端接口清单（api-spec.md）
- **v7.5.0-v4.x**: 数据库约定、Logger 唯一入口、规则文件拆分、MCP/通道/安全/测试规范
