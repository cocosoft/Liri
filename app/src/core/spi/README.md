# core/spi — SPI 端口族（端口 · 实现者 · 注入点）

> 本 README 的**主要目的**：把 `core/spi/` 的「**端口 → 实现者 → 注入点 → 消费方**」固化为单一参照，
> 防止**新增端口时另起注册路径**或**绕过 `resolve*()` 直连上层模块**而重新引入跨层倒挂（CS01 / R01 复发）。
> 来源：`任务计划-20261004.md` §24.4-**R11-4**（报告 11 §五-P2；`memory/README.md` 为同手法先例）。
> 取证日期 **2026-10-07**，全部 file:line 为实测。

## 概述

**SPI（Service Provider Interface）** 是 **core 层定义**的抽象契约：core 只声明接口，由上层
（`infra` / `service` / `app`）实现后**注入**，core 通过 `resolve*()` 取得实现 —— 从而消除
`core → 上层` 的静态跨层依赖。装配采用**推送模型**（2026-09-30 台账 **D-128**）：

```
实现体在 entry 层（entrypoints/spiWiring.ts）构建 ──推送──▶ register*Spi() 写入 core 端口
```

> **为什么必须这样**：改造前各 SPI 文件在**自身内部**动态 import 实现方（`ai` / `services` / …）⇒
> 每个文件各产生 **1 个 `core → app|service` 动态跨层对**（门禁 `R00-003` 的 ② 家族）。
> 推送模型把 import 挪到 **entry 层**（可依赖任意层）⇒ **零新增跨层对**。

## 一、目录构成（18 文件，**数字已订正**）

| 类别 | 文件数 | 说明 |
|---|---:|---|
| **端口服务**（`*Service.ts`） | **15** | 各含 `I<X>Port`/`I<X>Service` 接口 + `register<X>Spi()` + `resolve<X>()` + `*_SERVICE_ID` |
| 工具类 | 1 | `CacheService.ts` → `TtlCache`（**不是端口**：无 register/resolve，被直接 `new`） |
| 类型转出 | 1 | `ErrorTypes.ts` → 转出 `core/errors.ts` 的 `AppError`/`ErrorCategory`/`ErrorSeverity`（**不是端口**） |
| 桶文件 | 1 | `index.ts` → 统一出口 |

> ⚠️ **数字订正（2026-10-07 实测）**：台账 §24.4 / 报告 12 记「**15 端口**」（源自 15 个 `*Service.ts`），
> 但 `CacheService.ts` 只提供 `TtlCache` 工具类、**无注册/解析函数** ⇒ 实测端口为 **14 个**。
> **2026-10-07 追加**：新增预留端口 `CollaborationService.ts` ⇒ 端口 **15 个**、目录 **18 文件**。
> （18 = 15 端口 + `CacheService` + `ErrorTypes` + `index`。）
> 另：`ERROR_SERVICE_ID`（`ErrorTypes.ts:12`）**当前 0 消费**（无 `registerErrorSpi`）。

## 二、端口清单（单一参照）

| 端口文件 | 接口 | 消除的倒挂（台账 D 编号） | 实现者（`entrypoints/spiWiring.ts` 注入） | 主要消费方（示例，file:line） | 未注册时 |
|---|---|---|---|---|---|
| `LoggerService.ts` | `ILoggerService` / `ILogger` | `core → monitoring`（D-70，96 对） | `monitoring/logs/Logger`（`getLogger` / `setGlobalConfigProvider`） | `core/loggerFacade.ts`（同名转出）、`core/errorHandler.ts:132/:212/:248`、`acp/AcpWsClient.ts:43` | 转发代理（注册前**缓冲回放**，不丢日志） |
| `OTelService.ts` | `IOTelService` / `IOTelTracing` | `core → monitoring`（三件套，D-129） | `monitoring/otel/OTelTracing` + `monitoring/tracing/SpanCoverageRegistry` | `core/tracingFacade.ts:47/:52`、`core/errorHandler.ts:280` | noop |
| `ProfilerService.ts` | `IStartupProfilerPort` | `core → performance`（三件套，D-129） | `performance/StartupProfiler`（`profileCheckpoint` / `profilePhaseStart` / `profilePhaseEnd`） | `core/profilerFacade.ts:46/:51/:56` | noop |
| `BroadcastService.ts` | `IBroadcastService` | `core/infra → service(infrastructure)`（D-121） | `infrastructure/http/LocalHTTPServiceSSE`（`broadcastEvent`） | `state/background/BackgroundTaskStateMachine.ts:113`、`state/task/TaskStateMachine.ts:110`、`state/app/AppLifecycle.ts:94`、`tasks/PlanDrivenLoop.ts:1381` | 空操作 |
| `AgentToolService.ts` | `IAgentToolPort` | `core → app(tools)`（D-144） | `tools`（`resolveAgentToolInstance()`） | `core/Coordinator.ts:76` | **抛错**（不静默 noop） |
| `PluginSystemService.ts` | `IPluginSystemService` | `service/infra → app(plugins)`（D-122） | `plugins`（`pluginSystem.getLoader().getAllPlugins()`） | `agent/utils/loadPluginAgents.ts:50`、`services/mcp/EnhancedMCPConfigManager.ts:73` | 空列表 |
| `AiAccessService.ts` | `IAiAccessService` | `infra → app(ai)`（D-124 / D-146 / D-155） | `ai`（`aiService` / `providerRegistry` / `modelRouter` / `ModelRegistry` / `credentialStore` …） | `cost/PricingManager.ts:118`、`cost/ModelPricing.ts:64/:119`、`chronos/maintenance/ChronosBackgroundHousekeeping.ts:132`、`config/layers/ConfigLayersService.ts:157`、`memory/MemoryManager.ts:760`、`memory/retrievers/MemoryRetriever.ts:367` | 空值（消费方各自降级） |
| `TaskRegistryService.ts` | `ITaskRegistryPort` | `infra → app(tasks)`（D-147，9 处） | `tasks`（`taskRegistry` / `BaseTask` / `TaskType`） | `daemon/ProcessManager.ts:131/:171`、`chronos/autoDream/AutoDream.ts:190/:213` | 空操作 |
| `KnowledgeGraphService.ts` | `IKnowledgeGraphPort` | `infra → app(knowledge)`（D-148，3 处） | `knowledge/graph/KnowledgeGraph` + `schema/SchemaLoader` + `domain/DomainManager` | `chronos/autoDream/DreamGraphPhase.ts:93/:107/:153/:164` | 空值 |
| `SessionQualityService.ts` | `ISessionQualityPort` | `infra → app(chat/evals)`（U4，2026-10-06） | `evals`（`summarizeTurnQuality`）+ `runtime/api/CoreAPIImpl`（`getCoreAPI`） | `chronos/autoDream/AutoDream.ts:59` | 空操作（返回 `null`） |
| `DiagnosticsProbeService.ts` | `IDiagnosticsProbeService` | `infra → service(voice/channels/mcp)`（D-123） | `services/voice/services/{sttRegistry,ttsProvider}` + `channels` + `services/mcp` | `diagnostics/SystemHealthChecker.ts:471`、`diagnostics/infrastructure-diagnostics.ts:185` | 空快照 |
| `SandboxService.ts` | `ISandboxPort` | `infra(security/permission/infrastructure) → app(sandbox)`（D-154 / D-157 / D-200） | `sandbox`（`SandboxManager` / `globalWorkspaceManager` / `processRegistry` / `resourceLimitManager`） | `permission/PermissionService.ts:79`、`security/SecurityIntegration.ts:99/:134/:169/:177`、`infrastructure/http/handlers/sandbox-handlers.ts:148`、`infrastructure/http/handlers/handler-utils.ts:174` | 空值（**fail-closed**：默认工作区缺失 ⇒ `hasWorkspacePermission` 为 `false`） |
| `HookChainService.ts` | `IHookChainPort` | `infra(cost/memory) → app(hooks)`（D-155 / D-168） | `hooks`（`HookChainManager`，返回值投影为 `{ blocked }`） | `cost/CostHookDispatcher.ts:67/:75`、`memory/MemoryHookDispatcher.ts:55/:78` | 空操作 |
| `KnowledgeService.ts` | `IKnowledgeService` | `infra(chronos) → app(knowledge)`（D-125） | `knowledge`（`KnowledgeCompiler` / `KnowledgeLinter` / `KnowledgeDigestService`） | `chronos/knowledge/knowledgeMaintenance.ts:95/:104/:116`、`chronos/autoDream/AutoDream.ts:550` | 空值 |
| `CollaborationService.ts` | `ICollaborationPort` | **无**（**预留端口**，非倒挂收口；2026-10-07 范围 A 薄端口） | `agent/orchestration/{Swarm,Scheduler,Remote}ChannelAdapter`（形状搬运；**当前未构造**——引擎实例 / executor 由**第一消费入口**提供） | **暂无（预留）** | 空操作（`listChannels() → []`、`dispatch() → null`） |

> ⚠️ **`CollaborationService.ts` 为预留端口**（生产**无消费者**，先例 `MemoryHookDispatcher`）——
> **勿视为既有能力**。已登记 `.trae/specs/dead-code-and-unwired-items-rulings.md` 的 **UW 组**；
> 接线触发条件见 spec（`.trae/specs/collaboration-orchestration-port.md` §5）。

## 三、装配链与消费链（关系图）

```
   main.ts:1252  registerSpis: (container) => registerAllSpis(container)
        │
        ▼
   core/di/DIContainer.ts:316  ── bootstrap() 在原注册点回调（时机/顺序逐字不变）
        │
        ▼
   entrypoints/spiWiring.ts  registerAllSpis()      ◀── 唯一注入点（推送模型，entry 层）
        │  await import('@modules/<上层>')  →  构建实现体  →  register<X>Spi(container, impl)
        │
        ▼   （15 次 register*Spi；每次写入 core 端口的模块级 `_service`）
   core/spi/<X>Service.ts   resolve<X>()   ← 转发代理（延迟绑定，每次调用解析当前实现）
        ▲
        │  消费方一律经 resolve<X>()，❌ 不直接 import 上层模块
        │
   ┌────┴─────────────────────────────────────────────────────────────┐
   │  core      ：Coordinator(AgentTool)、errorHandler(Logger/OTel)、facade(Logger/OTel/Profiler) │
   │  infra     ：chronos / daemon / memory / cost / security / permission(MCP…)                   │
   │  service   ：infrastructure/http handlers / services(mcp, voice) / state                     │
   └──────────────────────────────────────────────────────────────────┘
```

**消费侧 facade（core 内部便捷入口）**：`core/loggerFacade.ts`（同名转出 `getLogger`）、
`core/tracingFacade.ts`、`core/profilerFacade.ts` —— 三者只是 `resolve*()` 的薄封装，
**不新增端口**；core 内 96 个日志消费方经 `loggerFacade` 只改 import 路径（D-70）。

## 四、装配时机与顺序（**顺序敏感**）

- **时机**：`DIContainer.bootstrap()` 经 `BootstrapOptions.registerSpis` 回调，
  在**原注册点**调用 ⇒ 注册顺序与时机**逐字不变**；实现体内部动态 import 保持**惰性**。
- **顺序**：`AiAccess` **必须先于** `Knowledge` —— 后者在装配期经 `resolveAiAccess().getAiService()`
  取 `aiService`（`spiWiring.ts:482`）。
- **AgentTool 特例**：`resolveAgentToolInstance()` 返回空（工具管理器未就绪）时**跳过注册**，
  **不静默降级**（`spiWiring.ts:120-124`，CS03）—— 未注册时 `resolveAgentTool()` **调用即抛错**。

## 五、维护约定（防复发）

1. **新增端口**：接口定义在 `core/spi/<X>Service.ts`，实现体**必须在 `entrypoints/spiWiring.ts` 构建后推送注册**
   ⇒ ❌ 不得在 `core/spi/*` 内 `await import('@modules/<上层>')`（那正是 D-128 改造掉的东西，会重造 `R00-003` ② 家族）。
2. **消费方**：一律 `resolve<X>()`（或 core 侧 facade）取用 ⇒ ❌ 不得直接 import 上层模块绕过端口。
3. **降级语义**：除 `AgentToolService`（核心能力，**抛错**）外，其余端口未注册时**返回 noop / 空值**，
   由消费方自行降级 ⇒ 新增端口须**显式声明**未注册行为（是 noop 还是抛错）。
4. **不要为跨层便利另起同名类**：core 需要用上层能力 ⇒ 定义**窄端口**，不得在 core 内 new 上层实现。
5. **`TtlCache` 不是端口**：core 内需 TTL 缓存直接 `new TtlCache(...)`（`acp/control-plane/runtime-cache.ts:10`、
   `core/utils/Performance.ts:581`、`tokenBudget/ModelContextCache.ts` 为先例），**勿**为它造 register/resolve。

## 相关文档

- `.trae/specs/` 内各端口由来 spec（如 `monitoring-logger-core-spi.md`、`online-quality-evaluation.md` §D6）
- `dev_docs/任务计划-20261004.md` §24.4-**R11-4**（本 README 出处）/ §15.2-A12 / §25.2（报告 12 §五-P2）
- [memory/README.md](../memory/README.md) —— 同手法先例（分层 + 端口边界单一参照）
- `.trae/rules/architecture-compliance.md` —— R00-001（分层）/ R00-003（动态跨层引用）/ R01（基础设施复用）
