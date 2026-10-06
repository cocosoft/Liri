---
description: 架构合规规则（AI 可执行版）。适用于代码审查、PR 检查、架构治理。包含基础设施复用规则、数据模型统一规则、模块边界控制、文件组织规则。每条规则有固定 ID 用于 CI 检查和 AI 引用。
---

# 架构合规规则 / Architecture Compliance Rules

> 规则格式：`[R-ID] [强制级别] 描述`。强制级别：MUST（PR 不通过）/ SHOULD（需说明理由）/ MAY（建议）。
>
> 配套检查脚本：`scripts/lint-architecture.ts`（`bun run lint:arch`）

---

## R01 基础设施复用（MUST）

### R01-001 [MUST] 事件总线唯一性

整个项目只能有一个事件总线实现：`core/events/EventBus.ts` 的 `EventBusImpl`。

**禁止**：
- `extends EventEmitter` 作为事件总线
- 自建 `Map<string, Set<Handler>>` 的事件分发
- `core/extensibility/index.ts` 中的 EventBus 封装（改用核心版）

**例外**：`VoiceEventBus` 可保留自己的状态管理，但事件分发必须委托给 `EventBusImpl`。

**AI 检查要点**：
- 搜索 `extends EventEmitter` → 审查是否是合法的事件源（如 HTTP Server）
- 搜索 `new Map<string, Set<` + handler 模式 → 可能是自建事件总线

### R01-002 [MUST] 错误类继承 AppError

所有自定义错误类必须继承 `error/types.ts` 的 `AppError`。

**禁止**：
- `class XxxError extends Error`（直接继承 Error）
- 定义与 `error/types.ts` 同名的错误类

**标准错误类列表**（禁止重复定义）：
```
AppError, NetworkError, FileSystemError, PermissionError, ValidationError,
ExecutionError, ConfigParseError, ShellError, PluginError, ToolError,
CacheError, SecurityError, APIError, DatabaseError, AbortError,
ModuleError, FallbackTriggeredError, SafeTelemetryError,
MalformedCommandError, LightweightNetworkError, LightweightFileError,
LightweightAPIError, LightweightConfigError
```

**AI 检查要点**：
- 搜索 `class XxxError extends Error` → 必须继承 `AppError`
- 搜索 `export class XxxError` → 检查是否与标准错误类同名

### R01-003 [MUST] 重试逻辑统一使用 withRetry

所有重试逻辑必须使用 `utils/withRetry.ts` 的 `withRetry()`。

**禁止**：
- 在模块内部自建 `for/while` 重试循环
- 定义独立的 `shouldRetry()` 或 `calculateDelay()` 函数

**AI 检查要点**：
- 搜索 `for.*retry` 或 `while.*retry` → 可能是手写重试循环
- 搜索 `function.*[Rr]etry` → 需要审查

**例外**：详见本文末"已知例外"表中 R01-003 条目。

### R01-004 [MUST] 缓存统一使用标准实现

所有需要缓存能力的模块必须使用 `utils/cache.ts` 的 `TTLCache` / `LRUCache` / `MemoryCache` 等标准实现。

**禁止**：
- `private cache = new Map<string, ...>()` 做业务缓存（含自建 TTL/过期逻辑）
- 自建 LRU 或 TTL 逻辑

**例外**：纯注册表/状态存储（如 `Map<string, Plugin>` 的插件注册表）不在此限。

**AI 检查要点**：
- 搜索 `private cache: Map<` → 检查是否存在 TTL/过期手动管理
- 搜索 `interface.*CacheEntry` / `type.*CacheEntry` 配合 `setTimeout` 或 `Date.now()` → 手写 TTL

### R01-005 [SHOULD] 健康检查统一注册

所有健康检查逻辑应统一到 `monitoring/health/HealthChecker.ts` 注册。

### R01-006 [SHOULD] 配置统一访问

配置读取应统一通过 `config/ConfigManager.ts` 或 `UnifiedConfigManager.ts`，而非直接读环境变量（通道配置除外）。

### R01-007 [MUST] 路径解析一致性

所有路径解析必须通过 `@modules/core/paths` 中的标准函数获取，**禁止**在业务代码中硬编码路径或自行拼接。

**禁止**：
- 使用 `join(os.homedir(), '.pyapp', ...)` 直接构造路径（应使用 `resolvePyappHome()` 或 `LIRI_HOME` 环境变量）
- 在非 `paths.ts` 文件中导入 `resolveSoulDir`（它指向 `data/soul/` 第二层，SOUL.md 应使用 `resolveSoulPath()`，USER.md 应使用 `resolveUserProfilePath()`）
- 硬编码 `~/.pyapp/` 路径前缀在错误消息或日志中（应使用运行时实际路径）
- 在 `pyapp.ts` 启动引导代码中硬编码 `os.homedir()/.pyapp/`（应优先读取 `LIRI_HOME`）

**强制范围**：
- 用户级配置（第三层）：`SOUL.md` → `resolveSoulPath()`（`{LIRI_HOME}/SOUL.md`）
- 用户级配置（第三层）：`USER.md` → `resolveUserProfilePath()`（`{LIRI_HOME}/USER.md`）
- 所有层级均通过 `resolvePyappHome()` 解析，其优先级为：`setUserDataDirOverride()` > `LIRI_HOME` 环境变量 > `~/.pyapp/`

**运行时防御**：
- `validatePathConsistency()` 在应用启动时自动检查路径一致性
- 如果 `resolvePyappHome()` 返回值与 `LIRI_HOME` 不一致，会打印 warning 日志
- 如果 `SOUL_PATH`/`USER_PROFILE_PATH` 不在 `LIRI_HOME` 根目录，会打印 warning 日志

**ESLint 检查**：
- `no-restricted-imports`: 禁止导入 `resolveSoulDir`
- `no-restricted-syntax`: 禁止硬编码 `~/.pyapp` 字面量

**AI 检查要点**：
- 搜索 `os\.homedir\(\)` 配合 `.pyapp` → 必须在 `paths.ts` 或 `pyapp.ts` 中，其他文件为违规
- 搜索 `~/.pyapp` → 必须在 `paths.ts` 或 `pyapp.ts` 中，其他文件为违规
- 搜索 `resolveSoulDir` 在非 `paths.ts` 文件中 → 违规

### R01-008 [MUST] 通道事件总线独立分层

通道事件总线 `ChannelEventBus`（`channels/events/ChannelEventBus.ts`）是独立的 `EventBusImpl` 实例，与 `globalEventBus` 通过桥接层选择性转发，不违反 R01-001。

**规则**：
- `ChannelEventBus` 必须使用 `EventBusImpl` 实现（不得自建 EventEmitter 或 Map 分发）
- 高频事件（`heartbeat`、`streaming_token`）**禁止**通过桥接层向上转发到 `globalEventBus`
- 通道模块**禁止**直接依赖 `globalEventBus`，应通过桥接层（`channels/events/bridge.ts`）通信

**AI 检查要点**：
- 搜索 `channels/.*globalEventBus` → 通道模块直接引用 globalEventBus 为违规
- 搜索 `globalEventBus.*channel:heartbeat` 或 `globalEventBus.*channel:streaming` → 高频事件桥接违规

---

## R02 数据模型统一（MUST）

### R02-001 [MUST] Message 模型唯一标准

所有消息传递必须使用 `session/types/message.ts` 的 `Message` 接口。

**禁止**：
- 在 `core/types.ts` 中定义不同的 Message 接口
- 在不同模块中定义类似 `Message` 的接口（通道层 `MessageContext` 除外，它是传输层包装）

### R02-002 [MUST] 禁止同名类型冲突

严禁在项目不同位置定义同名但结构不同的类型。

**AI 检查要点**：
- 扫描所有 `export interface Xxx` 和 `export type Xxx =`
- 对同名类型做结构比较 → 如果结构不同，报告为违规

### R02-003 [MUST] Session 模型统一

会话 ID 统一使用 `acp/types.ts` 的 `SessionId`（branded type）。

---

## R03 模块边界控制（MUST）

### R03-001 [MUST] 禁止自建基础设施

任何模块如果要自建"基础设施类"功能，必须在 PR 中说明理由，且获得架构 review 批准。

**基础设施类清单**（触发审查的关键词）：
```
EventBus / EventEmitter 作为事件总线
Cache / LRU / TTL 管理
Retry / 重试 / 退避
任何 extends Error 的类
Config / 配置管理
Health / 健康检查
```

### R03-002 [MUST] 模块出口单一

每个模块应只有一个 `index.ts` 作为出口，**不鼓励**从子目录直接 import。

- **规范子入口白名单**（`canonicalEntryKeys` 与 `types` 段）不计违规；测试文件统一排除（`TEST_FILE_EXCLUSIONS`）。
- **门禁强度（T-③01，2026-10-03 用户裁定）**：`severity` 由 `warning` **提升为 `error`** ⇒ 违规即 `exit 1`，**阻断 pre-commit 与 CI**（与 R00-001 分层同级）。提升时实测本规则违规 **0**（783 处落白名单，非违规）⇒ 零回归；目的为**防未来回流**（新增子目录直连即提交被拒）。

### R03-003 [MUST] 通道注册唯一入口

所有通道必须通过 `channels/registry/ChannelRegistry.ts` 的 `register()` 方法注册，由 `ChannelBootstrapper.bootstrap()` 统一启动。

**禁止**：
- 绕过 `ChannelRegistry` 直接调用 `ChannelManager.registerChannel()`
- 在 `ChannelRegistry` 外部自行实例化通道并加入注册表
- 新模块引入对 `core/gateway/` 的依赖（应使用 `channels/`）

**AI 检查要点**：
- 搜索 `new ChannelManager` 或 `channelManager.registerChannel(` → 新代码应使用 ChannelRegistry
- 搜索 `import.*from.*core/gateway` 在 `channels/` 目录外的文件 → 审查是否应迁移

### R03-004 [MUST] 消息路由管线统一

所有入站消息必须通过 `channels/routing/messageRouter.ts` 的 `routeChannelMessage()` 统一处理，包含帧验证、去重、会话写入、CoreAPI 调用。

**禁止**：
- 绕过 `routeChannelMessage()` 直接调用 `CoreAPI.chat()`
- 在通道适配器中实现独立的帧验证逻辑
- 自建消息去重逻辑（Set/Map 临时去重实现）

**AI 检查要点**：
- 搜索 `CoreAPI.chat(` 在 `channels/` 目录外的调用 → 可能绕过路由管线
- 搜索 `new Set.*messageId` 或 `Map.*messageId` 配合 `Date.now()` → 可能是自建去重

### R03-005 [MUST] 通道代码修改前置检查

所有通道代码（`channels/` 下各平台实现）修改前，必须完成以下前置检查，确保修改基于完整现状认知。

**前置检查清单**：

1. **DB 状态检查**：查询 `channel_configs` 表中目标通道的 `enabled`、`options` 字段，确认持久化凭据是否存在
2. **日志状态检查**：读取 `logs/debug_err.txt` 中目标通道最近 50 条日志，确认当前运行时状态（连接/鉴权/重连/报错）
3. **环境变量检查**：确认 `process.env` 中对应通道的凭据变量是否设置
4. **凭据链路审查**：追踪从 DB → `ChannelSecretStore.get()` → `plugin.lifecycle.connect(credentials)` 的完整凭据流，确认每个环节的数据形态
5. **启动流程审查**：确认 `main.ts` 启动时序中 `initPersistence()` → `setupChannelsFromConfig()` → `lazyConnectChannels()` 各环节是否正确

**禁止**：
- 未完成前置检查直接修改通道代码
- 仅凭静态代码分析做出修改决策，不验证 DB/日志/环境状态
- 一次修改后不验证就进入下一个修改

**AI 检查要点**：
- 搜索 PR/commit 中涉及 `channels/` 的修改 → 检查是否有对应的 DB/日志/环境状态记录
- 通道修改的 PR 必须有对应测试用例（单元测试或集成测试）

### R03-006 [MUST] 通道代码修改后验证

所有通道代码修改后，必须验证以下内容：

1. **编译验证**：`bun run tsc --noEmit` 通过
2. **凭据完整性验证**：确认 DB 中持久化的凭据不会被修改覆盖或意外清空
3. **启动流程验证**：确认修改不影响 `main.ts` → `setupChannelsFromConfig()` → `lazyConnectChannels()` 的启动时序
4. **重连循环验证**：确认重连逻辑不会陷入无限循环，不会因网关 API 限流而永久失败
5. **回归验证**：确认修改不破坏其他通道的启动和连接流程

### R03-007 [MUST] 通道文件拆分规范

超过 500 行的通道实现文件必须拆分。拆分方案须遵循以下原则：

1. **按职责拆分**：将连接管理（WebSocket/Token）、消息处理、重连逻辑、工具调用拆分为独立文件
2. **子目录结构**：`channels/{platform}/` 下按职责建子目录或文件
3. **保留公共入口**：主文件作为公共 API 入口，通过 `export * from './submodule'` 重新导出
4. **不改变接口**：拆分前后，`onConnect()`、`onDisconnect()`、`createInboundAdapter()` 等生命周期方法签名不变

**当前违规通道文件**（需拆分）：
- `channels/qq/QQChannel.ts`（1705 行）
- `channels/wechat/WechatChannel.ts`（待确认行数）

**AI 检查要点**：
- 扫描 `channels/*/` 下文件行数 → 超过 500 行的标记为待拆分

---

## R04 文件组织（MUST）

### R04-001 [MUST] 文件行数限制

单个文件不应超过 2000 行（默认值）。超过时应拆分为子目录下的多个文件。超过限制且未在例外表中登记的，CI 阻断合入。

**限制可调**：默认上限 2000 行（2026-10-05 由 1000 上调），可用环境变量 `ARCH_MAX_LINES` 覆盖（如大型基础设施文件无需改代码即可放宽）。超限文件可通过 `layer-exceptions.json` 的 `fileSizeExceptions` / `bulkExceptions(R04-001)` 登记豁免。

### R04-002 [SHOULD] 单类原则

一个文件只导出一个主要类或一组紧密相关的类型。

### R04-003 [SHOULD] 禁止巨型单体

禁止将多个独立子系统合并在一个文件中。当前违规文件：
- `core/extensibility/index.ts`（1494 行，含 PluginLoader + ModuleManager + ConfigManager + EventBus）
- `core/DIContainer.ts`（含 DIContainer + ModuleRegistry 等多个类）
- `acp/server.ts`（服务端 + 客户端 + 网关混合）
- `channels/qq/QQChannel.ts`（1705 行，含 WebSocket 连接、Token 管理、重连逻辑、消息分发、工具调用）

---

## R05 模块导入规范（SHOULD）

### R05-005 [SHOULD] 禁止不必要的 Barrel 文件

Barrel 文件（仅做 re-export 的 `index.ts`）不利于 tree-shaking，且引入循环依赖风险。

**判定标准**：文件只包含 `export ... from ...` 和 `export * from ...` 语句（允许注释和空行），无其他有效代码。

**允许（模块公共 API 边界）**：
- 各模块根目录下或子模块入口的 `index.ts`，作为模块的公共 API 面
- 示例：`src/state/index.ts`、`src/tools/TaskTool/index.ts`、`src/commands/backup/index.ts`

**禁止**：在非模块边界位置新增 barrel 文件

### R05-011 [SHOULD] Message 模型引用规范

所有模块应引用 `session/types/message.ts` 的 `Message` 接口，禁止自行定义同名的 `Message` 类型。

**允许**：
- `Message*` 命名的子类型（如 `AIMessage`、`WhatsAppMessage`、`UnifiedMessage`）—— 属域级私有类型，不产生命名冲突
- 局部/私有 `Message` 接口（如 UI 组件 Props、工具调用消息）—— 已列入已知例外

**当前违规（需后续代码改造）**：
- `core/types.ts` — core 层自定 Message 接口（R02-001 明确禁止）
- `types/index.ts` — 遗留类型 barrel 自定 Message
- `types/message.ts` — 遗留类型定义自定 Message

### R05-012 [SHOULD] Config/Env 门禁 — 禁止直接访问 process.env

所有环境变量访问应通过 `ConfigManager` 统一管理，禁止直接使用 `process.env.X`。

**允许**（边界场景，已列入已知例外）：
- 入口点文件（`main.ts`、`pyapp.ts`）—— 启动阶段 ConfigManager 未就绪，需自举（2026-10-02 D-229：原列的 `cli.tsx` 经取证为**死代码**，已删除）
- CLI 命令（`login`、`logout`）—— 认证令牌写入/env 查询
- 系统上下文读取（`context/context.ts`）—— 非配置变量（SHELL、USER 等）
- OpenTelemetry 配置（`instrumentation.ts`）—— 标准 OTEL env 变量约定
- 特性开关 Feature Flag（`AppCore.ts`、`ExtensibilityService.ts`）
- 测试文件（`__tests__`、`.test.ts`）—— 集成测试需直接注入 API key
- **`LIRI_*` 前缀**（前缀级白名单）与单点 `PDCA_RUN_MAX_TOKENS` —— **core 层专属理由**：core **不得** import `ConfigManager`（分层约束 R00-001），而 `configManager.env()` 的实现本身就是 `process.env[name] ?? defaultValue`（`config/ConfigManager.ts:1420`）⇒ core 侧读取该命名空间**无合法替代路径**；且 `LIRI_*` 是项目**自有** env 命名空间（`project_rules` §1.4）。**仅放行该前缀 + 该单点，不放宽到任意前缀/变量**。（2026-09-30，台账 D-71；实现见 `scripts/lint-architecture.ts` 的 `whitelistPrefixes`）

---

## R06 文件收敛与模块治理（AR/GR 合并）

> 来源：`dev_docs/20260809/架构暴胀分析与收敛规范.md` AR01-AR06 / GR01-GR07
> 生效日期：2026-08-09
> 检查覆盖：P1 阶段（lint-architecture.ts 扩展 6 项检查），当前部分规则无自动检查

### R06-001 [MUST] Handler 注册模式（AR02）

HTTP Handler 必须通过注册机制挂载到路由，禁止在路由表中硬编码 if/else 分支。

```typescript
// ❌ 禁止：路由表中硬编码
if (url === '/v1/sessions') { await handleListSessions(req, res); }

// ✅ 正确：Handler 自行注册
class SessionHandlers implements HttpHandler {
  readonly routes = [
    { method: 'GET', path: '/v1/sessions', handler: 'list' },
    { method: 'POST', path: '/v1/sessions', handler: 'create' },
  ];
}
```

**R06-001-1 [MUST] 禁止 `this['handleXxx']` 字符串索引调用**

字符串索引调用失去类型安全，且 IDE 无法追踪引用。

### R06-002 [MUST] 安全规则策略化（AR03）

每个安全检测规则独立为一个策略类，通过责任链或策略模式组合。禁止所有检测方法塞入单一类。

### R06-003 [MUST] API 子域拆分（AR04）

API 文件按业务子域拆分，每个文件一个子域。禁止按技术层堆积所有 API 到一个文件。

### R06-004 [MUST] 路由注册收敛（AR05）

路由注册统一入口，禁止分散在多处。收敛后：`http/Router.ts` 做路由注册框架，`http/handlers/` 下各领域 Handler 模块独立注册。

### R06-005 [MUST] 文件命名规范（GR02）

| 文件用途 | 命名格式 | 示例 |
|---------|---------|------|
| 主类/服务 | PascalCase | `ChatManager.ts`、`SessionService.ts` |
| 类型定义 | 按领域命名 | `types.ts`、`session.ts` |
| 工具函数 | camelCase | `formatTime.ts`、`hashUtils.ts` |
| 测试文件 | `*.test.ts` | `ChatManager.test.ts` |
| Barrel 入口 | `index.ts` | 仅模块边界使用 |

**禁止的命名**：`utils.ts` 作为通用垃圾桶、`helpers.ts`/`common.ts`/`misc.ts`/`other.ts` 等无意义命名。

### R06-006 [MUST] 文件职责单一（GR03）

**R06-006-1 [MUST] 一个文件只导出一个主要类/服务**

禁止多个不相关的类/服务在同一文件中。

**R06-006-2 [MUST] 禁止薄转发方法（僵尸方法）**

方法体仅一行 `return xxx()` 且无额外逻辑的，标记为可删除。禁止新增此类方法。检测：`lint:arch:zombie`（P1 实现）。

### R06-007 [MUST] 模块目录结构规范（GR04）

**标准模块目录结构**：

```
src/<module>/
├── index.ts              # 模块公共 API 出口
├── types.ts              # 模块类型定义
├── <ModuleName>.ts       # 主类/主服务
├── services/             # 子服务（每个 < 500 行）
├── utils/                # 模块内部工具函数（不对外导出）
├── __tests__/            # 测试文件
└── README.md             # 模块职责说明（可选）
```

**禁止**：`utils/` 作为顶层目录、`types/` 碎片化、`helpers/` 与 `utils/` 并存、空目录。

### R06-008 [MUST] 分层架构（GR07）

> **唯一事实源**：`scripts/modules-to-layers.json`（`layerOrder` / `allowedDependencies` / `modules`）。
> 门禁实现：`scripts/lint-architecture.ts` —— **R00-001**（静态跨层：违规/豁免）；**R00-003**（动态/延迟跨层：`import('…')` 与 `require('…')`，**仅上报**，2026-10-04 D-190② 追加 `require` 可见化）。
> ⚠️ 本节于 **2026-10-01 按事实源重写**：此前为「表示层/业务层/核心层/工具层」**4 层旧模型**，与事实源**多处冲突**（旧表把 `chat`/`tools` 当"业务层"、把 `utils`/`types` 并列为"工具层"、且**完全没有 `entry`/`ui`/`service` 三层**）。

**层序（6 层，自高到低）**：`entry > ui > app > service > infra > core`

| 层 | 典型模块（**示例**；完整映射以事实源为准） | 允许依赖 |
|---|---|---|
| `entry` | `entrypoints` · `bootstrap` · `main.ts` · `pyapp.ts` · `healthcheck.ts` · `monitor.ts` · `index.ts` | 全部层 |
| `ui` | `ui` · `components` · `ink` · `cli` · `vim` · `keybindings` | ui · app · service · infra · core |
| `app` | `chat` · `ai` · `tools` · `agent` · `commands` · `skills` · `plugins` · `context` · `query` · `compaction` · `tasks` · `modules` · `hooks` … | app · service · infra · core |
| `service` | `session` · `channels` · `infrastructure` · `runtime` · `bridge` · `mcp` · `services` · `voice` · `remote` · `streaming` | service · infra · core |
| `infra` | `utils` · `config` · `error` · `monitoring` · `memory` · `state` · `security` · `permission` · `cache` · `media` · `i18n` · `system` … | infra · core |
| `core` | `core` · `types` · `acp` | 仅 `core` |

**判据**：任一层**只允许**依赖「**自身 ＋ 更低层**」；指向**更高层**即为**倒挂**（R00-001，命中例外清单者豁免）。

**禁止方向（按现行层序重述）**：`core → 任何更高层`（含 `core → modules`(app) · `core → utils`(infra)）· `infra → service/app/ui/entry` · `service → app/ui/entry` · `app → ui/entry` · `ui → entry`。
⚠️ **易错点**：`utils` 属 **infra**、`types` 属 **core** ⇒ **`utils → core`（即 `infra → core`）是允许方向**（旧文曾误列为"禁止反向依赖"）。

**两项已生效的口径修正（2026-10-01）**：
1. **`import type` / `export type` 不计** R00-001（与同仓 eslint 规则 `module-registry/no-direct-module-import` 的 type-only 豁免**同口径**）；另以 `type-only 跨层引用 N 处（仅上报）` 保持可见。
2. **测试文件**（`__tests__` / `.test.ts` / `.spec.ts`）在 R00-001 / R00-003 / R03-002 **统一排除**（常量 `TEST_FILE_EXCLUSIONS`）。

### R06-009 [SHOULD] 碎片归集（AR06）

**R06-009-1 [SHOULD] 单文件行数下限 100 行**（不含类型定义、barrel 文件、测试文件）

| 文件类型 | 下限 | 说明 |
|---------|:---:|------|
| 业务逻辑文件 | 100 行 | 低于此阈值考虑合并到相关文件 |
| Service 文件 | 80 行 | 低于此阈值考虑合并到领域 service |
| 工具定义文件 | 100 行 | schemas/prompt 合并到主文件 |

**R06-009-2 [SHOULD] 同构模式文件必须聚合**

当多个文件具有完全相同结构、仅参数不同时，使用数据驱动方式替代文件复制。

### R06-010 [SHOULD] 模块公共 API 规范（GR05）

- 模块只通过 `index.ts` 暴露公共 API，禁止外部直接引用模块内部文件
- Barrel 文件仅用于模块边界，其他位置禁止

### R06-011 [SHOULD] 模块依赖规则（GR06）

- 禁止循环依赖
- **依赖方向**以 `scripts/modules-to-layers.json#allowedDependencies` 为**唯一事实源**：任一层只允许依赖「自身 ＋ 更低层」，层序 `entry > ui > app > service > infra > core`（层表与禁止方向详见 **R06-008**）
- 常见具体约束（**示例**，非穷举；完整判据以事实源为准）：`core` 仅依赖 `core` ⇒ `core/` 不依赖 `modules/`(app) 或 `utils/`(infra)；`infra`（含 `utils/`）**允许**依赖 `core`（含 `types/`）；`app`（含 `modules/` · `chat/` · `tools/`）允许依赖 `service` · `infra` · `core`
- ⚠️ 本节 2026-10-01 按事实源订正：此前写「依赖方向：`modules/` → `core/` → `utils/`」与「`utils/` 不依赖 `core/`」——**方向与层归属均与现行模型相反**（现行 `utils`=infra 在 core **之上**，`modules`=app 在 infra **之上**）

---

## R08 后台任务可观测性（MUST）

> 来源：`dev_docs/20260810/会话断网无法自动恢复排查报告.md` §九（P1/P2/P3 反模式归纳）
> 生效日期：2026-08-10
> 检查覆盖：`lint-architecture.ts` R08-001 / R08-002（warning 级引导检查）

### R08-001 [MUST] 跨重启状态必须持久化

有状态的后台模块（进度/计数/里程碑）必须落盘 `~/.pyapp/data/`，禁止纯内存变量跨重启承载状态。

**禁止**：
- 模块级/类级计数器（`let xxxCount = 0` + `++`/`+=` 递增）在进程重启后仍需保留，但无任何落盘
- 用内存数组/Map 记录"执行日志"，重启即清空（如 Dream 日志、Buddy 成长计数——已按此规则修复）

**正确做法**（参考已落地的实现）：
- `buddy/growthPersistence.ts`：`loadGrowthState()` / `saveGrowthState()` 落盘 JSON
- `buddy/dreamLogStore.ts`：追加式 JSONL 日志

**AI 检查要点**：
- 搜索后台模块中 `let \w+ = 0` + 递增模式 → 若跨重启需要保留，必须持久化
- 搜索内存日志数组（`private logs: Xxx[]` + `.push()`）→ 若需查询历史，必须落盘

### R08-002 [MUST] 后台任务必须记录 4 类事件

每个后台任务必须记录 `start` / `skip(带原因)` / `fail(带错误)` / `complete(带结果)` 四类事件，skip 与 fail 至少 warn 级。

**禁止**：
- 后台任务循环（`setInterval`）回调体内无任何日志
- 跳过/失败仅 info 级或完全静默——用户无法判断"为什么没执行"（如 Dream 跳过已升级 warn + reason 字段）

**AI 检查要点**：
- 搜索 `setInterval` 回调体 → 必须包含至少一处 `logger.*` 调用
- 搜索后台任务跳过分支 → 必须记录 skip 原因（如 `logger.warn(..., { reason })`）

### R08-003 [SHOULD] 后台任务必须接入运行状况面板

新增后台任务时，必须在 `GET /v1/background/status` 聚合结果中可见（参考 `buddy-handlers.ts` 的 `handleGetBackgroundStatus`），并可在前端 `/background-status` 面板查看。

---

## R09 统一状态机（MUST）

> 背景：有状态域存在大量手写布尔/字符串状态（如 DreamEngine `this.cycle.isRunning`），无法统一观测。已落地统一引擎 `state/engine/StateMachine` + 注册中心 `StateMachineRegistry`。详见 dev_docs/20260810 排查报告 §十。

### R09-001 [MUST] 有状态域必须使用状态机引擎

新增有状态模块（连接/任务/后台进程）必须基于 `state/engine/StateMachine` 建模，禁止手写布尔标志/字符串状态判断（配合 CS02）。存量手写状态按域迁移（已完成：AppStateMachine 接线 + BackgroundTask 域；Task/Connection 域待专项）。

### R09-002 [MUST] 状态机必须注册到 StateMachineRegistry

禁止游离状态机实例。注册后经 `GET /v1/state/all` 可见。

### R09-003 [MUST] 状态转移必须记录统一日志

转移日志必须带 contextId/from/to/reason；关键状态（ERROR/PAUSED/FAILED 等，由 `criticalStates` 配置）转移至少 warn 级（引擎已内置日志分级 + `onTransition` 发布钩子）。

### R09-004 [SHOULD] 关键状态机快照必须持久化

`snapshot()` 落盘 `~/.pyapp/data/state/`，重启后 `fromSnapshot()` 恢复（AppStateMachine 已实现；后台任务状态暂以 R08 事件 JSONL 持久化）。

### R09-005 [SHOULD] 状态机必须在前端可见

新增状态机必须在 `GET /v1/state/all` 聚合结果中暴露（后端已提供 `/v1/state/all` + 前端运行状况面板"应用状态"区）。

---

## R10 模块统一管理（MUST）

> 背景：4 套模块体系并存（ModuleDependencyManager / EnhancedModuleDependencyManager / ModuleRegistry / DIContainer），deprecated 链循环且从未删除。收敛目标：`DIContainer.bootstrap()` 唯一入口，ModuleRegistry 降为内部实现。详见 dev_docs/20260810 排查报告 §12。

### R10-001 [MUST] 模块注册与启动唯一入口

模块必须注册到 ModuleDefinitions，且只能经 `DIContainer.bootstrap()` 启动。禁止绕过 DI 容器直接实例化/注册模块。

### R10-002 [MUST] 禁止使用遗留模块系统

禁止 import `ModuleDependencyManager` / `EnhancedModuleDependencyManager` / `--use-legacy-module-system` 回退路径。

### R10-003 [MUST] 模块必须实现完整生命周期契约

实现任一生命周期钩子（`onLoad` / `onReady` / `onDestroy`）的模块必须实现**完整三件套**（ModuleBootstrapper 四阶段：REGISTER → LOAD → READY → DESTROY），禁止"部分契约"（如只有 `onLoad` 没有 `onDestroy`）。配套 lint：`bun run lint:arch` → R10-003。

### R10-004 [MUST] 模块定义与加载策略必须数据对齐

`ModuleDefinitions.ts` 的 `MODULE_INITIALIZATION_ORDER`（Phase 1-4 CRITICAL 段 / Phase 5-8 DEFERRED 段）与 `LazyModuleStrategy.ts` 的 `LAZY_MODULE_STRATEGY` 优先级必须对齐：
- CRITICAL 模块必须位于 DEFERRED 标记之前（Phase 1-4）
- DEFERRED 模块必须位于 DEFERRED 标记之后（Phase 5-8）
- 新增/提升模块时同步更新两处（注释约定 → lint 校验：`bun run lint:arch` → R10-004，缺失声明/段位错配均报违规）

---

## R11 可观测性零样板接入（MUST）

> 背景：Logger / handleError / OTel / TokenTrace 均有唯一入口，但新模块手动接线 4 件套（样板重复、易遗漏）。门面 `createModule()` 一行声明即获得全套能力。详见 dev_docs/20260810 排查报告 §11。

### R11-001 [MUST] 禁止直接构造 Logger 实例

新增/修改代码不得写 `new Logger({ ... })`，必须使用：

```typescript
import { getLogger, createModule } from '@modules/monitoring';
const logger = getLogger('module:sub');   // 默认 INFO/json，按模块名缓存
const m = createModule('module:sub');     // 一行获得 logger + error(action) + trace(op, fn)
```

- 默认配置形态 `new Logger({ module: 'x' })`（或 + `level: LogLevel.INFO` / `format: 'json'`）语义等价于 `getLogger('x')`，直接替换
- 自定义配置形态（自定义 `level` / `redact` / `source` 等）属存量回退清单，由 lint:arch R11-001 warning 追踪，需人工确认后迁移
- 唯一例外：`monitoring/logs/Logger.ts` 本身（getLogger/createLogger 实现）
- 配套 lint：`bun run lint:arch` → R11-001（每文件最多报 5 条 warning）

### R11-002 [MUST] 新模块可观测性接入必须走 createModule()

新模块（新文件/新服务类）的日志 + 错误 + 追踪接入必须经 `createModule(name)` 门面声明，禁止分别手动 import Logger/handleError/OTel 组合样板。

```typescript
const m = createModule('chat:lifecycle');
m.logger.info('...');               // Logger（模块缓存）
await m.error(e, 'send');          // handleError（自动填 module）
await m.trace('send', async () => { ... });  // OTel span（自动追踪）
```

---

## R12 Agent 能力回归门禁（MUST）

> 背景：20+ 项架构 lint 只保证**结构不腐化**，无法保证**能力不回退**。2026-09-12 引入评测体系（`app/src/evals/`，入口 `bun run eval --model=<模型名>`），以 `pass^k`（k 次全通过）作为可用性门槛。**首次运行即抓出两个真实缺陷**（台账 O32：多级写入被误拦 + 伪成功；O35：危险文件 DENY 运行时不可达）—— 说明该门禁不可省。

### R12-001 [MUST] 能力相关改动必须过 `pass^k` 门禁

影响 Agent 行为的改动（工具实现 / 权限策略 / 上下文压缩 / 模型路由 / 提示词装配）合并前必须跑：

```bash
cd app
bun run eval --model=<模型名> --gate            # 与 app/src/evals/baseline.json 比对；有回归则 exit 1
bun run eval --model=<模型名> --k=4 --gate      # 关键任务建议 k≥4（采集 pass^k，区分"从未做对"与"不稳定"）
```

- **判分分层**：L1 环境终态（首选，确定性）> L2 工具调用序列（L1 覆盖不到的过程约束）> L3 LLM-judge（**仅**开放式文本，且需先用 L1 样本校准）
- **不得静默放宽门禁**：降低 `baseline.json` 的 `requirePassK` / `minPass1`、或删除任务，须在评审中说明理由
- **新增任务必须登记基线**，否则 `--gate` 报"未登记"并失败（防止"新任务自动豁免"）
- **判分器必须可被证伪**：控制任务（`expect: 'fail'`）必须存在且被判为失败；其自身回归用例见 `app/tests/evals/judging.test.ts`（含"放水能被捕获"用例）
- **模型名不得硬编码**：基线文件刻意**不含**模型名，按模型分档时用 `--baseline=<path>` 指定另一份

### R12-002 [SHOULD] 工具返回值按不可信数据处理（**规划中**，随 D9 落地）

工具返回内容不得直连指令通道（防提示注入）；安全鲁棒性评测须**同时**报告 ASR 与正常任务成功率（AgentDojo 口径：只报 ASR 会掩盖误伤）。

### R12-003 [SHOULD] 检索/图扩展路径禁止静默降级（**规划中**，随 D1 收敛）

禁止 `catch {}` 吞异常；**"零结果"也必须上报计数**（候选 / 命中 / 扩展），不能只报异常。

---

## R13 定时器生命周期（MUST）

> 背景（2026-09-25，台账·附带发现 7）：实测 `app/scripts/bench-memory-dedup.ts` 三次运行**都打印了 `[done]` 却不退出**（各 ~270MB WS，数分钟直至被手工 `Stop-Process`）。用打桩探针（`app/scripts/probe-memory-handles.ts`）定位：`MemoryManagerImpl` 的**导入链**间接拉起两个单例，其**周期性定时器未 `unref()`** ⇒ 任何以 import 触碰该链的 CLI/脚本进程被**永久撑住**。仓内**已有正确惯例**（`TurnLivenessWatchdog` / `ChannelSessionManager` / `rateLimiter` / `messageRouter` / `InboxManager` / `LongRunningTaskOrchestrator` 均显式 unref），本次两处属**漏网**。
>
> **与 `lint:exit` 的分工（互补，不重复）**：`lint:exit` 要求 `package.json#scripts` 引用的**入口脚本**显式 `process.exit`（台账 N-16 / N-49，"同一类缺陷已复发两次"，**治标**）；本规则**治本** —— **库/服务侧不得用"可放弃的周期性定时器"撑住进程**（入口显式退出**挡不住**被 import 的模块在导入时就注册未 unref 的定时器）。

### R13-001 [MUST] 模块顶层 `setInterval` 必须 `unref()`

模块顶层（行首无缩进 ⇒ **import 时即执行**）的 `setInterval(...)` 必须 `unref()`：链式 `setInterval(...).unref()`，或紧随其后的 `t.unref?.()`。

- 判定命令：`bun run lint:unref`（已进 `ci` 链，**阻断级**）。
- 修法：`const t = setInterval(...); t.unref?.();` —— 保留定时器行为，但**不让它撑住进程**。

### R13-002 [SHOULD] 可放弃的周期性维护/观测定时器应 `unref()`

非顶层的 `setInterval` **逐处判定**（不做"一律 unref"的一刀切）：若该定时器属**可放弃的周期性观测/维护**（刷缓冲、清理过期缓存、发清理事件等），且其**宿主可能被 CLI/脚本 import** ⇒ 补 `unref()`；若仅由服务实例独占（守护进程由 HTTP server 保活）⇒ **无需**处理。

- **不 unref 的合法场景**：该定时器**本身就是进程保活来源**（纯调度型入口，无 server / 无其他 handle）⇒ 不得 unref，并应在代码注释中写明理由。
- **权威判定工具**：`bun app/scripts/probe-memory-handles.ts <模块路径>` —— 实测"导入该模块时**哪些未 unref 定时器被真实拉起**"。（⚠️ import 可达性**静态无法判定**；且 `process.getActiveResourcesInfo()` / `_getActiveHandles()` 在本仓运行时的 Bun 下返回**空**，**不可信** —— 必须用打桩探针。）
- **存量清单**：`bun run lint:unref:list`。
- **现状基线（2026-09-25 实测）**：`setInterval` 共 **182** 处（已 unref **33** / **顶层未 unref 0** / 其余未 unref **149**）。顶层已全部收敛；149 处为**存量收敛清单**（按目录：monitoring 11、services 10、core 9、channels 8、memory 8、performance 7、chronos 7…），逐处按上文判据收敛，**不设强制期限**。

### R14 [MUST] 错误级别的"声明"与"落盘级别"必须一致（单一映射）

`ErrorCodes[k].level`（`CRITICAL/ERROR/WARN`）是**声明**；它经 `AppError.fromCode → levelToSeverity` 折叠为 `severity` 后**不落实例**。落盘级别只能由 [`error/handleError.ts#resolveErrorLogLevel`](file:///e:/PY/Documents/CODES/PY_APP/app/src/error/handleError.ts)（**单一事实源**）从 `severity`（＋ `UNHANDLED_ERROR` 例外）反推。**禁止在任何调用点内联该映射或硬编码错误日志级别。**

- 判定：`bun test tests/error/errorLogLevel.test.ts`（含于 `bun test` / `ci` 链，**阻断级**）——核心是**全表穷尽往返**：对 `ErrorCodes` **每一个**码断言 `def.level → severity → 日志级别` 与声明一致。
- **为什么是测试而非独立 lint 脚本（如实）**：该不变量需要**真实 import** `ErrorCodes`、`AppError.fromCode`、`resolveErrorLogLevel`；而仓库根的 `scripts/*.ts` 无法解析 app 的 `@modules/*` 别名（根脚本历来只做纯文本扫描）。放在 `app/tests/**` 可正常解析，且 `bun test` 本就在 `ci` 链内 ⇒ 门禁效力等价。
- **存量口径（2026-09-25）**：修复见台账**附带发现 12**（`handleError` 原硬编码 `LogLevel.ERROR`）；原用例只**手工抽样 8 个码**，现已改为全表穷尽（新增码/改错 level 会被立刻发现）。
- ~~**已知未表达档**：`ErrorCodeDef.level` 联合类型含 `INFO`……根因方案（二选一，**未做**）：① 从联合类型删除 `INFO`；② 给 `ErrorSeverity` 增档并扩展映射。~~ ✅ **已处置（2026-10-05，P2-13；采纳方案 ①）**：`ErrorCodeDef.level` **已删去 `INFO`**（`core/errorCodes.ts`，仅留 `CRITICAL/ERROR/WARN`）⇒ "类型可声明" ⇔ "链路可表达"一致。**同时**：`tests/error/errorLogLevel.test.ts` 的 `expectedByDeclared` 由含 `INFO: null` 改为**三档** —— 今后若有人再往联合里加**不可表达的档**，该 `Record<ErrorCodeDef['level'], …>` 会**编译期报缺键**（把 R14 的守卫从"运行期判红"提前到**编译期**）。
- **守卫限度（如实）**：另含 1 条**文本级**断言，仅证明 `handleError` 仍调用 `resolveErrorLogLevel`（防"映射被内联回写、单一事实源沦为死代码"）；它**不能**证明仓内不存在第二份内联映射。

---

## R15 工具出参契约（SHOULD）

> 背景（2026-09-29，T6 核查）：`app/src/tools/<各工具>/schemas.ts` 曾定义 **45 个** `*OutputSchema`，其中 **44 个零消费者** —— 既未接线到 `Tool.outputSchema`，也**全仓无任何 import**。它们是"看着像出口契约、实则无人消费"的**死代码**，且正是"错层误接"的来源：把描述**内层函数**（如 `globAsync()`）的 schema 接到工具出口上 ⇒ **每次调用都误报**。同批处置：**21 接线 / 23 删除 / 1 转另案**（`TaskStopTool/` 孤儿模块），方法与逐项判定见 [`.trae/specs/tool-output-schema-layer-audit.md`](../specs/tool-output-schema-layer-audit.md)。

### R15-001 [SHOULD] 禁止"零消费者"的 `*OutputSchema` 定义

`export const <X>OutputSchema` 若**全仓出现次数 === 1**（只剩定义那一行）⇒ **要么接线、要么删除**，不得留在仓内当摆设。

- **判定命令**：`bun run lint:arch`（已进既有架构 lint 链）→ 观察输出行 `[出参 schema 消费者检查 R15-001] 定义 N 个，零消费者 M 个`。等级 **warning（不阻断提交）**；**2026-09-29 起"零豁免上线"**（存量已清空，当时实测 `定义 22 个，零消费者 0 个`）。
- **接线前必须实测**：schema 字段必须与工具**出口载荷**（`data`，缺省回退 `result`）**逐字段相符**；**不得**按"名字像"就接。判据与"四族出口构造法"见上述 spec 的「T6 收口结论」。
- **三种常见错法**（本门禁会逼出结论）：① 描述**内层函数**的返回；② 描述 **`ToolResult` 本体**（`{success, output, error}`）而非载荷；③ 描述**出口并不存在的形态**（出口已把对象 `JSON.stringify` 成字符串，或工具定义在 `ToolFactory` 的内联对象里、只返回 `{success, output}`）。
- **已知局限（如实）**：① **同名重复定义会互相掩盖** —— 判据按"全仓总出现次数"计、**不做符号解析**。**真实案例**：`TaskStopOutputSchema` 曾同时定义在 `TaskTool/` 与 `TaskStopTool/`，后者即便孤立也抓不到（该孤儿侧已于 2026-09-29 按台账 **D-9** 删除 ⇒ **案例消失，同类风险仍在**）；② 注释/文档字符串中的同名言及、③ `import` 而未被使用，都会被计为引用 ⇒ **只会漏报，不会误报**（③ 另由 eslint/tsc 兜住）。同名类型冲突本身属 **R02-002** 范畴。

### R15-002 [SHOULD] 禁止"零 importer"的工具 `schemas.ts` 模块

`app/src/tools/<X>/schemas.ts` 若**无任何静态 import/require 指向它**（说明符经真实解析后无一命中）⇒ **整文件死亡**，默认应删除。

- **判定命令**：`bun run lint:arch` → 输出行 `[工具 schemas 模块引用检查 R15-002] 候选 N 个，零 importer M 个`。等级 **warning（不阻断提交）**；**2026-09-29 起"零豁免上线"**（当时实测 `候选 21 个，零 importer 0 个`）。
- **背景（2026-09-29 D-7 核查）**：该类文件曾达 **20/41**，其 `*InputSchema` / `validateXxxInput` / `logger` **全无人消费**，且**已实测与实现漂移**（`sleep` 写 `milliseconds` 而工具读 `durationMs`、`cron_create` 写 `cron` 而实读 `expression`、`push_notification` 写 `{title,body,url}` 而实参是 `action`）⇒ **"反向归一（让工具 import）"会把过期契约灌进活代码** ⇒ 已全部**删除**。
- **A 档验证**：临时重建 `tools/MonitorTool/schemas.ts` ⇒ 报 `候选 22 个，零 importer 1 个：tools/MonitorTool/schemas.ts` + 1 条 R15-002 违规 ⇒ **门禁确实会红**；已还原、复用 R15-001 的还原惯例核验残留。
- **局限（如实）**：仅解析**静态**说明符（`./schemas`、`./schemas.js`、`../<X>/schemas`、`@modules/tools/<X>/schemas`）；动态拼路径无法识别 ⇒ **只漏报、不误报**。

---

## 例外处理流程

1. 如必须违反某个 MUST 规则，须在 PR 描述中说明理由
2. 理由须经过架构 review 确认
3. 例外统一记录在本文末"已知例外"表中，注明有效期

### 已知例外

| 规则 ID | 文件 | 理由 | 有效期 |
|---------|------|------|--------|
| R01-001 | `core/gateway/events/GatewayEventBus.ts` | 历史遗留，已列入 P2 改造计划 | 2026-Q2 |
| R01-001 | `channels/events/ChannelEventBus.ts` | 独立 EventBusImpl 实例，通过桥接层与 globalEventBus 通信，满足 R01-007 分层要求 | 永久 |
| R01-001 | `session/events/SessionLifecycleEventBus.ts` | 通配符 `'*'` 支持，待统一后移除 | 2026-Q2 |
| R01-001 | `voice/VoiceEventBus.ts` | 双工状态管理，待委托到 EventBusImpl | 2026-Q2 |
| R01-001 | `agent/events/index.ts` | InternalEventBus（@deprecated），自建 Map 分发，待移除 | 2026-Q3 |
| R01-001 | `core/auto-reply/dispatch.ts` | ReplyDispatcher，Handler 注册表 + dispatch 模式 | 2026-Q3 |
| R01-001 | `core/extensibility/EventBus.ts` | 自建 EventBus 包装器 | 2026-Q3 |
| R01-001 | `core/node-host/NodeInvoke.ts` | NodeInvoke + EventEmitter + Handler 注册表 | 2026-Q3 |
| R01-001 | `plugins/core/PluginEventSystem.ts` | 插件事件系统，extends EventEmitter + Map 分发 | 2026-Q3 |
| R01-002 | `services/api/errors.ts` | 面向外部 API，与内部错误体系不同 | 待评估 |
| R01-004 | `context/ContextCacheService.ts` | 已修复，改用 TTLCache | ✅ |
| R01-004 | `permission/cache/PermissionCache.ts` | 已修复，改用 TTLCache | ✅ |
| R01-004 | ~~`subagent/communication/PermissionSync.ts`~~ | 已修复（改用 TTLCache）；**2026-10-06 该文件已删除**（N-78：整套 `subagent/communication/` 家族 0 消费者、被 `TeammateManager` 取代）⇒ 本行转为历史记录 | ~~✅~~ **已删除** |
| R01-004 | `cost/CostCache.ts` | 已使用 CacheService（非自建 Map），不违反 R01-004 | ✅ |
| R01-004 | `tools/cache/ToolCacheManager.ts` | 自建持久缓存 + ICache 实现，待委托到标准实现 | 2026-Q3 |
| R01-004 | `chat/services/PerformanceOptimizationService.ts` | 缓存+批处理+事件混合服务，需模块级重构 | 2026-Q3 |
| R01-004 | `core/utils/Performance.ts` | 自建 MemoryCache（大小驱动淘汰），待改用标准实现 | 2026-Q3 |
| R01-004 | `performance/CacheAndLazyLoading.ts` | 自建 CacheManager（大小+过期管理），需模块级重构 | 2026-Q3 |
| R01-004 | `acp/control-plane/runtime-cache.ts` | 已修复，改用 TTLCache | ✅ |
| R01-004 | `permission/classifiers/YoloClassifier.ts` | 已修复，改用 TTLCache | ✅ |
| R01-004 | `context/services/UserContextService.ts` | 已修复，改用 TTLCache + 消除 any | ✅ |
| R01-004 | `context/services/SystemContextService.ts` | 已修复，改用 TTLCache + 消除 any | ✅ |
| R01-004 | `oauth/services/OAuthDiscovery.ts` | 已修复，改用 TTLCache（MetadataCache 内建） | ✅ |
| R01-004 | `ai/localAgent/LocalAgentCache.ts` | 已修复，改用 TTLCache | ✅ |
| R01-004 | `memory/services/EmbeddingService.ts` | 已修复，改用 TTLCache（EmbeddingResult 缓存） | ✅ |
| R01-004 | `tools/utils/OptimizedToolManagerUtils.ts` | 已修复，改用 TTLCache（ToolExecutionCache） | ✅ |
| R01-004 | `ink/ink/screen.ts` | StylePool 内 4 个 memoization 缓存（transitionCache/inverseCache/currentMatchCache/selectionBgCache），属渲染引擎计算缓存，无 TTL 语义，在渲染热路径上 | 永久 |
| R01-004 | `services/mcp/MCPConnectionManager.ts` | clientCache（SDK 连接引用缓存）和 toolsCache（工具列表缓存），属连接状态追踪和查找表 | 永久 |
| R01-003 | `services/api/client.ts` | `ApiClient.request()` 内建 for 循环指数退避重试，含特定 API 错误分类处理；已设计 @deprecated 计划迁移到 utils/withRetry | 2026-Q3 |
| R01-003 | `bridge/api/BridgeApi.ts` | 内建 `withRetry()`（名称冲突）+ `backoffWait()` + `shouldRetry()` 指数退避重试，为 bridge 模块核心基础设施 | 2026-Q3 |
| R01-003 | `mcp/reconnect.ts` | `ReconnectManager.reconnect()` 内建 while 循环重试 + 工具漂移检测，领域逻辑复杂，不易用通用 withRetry 替代 | 2026-Q3 |
| R01-003 | `chat/tool/SmartToolIntegrator.ts` | 内建 for 循环重试，含工具执行上下文管理 | 2026-Q3 |
| R01-003 | `session/platform/WebhookPlatform.ts` | `flushPendingQueue()` 内建重试，含 Webhook 消息队列管理 | 2026-Q3 |
| R01-003 | `infrastructure/http/handlers/channel-handlers.ts` | **AC-1 治理例外（2026-08-21 复核登记，永久）**：`bindInboundHandler()` 内 `_pendingOutboundReplies (Map) + schedulePendingFlush (setInterval 15s)` = 跨 N 条独立 onOutbound 失败消息的**批处理延迟调度状态机**。不是 R01-003 禁止的"单请求线性重试"语义：① 每条消息的重试时间戳单独管理（`pending.lastAttemptAt + 10s`），② 定时器懒启动 + 空自动销毁，③ 同一 tick 可并发重试多条消息。硬套 `utils/withRetry` 需要为每条消息单独开 Promise+setTimeout+for 循环+共享队列 drain 通知，代码量翻倍、更难追踪和 cancel，违背简洁优先。**故永久登记为例外**（与 WebhookPlatform flushPending 同类）。见 [预存错误 AC-1](../../dev_docs/error_repairs/预存错误与待处理问题.md) | 永久 |
| R01-003 | `streaming/IncrementalRetry.ts` | 增量重试 + 断点续传，流式领域专用，已与 StreamingCircuitBreaker（utils/withRetry）共存 | 2026-Q3 |
| R01-003 | `core/utils/ErrorHandler.ts` | 内建 while 循环重试，含错误处理管道上下文管理 | 2026-Q3 |
| R01-003 | `core/StartupOptimizer.ts` | 内建 for 循环重试，启动优化器重试逻辑 | 2026-Q3 |
| R01-003 | `ai/providers/BaseAIProvider.ts` | 内建 for 循环重试，AI 提供者基础重试 | 2026-Q3 |
| R01-003 | `agent/cli-runner/index.ts` | 内建 for 循环重试，CLI runner 重试逻辑 | 2026-Q3 |
| R01-003 | `performance/CodeOptimizer.ts` | 自建 retry<T>() 函数，代码优化模块重试 | 2026-Q3 |
| R01-003 | `mcp/MCPCompatibilityTester.ts` | 内建 for 循环重试，MCP 兼容性测试重试 | 2026-Q3 |
| R01-003 | `agent/chains/AgentChain.ts` | 内建 while 循环重试，Agent 链执行重试 | 2026-Q3 |
| R01-003 | `core/node-host/ExecPolicy.ts` | 内建 for 循环重试，执行策略重试 | 2026-Q3 |
| R01-003 | `remote/RemoteTaskScheduler.ts` | 内建 while 循环重试，远程任务调度重试 | 2026-Q3 |
| R01-003 | `chronos/CronSubprocessExecutor.ts` | 内建 for 循环重试（`for (attempt=1; attempt<=config.maxRetries+1)`），子进程执行重试 | 2026-Q3 |
| R01-003 | `agent/remote/RemoteAgentProtocol.ts` | 内建 for 循环重试，远程代理协议重试 | 2026-Q3 |
| R01-003 | `bridge/utils/jwtUtils.ts` | `refreshToken()` 内建递归重试（`retryCount < maxRetries` + setTimeout），Token 刷新重试 | 2026-Q3 |
| R01-003 | `chronos/engine/ExecutionEngine.ts` | 内建重试计数检查（`task.retryCount < task.maxRetries`），Cron 执行引擎重试 | 2026-Q3 |
| R01-003 | `ai/router/SmartRouter.ts` | `executeWithRetry()` AI 路由执行重试 | 2026-Q3 |
| R01-003 | `oauth/services/TokenManager.ts` | `refreshTokenWithRetry()` OAuth Token 刷新重试 | 2026-Q3 |
| R01-003 | `chronos/EnhancedCronTask.ts` | 内建重试策略（`retryCount` + `maxRetries` + `canRetry()`），增强定时任务重试 | 2026-Q3 |
| R01-003 | `chronos/CronScheduler.ts` | `calculateNextRetryTime()` Cron 调度器重试时间计算 | 2026-Q3 |
| R01-003 | `error/context/QuerySource.ts` | `shouldRetryOnError()` 错误重试判定辅助函数，仅含类型字段 + 判定函数，无实际重试循环，误报 | 2026-Q3 |
| R01-003 | `main.ts` | `getOnboardRetryFlagPath()` + `retryCount` 引导重试标记，仅引导流程，无实际重试循环 | 2026-Q3 |
| R01-003 | `ai/router/RetryPolicy.ts` | 重试策略类型定义文件，仅含类型/接口声明，误报 | 2026-Q3 |
| R01-003 | `tasks/LongRunningTaskOrchestrator.ts` | 长任务编排器 `hasRetry` + `retryCount` 状态管理，领域内建重试 | 2026-Q3 |
| R01-005 | `core/flows/doctor-health.ts` | 已修复，registerHealthCheck 代理到 HealthChecker，导出 getHealthChecker() | ✅ |
| R01-006 | `config/ConfigManager.ts` | 已添加 `ConfigManager.env()` 统一入口方法 | ✅ |
| R01-006 | NODE_ENV（16 文件/24 处） | 已迁移：SystemContextService、DirectConnectManager、MemorySnapshotService、PerformanceConfig、envUtils、SlowOperationDetector、MonitoringService、DaemonDiagnostics、analytics/config、InstallationTypeDetector、reconciler、Performance、GitContextService、DiagnosticService、MemoryManager、ConfigManager | ✅ |
| R01-006 | 其余 ~262 处 process.env. 使用 | 分散在 ~65 文件中，含系统路径、telemetry 写操作等，计划分批迁移 | 2026-Q3 |
| R01-006 | Provider API Key（7 文件/24 处） | 已迁移：VertexAIProvider、OllamaProvider、AzureOpenAIProvider、BedrockProvider、GrokProvider、MoonshotProvider、BaseAIProvider | ✅ |
| R01-006 | REPL/CLI 入口层（4 文件/18 处） | 已迁移：repl.ts、main.ts、Chat.ts、aiService.ts | ✅ |
| R01-006 | 默认配置 + 同步桥接（2 文件/5 处） | 已迁移：config/types.ts、ProviderSyncService.ts | ✅ |
| R01-006 | 安全配置 + 企业认证（2 文件/24 处） | 已迁移：securityConfig.ts（23 处）、AuthChain.ts（1 处） | ✅ |
| R01-006 | OTEL 遥测层（2 文件/24 处） | 已迁移：instrumentation.ts（23 处）、OTelLogger.ts（1 处）；保留 telemetry 写操作（process.env.OTEL_* = ...） | ✅ |
| R01-006 | 系统路径/运行时常量区（3 文件/8 处） | 已迁移：GatewaySetup.ts（2 处）、LocalHTTPService.ts（3 处）、AppCore.ts（3 处） | ✅ |
| R01-006 | services/ 服务层（15 文件/40 处） | 已迁移：agentMemory.ts（4 处）、api/client.ts（3 处）、analytics/metadata.ts（1 处）、analytics/sink.ts（2 处）、voiceService.ts（1 处）、notifier.ts（1 处）、SessionRecorder.ts（1 处）、sessionMemoryCompact.ts（1 处）、timeBasedMCConfig.ts（1 处）、parseAgent.ts（1 处）、ContentReplacementStore.ts（2 处）、policyLimits/types.ts（5 处）、remoteManagedSettings/types.ts（5 处）、GrowthBookConfig.ts（5 处）、EnhancedMCPConfigManager.ts（1 处） | ✅ |
| R01-006 | commands/ 命令层（10 文件/~29 处） | 已迁移：provider.ts（8 处）、login/index.ts（3 处）、logout/index.ts（1 处）、login/login.ts（2 处）、logout/logout.ts（2 处）、CommandManager.ts（5 处）、Doctor.ts（7 处）、Onboard.ts（4 处）、Memory.ts（2 处）、Cron.ts（1 处） | ✅ |
| R01-006 | promptSuggestion/（5 文件/~25 处） | 已迁移：Analytics.ts（4 处）、PromptSuggestion.ts（3 处）、SuggestionFilter.ts（1 处）、Speculation.ts（10 处）、PromptSuggestionConfig.ts（7 处） | ✅ |
| R01-006 | system/auth/（4 文件/~24 处） | 已迁移：oauthConfig.ts（6 处）、AuthManager.ts（11 处）、CoreOAuthProvider.ts（6 处）、trusted-device.ts（1 处） | ✅ |
| R01-006 | analytics/（3 文件/~16 处） | 已迁移：AnalyticsPersistenceService.ts（2 处）、FirstPartyEventLogger.ts（3 处）、DatadogMetricsClient.ts（11 处） | ✅ |
| R01-006 | ai/（11 文件/~28 处） | 已迁移：LocalAgent.ts（3 处）、OpenAIProvider.ts（1 处）、GoogleProvider.ts（1 处）、DeepSeekProvider.ts（1 处）、AnthropicProvider.ts（1 处）、modelRouter.ts（6 处）、ModelManager.ts（5 处）、thinking.ts（4 处）、AIModelManager.ts（3 处）、EmbeddingManager.ts（1 处）、OpenAIEmbeddingProvider.ts（2 处）。保留写操作：ModelManager.ts 第 327 行 `process.env.Liri_MODEL = defaultModel`、第 337 行 `process.env.Liri_MODEL = resolved` | ✅ |
| R01-006 | cli/（4 文件/~11 处） | 已迁移：index.ts（1 处）、authHandler.ts（8 处）、print.ts（1 处）、utilHandler.ts（1 处）。保留写操作：utilHandler.ts 第 227 行 `process.env.Liri_DEBUG = 'true'`、第 230 行 `delete process.env.Liri_DEBUG` | ✅ |
| R01-006 | plugins/（4 文件/~7 处） | 已迁移：ProviderDiscovery.ts（3 处）、pluginDirectories.ts（2 处）、PluginDiscovery.ts（1 处）、PluginHotloadManager.ts（1 处） | ✅ |
| R01-006 | tools/（6 文件/~6 处） | 已迁移：TeamDeleteTool.ts（1 处）、TeamCreateTool.ts（1 处）、ToolUtils.ts（1 处）、ExpansionTools.ts（1 处）、ForkSubagent.ts（1 处）、toolSearch.ts（1 处） | ✅ |
| R01-006 | agent/（4 文件/~4 处） | 已迁移：trajectory.ts（1 处）、TeamHelper.ts（1 处）、AgentRunner.ts（1 处）、cli-runner/index.ts（1 处） | ✅ |
| R01-006 | oauth/（3 文件/~3 处） | 已迁移：services/OAuthStorage.ts（1 处）、utils/OAuthStorage.ts（1 处）、services/OAuthStartup.ts（1 处） | ✅ |
| R01-006 | performance/（4 文件/~10 处） | 已迁移：StartupProfiler.ts（2 处）、SlowOperationDetector.ts（1 处）、PerformanceConfig.ts（6 处）、MemoryManager.ts（1 处） | ✅ |
| R01-006 | i18n/（1 文件/~3 处） | 已迁移：i18n/index.ts（3 处） | ✅ |
| R01-006 | utils/（11 文件/~30 处） | 已迁移：auth.ts（3 处）、features.ts（2 处）、telemetry.ts（1 处）、debug.ts（3 处）、proxy.ts（5 处）、caCerts.ts（2 处）、mtls.ts（3 处）、deepLink/TerminalLauncher.ts（4 处）、git/GitignoreParser.ts（2 处）、constants/oauth.ts（4 处）、constants/betas.ts（1 处） | ✅ |
| | R01-004 保留例外：ConfigLoader.ts（Object.entries）、StdioTransport.ts（子进程 env 传播）、environmentRuntimeDetector.ts（动态访问）、Doctor.ts（动态访问）、PromptSuggestionConfig.ts（动态 process.env[envKey]）、pyapp.ts（引导入口）、EnhancedMCPConfigManager.ts（Object.entries 遍历） | 无需迁移 | 有意保留 |
| R03-001 | `agent/events/index.ts` | R01-001 治理例外：InternalEventBus（@deprecated） | 2026-Q3 |
| R03-001 | `core/extensibility/EventBus.ts` | R01-001 治理例外：自建 EventBus 包装器 | 2026-Q3 |
| R03-001 | `voice/VoiceEventBus.ts` | R01-001 治理例外：双工状态管理，待委托到 EventBusImpl | 2026-Q2 |
| R03-001 | `session/lifecycle/SessionLifecycleEventBus.ts` | R01-001 治理例外：通配符 `'*'` 支持，待统一后移除 | 2026-Q2 |
| R03-001 | `streaming/IncrementalRetry.ts` | R01-003 治理例外：增量重试 + 断点续传 | 2026-Q3 |
| R03-001 | `bridge/error/BridgeErrorHandler.ts` | R01-003 治理例外：RetryHandler | 2026-Q3 |
| R03-001 | `query/withRetry.ts` | 误报：仅包含 CannotRetryError 错误类，非重试机制 | 永久 |
| R03-001 | `core/tokenBudget/ModelContextCache.ts` | R01-004 治理例外：已修复，改用 TTLCache | ✅ |
| R03-001 | `core/utils/Performance.ts` | R01-004 治理例外：自建 MemoryCache（大小驱动淘汰） | 2026-Q3 |
| R03-001 | `performance/CacheAndLazyLoading.ts` | R01-004 治理例外：自建 CacheManager（大小+过期管理） | 2026-Q3 |
| R03-001 | `context/ContextCacheService.ts` | R01-004 治理例外：已修复，改用 TTLCache | ✅ |
| R03-001 | `utils/cache.ts` | 标准实现：LRUCache、TTLCache、MemoryCache、PersistentCache、MultiLevelCache、CacheManager | 永久 |
| R03-001 | `utils/withRetry.ts` | R01-003 治理例外：标准 withRetry 工厂函数 | 永久 |
| R03-001 | `utils/fileStateCache.ts` | 工具类缓存，非基础设施 | 永久 |
| R03-001 | `core/health/DependencyHealthChecker.ts` | 标准健康检查基础设施 | 永久 |
| R03-001 | `core/approval/ApprovalCache.ts` | 标准审批缓存，非自建基础设施 | 永久 |
| R03-001 | `diagnostics/SystemHealthChecker.ts` | 诊断模块健康检查，标准实现 | 永久 |
| R03-001 | `monitoring/health/HealthChecker.ts` | 监控模块健康检查，标准实现 | 永久 |
| R03-001 | `channels/line/LineChannel.ts` | 误报：UserProfileCache 为私有内联类，非独立基础设施 | 永久 |

---

## 规则版本

| 项目 | 值 |
|------|-----|
| 版本 | 1.6.0 |
| 创建 | 2026-06-09 |
| 更新 | 2026-09-25 — 新增 **R14 错误级别声明与落盘一致性**（全表穷尽往返断言，`bun test tests/error/errorLogLevel.test.ts` 阻断级；背景见台账附带发现 12 与待办 ⑬） |
| 更新 | 2026-09-25 — 新增 **R13 定时器生命周期**（R13-001 模块顶层 `setInterval` 必须 unref，`bun run lint:unref` 阻断级并入 `ci`；R13-002 存量 149 处收敛清单）；背景见台账附带发现 7，与既有 `lint:exit` 互补（治标 vs 治本） |
| 更新 | 2026-08-10 — 新增 R08 后台任务可观测性（R08-001 跨重启状态持久化 / R08-002 四类事件日志 / R08-003 接入运行状况面板） |
| 来源 | 六轮双轨制扫描 + 实现模式深度分析 + 架构暴胀分析与收敛规范 |
| 配套 | `scripts/lint-architecture.ts` / `dev_docs/20260809/架构治理断链分析与长效治理机制.md` |