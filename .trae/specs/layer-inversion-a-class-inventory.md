# A 类分层倒挂盘点与分组（core → 上层）

> 生成方式：临时摘除 `scripts/layer-exceptions.json` 的 5 条 A 类 bulk 例外后跑门禁取数 + 仓库外只读脚本复刻枚举，随后**原样还原**。
> 判据规则：**R00-001**（`scripts/lint-architecture.ts`）+ `scripts/modules-to-layers.json`（`core: ["core"]`）。
> 关联：`.trae/specs/architecture-benchmark-20260928.md` §5.7（A 类 = 倒挂·严重）。
> 日期：2026-09-30。

---

## §1 目的与方法

### 1.1 目的
把分层门禁中的 **A 类倒挂（`core → 上层`）** 逐条列出并归入 G1–G4 四组，为后续收口排定批次。**本 spec 只盘点、不改代码、不改例外清单。**

### 1.2 判据
- `allowedDependencies.core = ["core"]` ⇒ core 层文件依赖 infra/service/app/ui/entry 任一层即为 **R00-001 违规**。
- core 层模块（按 `modules-to-layers.json`）：`core`、`modules`、`acp`、`mcp`、`types`。
- 门禁违规的**统计单元是「文件 × 目标模块」对**（`parseModuleImports` 用 `Set` 去重）。

### 1.3 取数方法（临时摘例外 + 原样还原）
1. 备份 `scripts/layer-exceptions.json` 到 `$env:TEMP`，记录 SHA256 = `8F4D738E6E07C0A81F8A648684D3EA49B3B408320155B6F21B969899FB7B67CA`。
2. 门禁基线（未动例外）：`错误 0 / 警告 1（仅 R07-004）`；`分层检查完成: 检查 3957 个文件 | 违规 0 | 已豁免 463`。
3. **临时删除** `bulkExceptions` 中 5 条 A 类例外（`BULK-010` core→infra / `BULK-011` core→service / `BULK-012` core→app / `BULK-013` core→ui / `BULK-017` core→entry）；**未动** `PM-001`、`BULK-004/005/007/008/009/014/015/016/018`。
4. 运行 `bun run scripts/lint-architecture.ts`（项目根），完整保存输出到 `$env:TEMP\inv.log`。
5. **立即还原**：用备份覆盖 `scripts/layer-exceptions.json`，复跑门禁。

### 1.4 还原验证结果
- 还原后门禁：`错误 0 / 警告 1（仅 R07-004）`，`已豁免 463` ⇒ **回到基线**。
- `Get-FileHash -Algorithm SHA256` 与备份**逐字节一致**：`8F4D738E…B67CA`。
- 结论：`scripts/layer-exceptions.json` **最终与本任务开始时逐字节一致**。

### 1.5 取数通道与一致性校验
门禁输出对每条规则**仅打印前 5 条样本**（`items.slice(0, 5)`），无 JSON/verbose 通道 ⇒ 逐条枚举需另取。
本次采用**双通道**并交叉校验：
- 通道 A（权威总数）：门禁汇总行。摘例外后 `[R00-001] 218 条违规`。
- 通道 B（逐条枚举）：仓库外只读脚本，严格复刻门禁的 `collectTsFiles` / `resolveModuleName` / `parseModuleImports`（含 `@modules/` 与相对路径两条正则、**不要求 `import` 前缀故 `export … from` 也计入**）与 `moduleToLayer` 判定。
- **交叉校验**：通道 B 得到「文件数 3957」（= 门禁）、「(文件,目标模块) 对 = 218」（= 门禁 218）；且门禁输出的 4 条样本（`acp/AcpWebSocketServer.ts→monitoring`、`→error`、`acp/AcpWsClient.ts→error`、`acp/control-plane/manager.core.ts→error`）在通道 B 结果中原样出现。⇒ 枚举可信。

> 临时脚本仅置于 `$env:TEMP`，未进入仓库；仓库内只新增本 spec。

---

## §2 A 类总盘

| 指标 | 数值 |
|------|------|
| R00-001 摘例外后违规总数（= A 类，全部为 core→上层） | **218**（文件×目标模块对） |
| A 类 import/export 语句数（file:line 明细） | **280** |
| 涉及 core 侧源文件数 | **122** |
| 涉及 core 侧模块 | core 125 对 / modules 64 对 / mcp 19 对 / acp 10 对（按对计） |
| `core -> ui` | **0** |

### 2.1 按 pattern 分布（对 = 门禁统计单元）

| pattern | 例外条目 | `estimatedCount`（清单原值） | **实测（对）** | 偏差 |
|---------|---------|:---:|:---:|------|
| `core -> infra` | BULK-010 | 50 | **177** | +127 |
| `core -> app` | BULK-012 | 10 | **28** | +18 |
| `core -> service` | BULK-011 | 10 | **10** | 0 |
| `core -> ui` | BULK-013 | 10 | **0** | -10 |
| `core -> entry` | BULK-017 | 1 | **3** | +2 |
| **合计** | — | **81** | **218** | **+137** |

> ⚠️ 与 spec §5.7 的「约 81 处」偏差显著：**实测 218**，主要是 `core -> infra` 被严重低估（50 → 177）。原因是 `estimatedCount` 为建账估值，未随 core 层（尤其 `core/tokenBudget`、`core/loop`、`core/events`、`mcp` barrel）拆分增长同步刷新。

### 2.2 按目标模块分布（对 / 语句）

| 目标模块（层） | 对 | 语句 |
|----------------|:---:|:---:|
| monitoring (infra) | 101 | 104 |
| error (infra) | 59 | 63 |
| tools (app) | 8 | 19 |
| ai (app) | 7 | 12 |
| services (service) | 7 | 33 |
| config (infra) | 6 | 6 |
| tasks (app) | 4 | 9 |
| utils (infra) | 3 | 3 |
| agent (app) | 3 | 3 |
| performance (infra) | 3 | 3 |
| context (app) | 2 | 2 |
| query (app) | 2 | 3 |
| state (infra) | 2 | 5 |
| session (service) | 2 | 3 |
| cost (infra) | 2 | 4 |
| entrypoints (entry) | 2 | 2 |
| system (infra) | 1 | 2 |
| plugin-sdk (app) | 1 | 1 |
| bootstrap (entry) | 1 | 1 |
| tool (app) | 1 | 1 |
| runtime (service) | 1 | 1 |

---

## §3 分组清单

> 分组单元 = **import/export 语句**（`源文件:行` + 被导入符号）。同一源文件的同一 (文件,目标模块) 对若含多条语句，会出现在同一分组。
> 判据：G1 仅类型；G2 纯函数/常量/无副作用工具；G3 具体实现/类/单例（需 SPI/DI）；G4 core 主动调用/实例化上层能力（需反转调用）。
> **待判：0 条**。

### 3.1 G1 纯类型（36 条）—— 最低风险，应下沉 core / 由 core 提供接口

| 源文件:行 | 导入符号 | 目标模块 | 理由 |
|-----------|---------|---------|------|
| `app/src/core/boot/BootPipelineIntegrator.ts:17` | RouterTier | ai (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/loop/PlanDrivenLoop.ts:24` | ChatMessage | ai (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/loop/PlanDrivenLoop.ts:29` | DecompositionResult | ai (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/loop/PlanDrivenLoop.ts:35` | AIProvider | ai (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/context/index.ts:21` | ContextData（export 再导出） | context (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/tokenBudget/CacheAwareBudget.ts:10` | ModelPricing | cost (infra) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/tokenBudget/PriceManager.ts:18` | ModelPricing | cost (infra) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/events/OrchestrationMetrics.ts:13` | OTelMetrics | monitoring (infra) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/index.ts:65` | Plugin（export 再导出） | plugin-sdk (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/loop/PlanDrivenLoop.ts:23` | TAORLoopDeps | query (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:10` | ContextTracker | query (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/cli/mcpCommand.ts:16` | MCPOAuthConfig | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/index.ts:34` | MCPOAuthConfig, MCPOAuthToken, MCPOAuthState, MCPOAuthDiscoveryState（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/index.ts:95` | MCPToolInfo（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/index.ts:135` | MCPResourceType, MCPResource, MCPTextResource, MCPImageResource, MCPBinaryResource, ResourceProcessingConfig（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/index.ts:145` | ChannelPermissionResponse, ChannelPermissionCallbacks（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/index.ts:176` | ElicitationRequestEvent, ElicitResponseType, MCPElicitResponse, ElicitInputType, ElicitOption, ElicitationWaitingState, MCPElicitHandler, ElicitToolParams（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/index.ts:189` | PluginMCPToolOptions（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/managers/MCPManager.ts:8` | MCPServerManager | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/types/MCPTypes.ts:23` | MCPServerConfig, ScopedMcpServerConfigExt, MCPToolDefinition, MCPResourceDefinition, MCPPromptDefinition, MCPRequest, MCPResponse, MCPClientState, MCPClientInfo, MCPServerInfo, MCPConnectionConfig, MCPConnectionStats, MCPEventType, MCPEvent, MCPTransport, MCPServerConnectionInfo | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/types/MCPTypes.ts:51` | ConfigScope, MCPServerType（export 再导出） | services (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/session/SessionStoreAdapter.ts:12` | SessionStore | session (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/session/SessionSupervisor.ts:10` | ResetPolicy | session (service) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/notifications/NotificationService.ts:8` | AppState, AppStateStore | state (infra) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/notifications/NotificationService.ts:9` | Notification, NotificationType | state (infra) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/index.ts:73` | AuthManager, AuthConfig（export 再导出） | system (infra) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/core/loop/PlanDrivenLoop.ts:34` | Plan, PlanProgress | tasks (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/mcp/MCPTool.ts:6` | Tool, ToolUseContext, ToolResult | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/calendar/tools/CalendarToolWrap.ts:5` | Tool, ToolParam | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/calendar/tools/CalendarToolWrap.ts:6` | ToolResult | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/calendar/tools/CalendarToolWrap.ts:8` | ToolUseContext | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/doc/DocModule.ts:19` | Tool | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/doc/pipeline/DocPipelineTool.ts:25` | Tool, ToolUseContext | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/mail/tools/MailSendTool.ts:5` | Tool, ToolParam | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/mail/tools/MailSendTool.ts:6` | ToolResult | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |
| `app/src/modules/mail/tools/MailSendTool.ts:8` | ToolUseContext | tools (app) | 仅类型/接口，运行时零依赖 ⇒ 可下沉 core 或由 core 定义接口 |

### 3.2 G2 属共享常量/工具（50 条）—— 评估下沉 core 或 core 内自持

| 源文件:行 | 导入符号 | 目标模块 | 理由 |
|-----------|---------|---------|------|
| `app/src/core/events/EventBusOTelBridge.ts:16` | OrchestrationEventType | agent (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/events/OrchestrationMetrics.ts:11` | OrchestrationEventType | agent (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/events/TokenTracker.ts:14` | OrchestrationEventType | agent (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/ModelContextCache.ts:14` | ALL_MODEL_CONFIGS | ai (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/TokenBudgetController.ts:46` | estimateTokens | ai (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:11` | extractUsage | ai (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:16` | estimateTokens, estimateMessagesTokensCooperative, estimateMessagesTokens | ai (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:17` | getCachedTiktokenEncoder | ai (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:18` | resolveContextWindow | context (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/CacheAwareBudget.ts:9` | calculateTotalCost | cost (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/PriceManager.ts:17` | calculateCost | cost (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/di/AutoWiringEngine.ts:7` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/exit/ExitRecorder.ts:36` | isAbortReason | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/lifecycle/GracefulRestartService.ts:6` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/media-generation/runtime-shared.ts:1` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/migration/MigrationRegistry.ts:47` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/spi/ErrorTypes.ts:8` | AppError, ErrorCategory, ErrorSeverity（export 再导出） | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/systemgraph/SystemGraph.ts:30` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/BudgetPolicy.ts:43` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/utils/ErrorHandler.ts:8` | toError, isAbortError, errorMessage | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/utils/LazyModuleLoader.ts:6` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/mcp/client/MCPClient.ts:7` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/channel/DocChannelHandler.ts:7` | AppError | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/concurrency/MCPRequestQueue.ts:6` | AppError | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/detection/OfficeCLIErrorParser.ts:6` | AppError | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/execution/ExecutionGuardian.ts:8` | AppError | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/execution/ResourceGuardian.ts:10` | AppError | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/workflow/DocWorkflowProvider.ts:37` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ImportManager.ts:6` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ImportManager.ts:7` | ErrorCodes | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleDefinitions.ts:6` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleDefinitions.ts:7` | ErrorCodes | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleInitializer.ts:6` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleInitializer.ts:7` | ErrorCodes | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleRegistry.ts:6` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleRegistry.ts:7` | ErrorCodes | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/workflow/WorkflowError.ts:31` | AppError, ErrorCategory, ErrorSeverity | error (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/StartupPrefetcher.ts:8` | profileCheckpoint | performance (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/LazyModuleStrategy.ts:19` | profilePhaseStart, profilePhaseEnd | performance (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/ModuleInitializer.ts:26` | profilePhaseStart, profilePhaseEnd | performance (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/mcp/types/MCPTypes.ts:28` | MCP_PROTOCOL_VERSION, MCPServerStatus（export 再导出） | services (service) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/calendar/CalendarMerger.ts:14` | computeNextCronRunMs | tasks (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/mcp/MCPTool.ts:7` | createToolResult | tools (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/calendar/tools/CalendarToolWrap.ts:7` | ToolExecutionStatus | tools (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/DocModule.ts:20` | ToolExecutionStatus | tools (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/doc/pipeline/DocPipelineTool.ts:26` | ToolExecutionStatus | tools (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/modules/mail/tools/MailSendTool.ts:7` | ToolExecutionStatus | tools (app) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/Coordinator.ts:7` | lazySingleton | utils (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/tokenBudget/ModelContextCache.ts:13` | TTLCache | utils (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |
| `app/src/core/utils/Performance.ts:3` | TTLCache | utils (infra) | 纯函数/常量/无副作用工具 ⇒ 可下沉 core 或 core 内自持 |

### 3.3 G3 需 SPI/DI（183 条）—— core 定义接口 + 上层实现 + 注入

| 源文件:行 | 导入符号 | 目标模块 | 理由 |
|-----------|---------|---------|------|
| `app/src/core/flows/model-picker.ts:7` | modelManager | ai (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/PriceManager.ts:15` | ModelRegistry | ai (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/boot/BootPipelineIntegrator.ts:18` | configManager | config (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/loop/PlanDrivenLoop.ts:19` | configManager | config (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/storage/SecureStorage.ts:22` | configManager | config (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/utils/Performance.ts:2` | configManager | config (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/cli/mcpCommand.ts:7` | configManager | config (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/MCPTool.ts:11` | configManager | config (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/AcpWebSocketServer.ts:40` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/AcpWsClient.ts:31` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/control-plane/manager.core.ts:14` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/control-plane/manager.identity-reconcile.ts:9` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/control-plane/manager.runtime-controls.ts:7` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/control-plane/manager.ts:13` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/control-plane/session-actor-queue.ts:1` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/runtime/availability.ts:4` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/secret-file.ts:3` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/AppCoreOTelHelper.ts:17` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/boot/BootPipeline.ts:19` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/boot/BootPipelineIntegrator.ts:19` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/Coordinator.ts:9` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/delivery/monitor/DiskSpaceMonitor.ts:3` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/delivery/notifier/FailureNotifier.ts:2` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/di/ContainerScope.ts:15` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/di/DIContainer.ts:11` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/extensibility/ModuleManager.ts:37` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/extensibility/PluginLoader.ts:38` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/external/sqlite3.ts:34` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/flows/model-picker.ts:10` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/lazy/LazyService.ts:12` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/loop/PlanDrivenLoop.ts:20` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/memory-host-sdk/events.ts:5` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/RemoteConfigManager.ts:11` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/session/SessionSupervisor.ts:8` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/storage/SecureStorage.ts:18` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/CacheAwareBudget.ts:13` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/ContextStatsCollector.ts:10` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/ModelContextCache.ts:18` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/PriceManager.ts:11` | AppError, ErrorCategory, ErrorSeverity, handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:20` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/cli/mcpCommand.ts:12` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/api/officeHandlers.ts:9` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/installation/OfficeCliInstallService.ts:10` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/pipeline/DocPipelineTool.ts:33` | handleError, AppError, ErrorCategory, ErrorSeverity | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/workflow/DocWorkflow.ts:13` | handleError | error (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/acp/AcpWebSocketServer.ts:38` | getLogger, getOTelTracing | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/AppCoreOTelHelper.ts:16` | getLogger, Logger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/auto-reply/dispatch.ts:3` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/boot/BootPipeline.ts:18` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/boot/BootPipelineIntegrator.ts:13` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/connections/ConnectionRegistry.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/Coordinator.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/delivery/adapter/DeliveryAdapter.ts:1` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/delivery/archiver/TranscriptArchiver.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/delivery/monitor/DiskSpaceMonitor.ts:2` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/delivery/notifier/FailureNotifier.ts:1` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/di/AutoWiringEngine.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/di/ContainerScope.ts:14` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/di/DIContainer.ts:12` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/estop/estop.ts:37` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/events/EventBus.ts:9` | Logger, getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/events/EventBusOTelBridge.ts:22` | getOTelTracing, isSpanCovered, markSpanCovered | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/events/OrchestrationMetrics.ts:14` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/events/TokenTracker.ts:21` | createLogger, LogLevel | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/exit/ExitRecorder.ts:34` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/extensibility/ExtensibilityService.ts:28` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/extensibility/ModuleManager.ts:38` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/extensibility/PluginLoader.ts:39` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/external/sqlite3.ts:33` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/flows/channel-setup.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/flows/doctor-health.ts:6` | HealthChecker | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/flows/doctor-health.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/flows/model-picker.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/health/DependencyHealthChecker.ts:21` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/idle/IdleScaleMonitor.ts:37` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/lazy/LazyService.ts:13` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/lifecycle/GracefulRestartService.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/loop/PlanDrivenLoop.ts:18` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/loop/PlanDrivenLoop.ts:21` | getOTelTracing | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/media-generation/runtime-shared.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/memory-host-sdk/events.ts:4` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/migration/AppMigrationStore.ts:34` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/migration/MigrationRegistry.ts:46` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/migration/StateMigrator.ts:11` | Logger, getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/node-host/ExecPolicy.ts:3` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/paths.ts:31` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/patterns/PatternSelector.ts:15` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/performance/SprintPerformanceChecker.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/performance/StartupPreloader.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/persona/PersonaService.ts:19` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/RemoteConfigManager.ts:12` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/session/SessionSupervisor.ts:6` | getLogger, getOTelTracing | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/sleep/SleepMonitor.ts:20` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/StartupPrefetcher.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/storage/SecureStorage.ts:19` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/theme.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/BudgetPolicy.ts:44` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/CacheAwareBudget.ts:12` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/ContextStatsCollector.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/ModelContextCache.ts:17` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/PriceManager.ts:20` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/TokenBudgetController.ts:47` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/tokenCalibration.ts:18` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/tokenBudget/UnifiedTokenTracker.ts:19` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/utils/ErrorHandler.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/utils/LazyModuleLoader.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/utils/Performance.ts:1` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/cli/mcpCommand.ts:11` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/client/MCPClient.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/managers/MCPManager.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/MCPTool.ts:13` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/AIScheduleIndex.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/CalendarEventBus.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/CalendarMerger.ts:11` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/CalendarModule.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/ScheduleHook.ts:12` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/tools/CalendarToolWrap.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/api/officeHandlers.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/audit/OfficeAuditLogger.ts:10` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/channel/DocChannelHandler.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/concurrency/MCPRequestQueue.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/detection/elicitationPrompts.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/detection/OfficeCLIDetector.ts:10` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/detection/OfficeCLIErrorParser.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/DocModule.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/document/DocumentGraph.ts:10` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/execution/ExecutionGuardian.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/execution/ResourceGuardian.ts:11` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/installation/OfficeCliInstallService.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/observability/OfficeMetrics.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/orchestration/DocOrchestrator.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/orchestration/DocOrchestratorProvider.ts:41` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/placeholder/PlaceholderResolver.ts:12` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/template/TemplateEngine.ts:7` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/template/TemplateMarketplace.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/workflow/DocWorkflow.ts:12` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/workflow/DocWorkflowProvider.ts:36` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/workflow/PptRefiner.ts:13` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/ImportManager.ts:10` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/LazyModuleStrategy.ts:20` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/mail/channel/MailChannelHandler.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/mail/MailModule.ts:6` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/mail/tools/MailSendTool.ts:9` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/ModuleDefinitions.ts:10` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/ModuleInitializer.ts:27` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/ModuleRegistry.ts:8` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/workflow/WorkflowEngine.ts:31` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/workflow/WorkflowStepLedger.ts:36` | getLogger | monitoring (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/cli/mcpCommand.ts:8` | getMCPServerManager | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:28` | MCPAuthManager, mcpAuthManager（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:67` | MCPTransport（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:68` | TransportFactory（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:69` | SSETransport（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:70` | WebSocketTransport（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:71` | HTTPTransport（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:72` | StdioTransport（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:76` | createLinkedTransportPair, InProcessTransportFactory（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:90` | MCPServerManager, getMCPServerManager（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:91` | MCPConnection（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:94` | MCPToolRegistry（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:122` | prefetchOfficialMcpUrls, isOfficialMcpUrl, getOfficialServers, getOfficialServersByCategory, getOfficialServer, getCategories（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:127` | MCPResourceManager, mcpResourceManager（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:141` | ChannelPermissionRelay, getChannelPermissionRelay, clearChannelPermissionRelay（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:157` | normalizeNameForMCP, normalizeToolName, normalizeSimpleToolName, normalizeResourceUri, normalizeSimpleResourceUri, normalizeCommandName, needsNormalization, denormalizeMcpName, isValidMcpName（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:166` | mcpElicitationQueue, MCPElicitationQueue, DefaultMCPElicitHandler, buildElicitResponse, getElicitInputType, validateElicitParams（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/index.ts:188` | createPluginMCPTools, getPluginSummary（export 再导出） | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/managers/MCPManager.ts:7` | getMCPServerManager | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/MCPTool.ts:9` | getMCPServerManager | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/types/index.ts:31` | ServerResource | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/utils/mcpConfig.ts:10` | enhancedMcpConfigManager, EnhancedMCPConfigManager | services (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/session/SessionSupervisor.ts:9` | ResetPolicyDecider | session (service) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/migration/StateMigrator.ts:6` | AppState, getDefaultAppState | state (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/migration/StateMigrator.ts:10` | getGlobalStore, initializeGlobalStore | state (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/notifications/NotificationService.ts:7` | appStateStore | state (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/core/index.ts:35` | *（export 再导出） | system (infra) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/CalendarMerger.ts:12` | CronJobStore | tasks (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/ScheduleHook.ts:14` | CronJobStore | tasks (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/workflow/WorkflowEngine.ts:33` | TaskDependencyService, TaskRegistry | tasks (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/mcp/MCPTool.ts:10` | toolScopeManager | tool (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/calendar/CalendarModule.ts:8` | globalToolManager | tools (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/DocModule.ts:8` | globalToolManager | tools (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/doc/pipeline/DocPipelineTool.ts:24` | getToolRegistry | tools (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |
| `app/src/modules/mail/MailModule.ts:8` | globalToolManager | tools (app) | 具体实现/类/单例 ⇒ core 定义接口 + 上层实现 + 注入（SPI/DI） |

### 3.4 G4 需反转调用（11 条）—— 事件/注册表/注入反转，风险最高

| 源文件:行 | 导入符号 | 目标模块 | 理由 |
|-----------|---------|---------|------|
| `app/src/core/loop/PlanDrivenLoop.ts:28` | TaskDecomposer, MAX_SUBTASKS | ai (app) | core(PlanDrivenLoop) 调用应用层任务分解器 |
| `app/src/core/StartupPrefetcher.ts:13` | getStartupState, getSessionId, getOriginalCwd | bootstrap (entry) | core(StartupPrefetcher) 读取入口层启动状态 |
| `app/src/mcp/index.ts:182` | startMCPServer（export 再导出） | entrypoints (entry) | core(mcp barrel) 再导出入口层启动函数 startMCPServer |
| `app/src/mcp/server/entrypoint.ts:36` | startMCPServer | entrypoints (entry) | core(mcp barrel) 再导出入口层启动函数 startMCPServer |
| `app/src/core/loop/PlanDrivenLoop.ts:22` | TAORLoop | query (app) | core(PlanDrivenLoop) 实例化并驱动应用层 TAOR 引擎 |
| `app/src/modules/doc/pipeline/DocPipelineTool.ts:27` | getCoreAPI | runtime (service) | core(modules/doc) 取服务层 CoreAPI 门面单例 |
| `app/src/core/loop/PlanDrivenLoop.ts:30` | taskOrchestrator | tasks (app) | core(PlanDrivenLoop) 调用应用层任务编排单例 |
| `app/src/core/loop/PlanDrivenLoop.ts:31` | emitPdcaLiveEvent | tasks (app) | core(PlanDrivenLoop) 调用应用层 PDCA 事件发射器 |
| `app/src/core/loop/PlanDrivenLoop.ts:32` | writePdcaCheckpoint | tasks (app) | core(PlanDrivenLoop) 调用应用层 PDCA 检查点写入 |
| `app/src/core/loop/PlanDrivenLoop.ts:33` | goalMetricsService | tasks (app) | core(PlanDrivenLoop) 调用应用层目标指标服务 |
| `app/src/core/Coordinator.ts:11` | AgentTool, resolveAgentToolInstance | tools (app) | core(Coordinator) 引用应用层 Agent 工具实现 |

---

### 3.5 G2 细分（H1–H5）（2026-09-30 追加；台账 D-60）

> 本节由**逐条打开 §3.2 全部 50 条语句**核实而成（记录**定义位置**、是否带状态/副作用、core 层消费方数），**未臆断**。
> （§0 修订记录待补：2026-09-30 / 追加 §3.5 / 台账 D-60。）

**两口径对应（此前未解释）**：语句级 **50** → 去重 (源文件, 目标模块) 对 **44** → **−6**（同对多语句溢出：`ImportManager`/`ModuleDefinitions`/`ModuleInitializer`/`ModuleRegistry` 各 2 条、`UnifiedTokenTracker→ai` 3 条）→ **−3**（同对含 G3 语句者按"对只归一档"归 G3：`DocPipelineTool`→tools、`DocModule`→tools、`CalendarMerger`→tasks）⇒ **对级 41** ✓（`5+41+164+8=218` 与 `36+50+183+11=280` 双向自洽）。

**🔴 决定性结论（决定批次可行性）**：41 对中**仅 24 对**能"**只搬 G2 符号**"就消除计数；其余 **17 对**因**同对仍残留 G1/G3 语句** ⇒ 单独搬 G2 **不改变门禁计数**（必须先做同对的 G1/G3）。⇒ **G2 不可按"41 处"批量推进**。

| 子档 | 语句数 | 对级覆盖 | 说明 |
|---|:--:|:--:|---|
| **H1 可下沉 core** | **37** | 32（其中 **24 对**可"仅靠 H1"消除） | error 家族 26 + ai 分词 3 + cost 2 + tools 5 + utils 1 |
| **H2 core 自持 + 上层转出** | **1** | 1 | `computeNextCronRunMs`（定义在 `tasks`） |
| **H3 应转 G3（需端口/DI）** | **8** | 6 | `ALL_MODEL_CONFIGS` · `getCachedTiktokenEncoder` · `resolveContextWindow` · `profileCheckpoint`/`profilePhaseStart`/`profilePhaseEnd` · `TTLCache`×2 |
| **H4 应转 G4（反转调用）** | **0** | 0 | G2 内**确无**该类（非漏填） |
| **H5 待判（红线/证据不足）** | **4** | 4 | `OrchestrationEventType`×3 · `MCP_PROTOCOL_VERSION`/`MCPServerStatus`×1 |

**"名不副实"的三条（最该从 G2 挪走）**：
1. `core/tokenBudget/ModelContextCache.ts:14` → `ALL_MODEL_CONFIGS`（定义 `ai/models/ModelConfigs.ts:62`）：**不是常量，是 `new Proxy`** ⇒ 每次属性访问走 `_getAllFromRegistry()` → `require('./ModelRegistry.js')` → **DB `model_registry` 表** + `globalThis` 缓存 ⇒ **应转 G3**。
2. `core/tokenBudget/UnifiedTokenTracker.ts` → `getCachedTiktokenEncoder`（定义 `ai/tokenizer/TiktokenEstimator.ts:88`）：模块级 `_encoder`、异步加载、30s 重试、失败 `handleError` ⇒ **应转 G3**。
3. `core/StartupPrefetcher.ts:8`（同族 `modules/LazyModuleStrategy.ts:19`、`modules/ModuleInitializer.ts:26`）→ `profileCheckpoint` / `profilePhaseStart`/`profilePhaseEnd`（定义 `performance/StartupProfiler.ts:115/:129/:143`）：模块级采样开关 + `fs` 落盘 + 上报 ⇒ **应转 G3**。

#### 3.5.1 G2 首批建议（最小、最干净）—— **⚠️ 已于 2026-09-30 执行并更正预期（台账 D-62）**

> **执行结果（实测）**：按本表执行 4 条 ⇒ **实际消除 3 对**（`ExitRecorder→error`、`ErrorHandler→error`、`Coordinator→utils`），**不是 7 对**；`已豁免` **458 → 455**，`core -> infra` 的 `estimatedCount` **50 → 47**，`lint:arch` 仍 **0 错 / 1 警 / 违规 0**，`app`/`client` typecheck **0**，全量 **4251 pass / 0 fail**。
> **🔴 更正（原表第 3 行"−4 对"错误）**：门禁统计单元是 **(源文件 × 目标模块) 对**，**不是语句条数**。那 4 个 `modules/*` 文件对 `error` **各有两条语句**（`:6` `AppError`/`ErrorCategory`/`ErrorSeverity` + `:7` `ErrorCodes`）⇒ **只搬 `ErrorCodes` 时同对仍残留 ⇒ 计数不变**（已 A/B 实证：把 4 处临时回退为原样复跑，`已豁免` 仍为 455 ⇒ 贡献确为 **0 对**）。
> ⇒ **要真正吃掉这 4 对，必须与 `AppError`/`ErrorCategory`/`ErrorSeverity`（本表下方"第 2 批 / 22 对"）同批搬 core**。
> ⇒ **通用教训（适用于后续所有批次）**：选择批次时，**必须先按"对"聚合该对内的全部语句**，逐对判断"搬哪些才能让该对清零"，否则会出现"改了代码、计数不动"的空转。

| # | 源文件:行 | 符号 | 定义位置 | core 消费方 | 实际消除对 | 状态 |
|:--:|---|---|---|:--:|:--:|:--:|
| 1 | `core/exit/ExitRecorder.ts:36` | `isAbortReason`（+ `SYSTEM_ABORT_REASON` / `markAsExpectedAbort`） | 已下沉 **`core/abortReason.ts`**（`error/abortReason.ts` 转为转出） | 1 | **−1** | ✅ 已执行 |
| 2 | `core/utils/ErrorHandler.ts:8` | `toError` / `isAbortError` / `errorMessage` | 已下沉 **`core/errors.ts`**（`error/utils.ts` 转为转出） | 1 | **−1** | ✅ 已执行 |
| 3 | `modules/ImportManager.ts:7`、`ModuleDefinitions.ts:7`、`ModuleInitializer.ts:7`、`ModuleRegistry.ts:7` | `ErrorCodes` | 已下沉 **`core/errorCodes.ts`**（`error/ErrorCodes.ts` + `error/index.ts:38` 转出改向） | 4 | **0**（见上"更正"；须与 `AppError` 家族同批） | 🟡 部分 |
| 4 | `core/Coordinator.ts:7` | `lazySingleton` | 已下沉 **`core/lazySingleton.ts`**（`utils/common.ts` 转为转出） | 1 | **−1** | ✅ 已执行 |

**⚠️ 落点更正（R03-002 实测）**：上述新文件**不能**放在 `core/utils/**` —— 会触发 **R03-002「模块出口单一」**违规（`@modules/core/utils/x` 与相对 3 段路径两种写法都判），实测使门禁**警告 1→2**。故定义放在 **core 模块根**（与既有 `core/paths.ts` 同级），跨模块消费方按**相对 2 段路径**引用（仓内先例：`analytics → ../core/events/EventBus`）。**未放宽门禁、未加白名单**。



| # | 源文件:行 | 符号 | 定义位置 | core 消费方 | 预计改动文件 | 消除对 |
|:--:|---|---|---|:--:|:--:|---|
| 1 | `core/exit/ExitRecorder.ts:36` | `isAbortReason`（+ `SYSTEM_ABORT_REASON` / `markAsExpectedAbort`） | `error/abortReason.ts:78`（零 import） | 1 | 3 | `ExitRecorder→error` **−1** |
| 2 | `core/utils/ErrorHandler.ts:8` | `toError` / `isAbortError` / `errorMessage` | `error/utils.ts:584/:593/:575`（仅 import `./types`） | 1 | 3 | `ErrorHandler→error` **−1** |
| 3 | `modules/ImportManager.ts:7`、`ModuleDefinitions.ts:7`、`ModuleInitializer.ts:7`、`ModuleRegistry.ts:7` | `ErrorCodes` | `error/ErrorCodes.ts:28`（**纯数据表、零 import**） | 4 | 6 | **−4**（性价比最高） |
| 4 | `core/Coordinator.ts:7` | `lazySingleton` | `utils/common.ts:171`（纯 HOF） | 1 | 2 | `Coordinator→utils` **−1** |

- **紧随第 2 批（高杠杆，但不属"最小"）**：`AppError` / `ErrorCategory` / `ErrorSeverity`（定义 `error/types.ts:57/:29/:47`，**零内部依赖**）⇒ 可**一次消除 22 对**，但 **core 层消费方 30 文件**（`core` 17 + `modules` 12 + `mcp` 1）⇒ 改动面大。
- **明确不建议进首批（附理由）**：
  · `ToolExecutionStatus` / `createToolResult`（tools，5 语句）—— 所在对与 **G1 的工具契约**（`Tool`/`ToolParam`/`ToolResult`/`ToolUseContext`）**同对** ⇒ 单独搬**不减计数**，须与"工具契约下沉"同批；
  · `estimateTokens` / `estimateMessagesTokens*` / `extractUsage`（ai，3 语句）—— `TokenBudgetController→ai` 可单独消除，但 `UnifiedTokenTracker→ai` 同对含 **H3** 项 ⇒ 须一并处理；
  · `calculateCost` / `calculateTotalCost`（cost，2 语句）—— 同对含 **G1** 类型 `ModelPricing` ⇒ 须与 G1 同批。

#### 3.5.2 H5 的两条架构裁定（2026-09-30 更新：①已裁定 / ②待补证）

**① `OrchestrationEventType` 单源落点 —— ✅ 裁定：落 `core`（`app/src/types/`），❌ 不并入 `shared/`**

**决定性证据（实测）**：
- `shared` **不在** `scripts/modules-to-layers.json`（0 命中）；
- 门禁扫描根 = `resolve(projectDir, 'app', 'src')`（[`lint-architecture.ts:3793`](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L3793)）⇒ **`shared/` 完全在门禁视野之外**。
- ⇒ 若把事件名并入 `shared/`，则"core → `@shared/*`"这条依赖**对门禁完全不可见** ⇒ 这不是**消除**依赖，而是**把依赖藏起来**（与 §四 那句"否则门禁本身会变成第二份事实源"**同族风险**）。
- ⇒ 故定论：**落 `core`**（`app/src/types/` 已归 core，见 D-51/D-59）；`core/events/*` 从该处取类型，门禁可见、方向合法。
- 规模：`OrchestrationEventType` 全仓引用 **110 处**，定义在 `app/src/agent/events/OrchestrationEvents.ts:13`（`as const` 对象 + `:120` 派生值联合）⇒ 属**中等**改动（定义下沉 + 上层转出 + core 侧 3 个消费方改直连），**可作 G2/H5 的下一批**。

**✅ 已落地（2026-09-30，台账 D-68）**：
- **新建** [`app/src/types/orchestrationEvents.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/types/orchestrationEvents.ts)：`OrchestrationEventType`（`as const`，44 个成员）+ `OrchestrationEventTypeValue`；**零 import**（纯字面量）。
- [`agent/events/OrchestrationEvents.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/agent/events/OrchestrationEvents.ts) 改为**转出**（对外导出名与成员逐字不变）；**载荷接口与 `deriveParallelEndData` 留在原处**（app 层领域载荷，core 侧不需要 ⇒ 沿用 D-57「只下沉名字、不下沉载荷」口径）。
- **3 个 core 消费方改直连** `@modules/types/orchestrationEvents`：`core/events/EventBusOTelBridge.ts` · `core/events/OrchestrationMetrics.ts` · `core/events/TokenTracker.ts`（三者对该目标模块**各仅此 1 条语句** ⇒ 逐对清零）。
- **实测**：`已豁免` **420 → 417**（净 **−3**，与消除对数逐数吻合）· `违规 0` · `错误 0 / 警告 1`（仅既有 REF）· `app` typecheck **0**。`BULK-012`(`core -> app`) 计数 **4 → 1**。

**🔴 连带自省（重要，关于已完成的 D-57）**：`shared/` 既然**在门禁视野之外**，那么 **D-57 把"对话事件名"单源放到 `shared/events/eventNames.ts`，同样使"app → @shared"这条依赖对门禁不可见**。
- **不变更 D-57 的理由**：`shared/` 是**既有先例**（`chat-status-type-contract.md` 同类下沉，别名/构建/Docker 均已就绪），且事件名是**跨端契约**而非分层内依赖；D-53/D-57 的**奇偶门禁**已从**内容**上强制两端一致（补上了"门禁看不见"的一部分）。
- **但风险必须登记（建议后续处理）**：把 `shared` **登记进 `modules-to-layers.json`**（并让门禁扫描它），或至少在门禁里对 `@shared/*` 的引用点**显式上报**（warning 级）⇒ 否则"跨端契约"会长期处于**分层盲区**，未来新依赖同样不会被发现。**本轮未做**（属门禁视野扩展，需另立议题）。

**② `MCP_PROTOCOL_VERSION` / `MCPServerStatus` —— ✅ 已裁定并落地「A+ 收口」（2026-09-30，台账 D-67）**

**已补全的计数（实测，`app/src` 全量静态 `from '…'`）**：

| 方向 | 计数 | 落点 |
|---|:--:|---|
| `core → mcp` | **0** | — |
| `infra → mcp` | **1** | [`system/state/AppState.ts:8-11`](file:///e:/PY/Documents/CODES/PY_APP/app/src/system/state/AppState.ts#L8-L11)（**仅类型**：`MCPServerConnectionInfo`、`ServerResource`，来自 `@modules/mcp/types/index.js`） |
| `modules → mcp` | **0** | 门禁口径 0；⚠️ 但 [`modules/LazyModuleStrategy.ts:345`](file:///e:/PY/Documents/CODES/PY_APP/app/src/modules/LazyModuleStrategy.ts#L345) 的 `DYNAMIC_IMPORT_PATHS.mcp = '../mcp/index.js'` 是**运行时动态导入**（裸字符串），门禁正则 `/from\s+['"]/` **不匹配** ⇒ 语义上 `modules → mcp` = 1，属**门禁盲区** |
| （参考）`entry → mcp` | 1 | [`entrypoints/cli.tsx:31`](file:///e:/PY/Documents/CODES/PY_APP/app/src/entrypoints/cli.tsx#L31) |
| （参考）`service → mcp` | 1 | [`infrastructure/http/handlers/mcp-oauth-handler.ts:14`](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/mcp-oauth-handler.ts#L14) |

**🔴 对级口径更正（推翻此前的"指向方案 B"倾向）**：

- 此前只盯 `mcp/types/MCPTypes.ts:28` **1 条语句**。按 **(源文件 × 目标模块) 对** 口径重核 ⇒ 该文件对 `services` **共有 3 条语句**（`:6-23` `import type` 17 个别名 · `:25-28` `export { MCP_PROTOCOL_VERSION, MCPServerStatus }` · `:48-51` `export type { ConfigScope, MCPServerType }`），另有 `mcp/types/index.ts:31` 同指向 `services`。
- ⇒ **方案 B（只搬两符号）清不了任何一对**（同对残留 ⇒ 计数不变 —— 与 D-62 同一教训，**再次踩中**）。
- ⇒ 若走 B，**必须把 `services/mcp/types/index.ts` 的整个导出面下沉 core**，才可能清 `mcp/types/*` 这 2 对；且**不触动** `mcp → services` 的**运行时**语句（`MCPTool.ts:9`、`managers/MCPManager.ts:7-8`、`index.ts` 多条、`utils/mcpConfig.ts:10`、`cli/mcpCommand.ts:8`，共 5 对）。

**方案 A 的全量收支（此前只算 1 对，漏算 mcp 侧全局）**：

`mcp/` 作为 core 层源模块，倒挂对共 **19 对**（`services` 7 · `monitoring` 4 · `config` 2 · `error` 1 · `tools` 1 · `tool` 1 · `entrypoints` 2 · 另 `core` 2 对合法不计）。若 `mcp` 改归 **service**：

| 对方向（对级） | 现状(core) | 改后(service) | 判定 |
|---|---|---|---|
| → `services`7 · `monitoring`4 · `config`2 · `error`1 | ✗ | service→{service,infra} | ✅ **消除 14 对** |
| → `tools`1 · `tool`1（app） | ✗ | service→app | ❌ 仍违规（换桶，真实倒挂需另治） |
| → `entrypoints`2（entry） | ✗ | service→entry | ❌ 仍违规，**且 `BULK-017`(core→entry) 不覆盖 `service→entry`** ⇒ 会**浮出 2 条新违规** |
| `infra → mcp`（新增 1） | — | infra→service | 🟡 落入既有 `BULK-008`(infra→service) 桶，**计数 +1** |

⇒ **净消除 14 对**（若只算"可被既有例外吸收"的口径，则为 −14 +2 浮出，需为 `service→entry` 补例外或先治该 2 对）。**与旧判断"方案 A 不能净收益"相反**，但代价不在计数、而在 **`service→entry` 无例外覆盖**。
⇒ 且 `infra → mcp` 那 1 对（`AppState.ts`）**只引用 2 个类型** ⇒ 把 `MCPServerConnectionInfo`/`ServerResource` 下沉 core 即可连它一并消除，并与 §1.11「增强层引用标准层」语义**正面一致**（两层同在 service）。

**⇒ 裁定：A+（`mcp` 改归 service + 前置收口）—— 已落地，实测净消除 15 对**

| 步骤 | 动作 | 结果 |
|:--:|---|---|
| ① 前置 | 删除 `mcp/index.ts` 的**死 barrel 再导出** `export { startMCPServer } from '../entrypoints/mcp.js'`（全仓无 `@modules/mcp` 消费者，`main.ts`/`cli.tsx` 均直连源文件） | 消 `mcp→entrypoints` **1 对** |
| ② 前置 | `mcp/server/entrypoint.ts` **迁出**至 [`entrypoints/mcpServer.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/entrypoints/mcpServer.ts)（本质是进程入口脚本，消费 entry 层能力，归 entry 层才是其真实语义；能力等价于已登记的 `--mcp` 模式） | 消 `mcp→entrypoints` **1 对** |
| ③ 分层 | [`modules-to-layers.json`](file:///e:/PY/Documents/CODES/PY_APP/scripts/modules-to-layers.json) 中 `mcp` 由 `core` 改归 **`service`**（对齐 §1.11「增强层引用标准层」语义） | 消 `mcp→services/monitoring/config/error` **14 对** |
| ④ 例外 | 同步 `layer-exceptions.json`：`BULK-010` 27→20 · `BULK-011` 9→2 · `BULK-012` 6→4 · `BULK-005` 20→22 · `BULK-008` 50→51 | — |

**实测（`bun run lint:arch`）**：`已豁免` **435 → 420**（净 **−15**）· `违规` **0** · `错误 0 / 警告 1`（仅既有 `REF`）· `app` typecheck **0**。与预测式 `435 −14 −2 +1 = 420` **逐项吻合**。

**⚠️ 未采纳的子步（原始 A+ 描述含「下沉 `MCPServerConnectionInfo`/`ServerResource` 至 core」）—— 实测代价过大，改由既有例外吸收**：
- `ServerResource = Resource & { server: string }` 自包含（仅依赖 MCP SDK），可下沉；
- 但 `MCPServerConnectionInfo`（`services/mcp/types/index.ts:221`）**依赖 `McpServerConfig`（6 个 zod schema 的 union）/`MCPServerConfig`/`MCPServerStatus`/`MCPToolDefinition`** ⇒ 单独下沉它等于把**整个标准层 types 文件**（470+ 行）搬进 core。而 `AppState.ts` 的这 2 个符号在**同一条 import 语句**内，**只搬一个不清零该对**（D-61/D-62 同一口径）。
- ⇒ 故 **+1**（`infra → mcp`，`AppState.ts`）由既有 `BULK-008`(`infra -> service`) 吸收（50→51），**未新增未豁免违规**、未搬动 `types` 中心（该中心另有「收缩」专项）。

**🔴 过程中发现的预存倒挂（已登记，非本次引入）**：删除 `BULK-017` 做"零命中"验证时，浮出 `core/StartupPrefetcher.ts → bootstrap`（`core → entry`，真实倒挂）⇒ 证明该例外**并非冗余**（原 `estimatedCount: 1` 恰指这对；我此前只 grep 了 `entrypoints/` 路径、**漏了 `bootstrap` 模块**，证据不全）。已恢复 `BULK-017` 并**记正**其唯一命中项；该对属 A 类盘点 `core -> entry` 项，另行治理。

**⇒ 备选（本轮未采纳，留档）**：**B** 仅下沉 `services/mcp/types` 导出面（收益 2 对、零新增、改动小，但不动运行时语句）。



（原"两条待裁定"清单已由上方 2026-09-30 版取代：①裁定落 `core`；②裁定 A+ 并已落地。保留此行为沿革。）



#### 3.5.3 A1 已执行（2026-09-30，台账 D-74）

**范围**：§3.5.1 末条「`calculateCost` / `calculateTotalCost`（cost，2 语句）—— 同对含 **G1** 类型 `ModelPricing` ⇒ 须与 G1 同批」**已按该口径整批执行**（未拆批、未留下"只搬一半"的空转）。

- **手法**：新建 **core 模块根**零依赖文件 [`app/src/core/pricing.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/pricing.ts)，承载 `ModelPricing` / `BillingMode` / `CostBreakdown` + `calculateCost` / `calculateTotalCost` / `roundCost` / `safeTokens` / `safePerTokenRate`；上层原文件**同名转出**（`cost/calculateCost.ts` 变纯壳 · `cost/pricingSafety.ts` 部分转出 · `cost/ModelPricing.ts` 类型转出 · `ai/models/ModelPricingService.ts` 的 `BillingMode` 转出）；core 侧 2 个消费方改直连 `../pricing.js`。
- **实测**：`已豁免` **280 → 278（净 −2，与消除对数逐数吻合）** · `R03-002` **0 处** · `违规 0` · `错误 0 / 警告 1`（仅既有）· `app` typecheck **0**；`BULK-010` `estimatedCount` **10 → 8**；用例总数 4272 / 447 文件与基线一致（未增删用例）。

**两条可复用经验（后续批次直接沿用）**：

1. **下沉对象若含"引用上游层的字段类型"，该类型必须同批搬**：`ModelPricing.billingMode: BillingMode`，而 `BillingMode` 定义在 **app 层**（`ai/models/ModelPricingService.ts`）⇒ 只搬 `ModelPricing` 会让 core **新造 core → app 倒挂**（换桶式"假消除"）。判定式：**搬完先问"新位置还引用谁"**。
2. **R03-002 的精确判据（源码级复核，`lint-architecture.ts#checkModuleSingleExport`）**：`@modules/<mod>/<sub>` 与相对路径两条分支**都会判**；豁免仅三种 —— ①子路径含 `types` 段；②`canonicalEntryKeys` 白名单（`core/paths` / `core/events` / `core/tokenBudget` 等）；③相对路径解析后 **`parts.length < 3`**（即**指向模块根文件**）。⇒ **新定义放模块根 + 跨模块用相对 2 段路径**是安全解；写成 `@modules/core/pricing` **必判违规**。

#### 3.5.4 A2 已执行（2026-09-30，台账 D-75）

**范围**：`core/tokenBudget/ModelContextCache.ts` · `core/utils/Performance.ts` → `utils`（`TTLCache`），**2 对**。

- **手法：复用而非下沉**。core 侧**已有**同能力 SPI [`core/spi/CacheService.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/core/spi/CacheService.ts) 的 `TtlCache`（自述"core 层用的轻量 TTL 缓存实现，不依赖 infra/utils 层"）⇒ 按 **CS01 归一化**让两消费方改用 core 自身实现（**不**把 infra 的 `TTLCache` 再搬一份进 core，否则 core 内会有两份 TTL 缓存）。
- **API 比对结论**：`ctor` / `set` / `get` / `has` / `delete` / `clear` / `size` **逐一同签名同语义**；**唯一差异 = 容量淘汰 LRU → FIFO**，而两处 `maxSize`（10000 模型条目 / 100MB 且按**条目数**计）真实规模下不触达 ⇒ **不可观测**；`TTLCache` 独有的 `cleanup()` / `getStats()` **两处均无调用点**。
- **实测**：`已豁免` **278 → 276（净 −2，逐数吻合）** · `R03-002` **0 处** · `违规 0` · `错误 0 / 警告 1`；`BULK-010` `estimatedCount` **8 → 6**；`app` typecheck **0**。

**🔴 对 §3.5.3 经验 ② 的修订（重要）**：R03-002 的两条分支（`@modules/<mod>/<sub>` 与相对路径）**都**会检查，但**都先过 `targetModule === importerModule ⇒ continue`**（`lint-architecture.ts:2135` / `:2179`）⇒ **同模块内引用（含 `core/utils/** → core/spi/**`）天然豁免**。D-73 曾预判 A2"core 内引用 `core/spi/**` 会触 R03-002、需加模块根门面"——**本次实测推翻**（`R03-002 0 处`），无需门面。R03-002 只惩罚**跨模块**对子目录的直连（D-61 那次触发，是因为消费方在**别的模块**）。

#### 3.5.5 A3 已执行（2026-09-30，台账 D-76）

**范围**：core 层 → `performance`，**3 对**（D-73 原记 1 对，修正见下）：`core/StartupPrefetcher.ts` · `modules/ModuleInitializer.ts:27` · `modules/LazyModuleStrategy.ts:19`。

- **手法：G3（端口/DI）**，沿用 D-69/D-70 的三层结构：**core SPI 端口**（新建 `core/spi/ProfilerService.ts`：`IStartupProfilerPort` + `resolveStartupProfiler()` noop 降级 + `registerStartupProfilerSpi()` 组合根动态导入）→ **core 门面**（新建 `core/profilerFacade.ts`，同名导出 ⇒ 消费方**只改 import 路径**）→ **组合根注册**（`core/di/DIContainer.ts`，紧随 OTel SPI 之后，非致命 catch + warn）。
- **为什么不可下沉**：`performance/StartupProfiler.ts` 持有**模块级状态**（`memorySnapshots` / `phaseTimes` / `DETAILED_PROFILING` 缓存）⇒ 下沉会**分裂状态**，只能经 SPI 暴露（同 `tracingFacade.ts` 头注的就里）。
- **实测**：`已豁免` **276 → 273（净 −3，与修正后对数逐数吻合）** · `R03-002` **0 处** · `违规 0` · `错误 0 / 警告 1`；`BULK-010` `estimatedCount` **6 → 3**；`app` typecheck **0**。

**🔴 修正 D-73 的 A3 栏（"批次取数"层面的通用教训）**：

1. **对数 1 → 3**：根因是**只按 `@modules/performance` 别名 grep，漏了相对路径写法** `from '../performance/StartupProfiler'`；而 `parseModuleImports` 的**相对路径分支**（`lint-architecture.ts:2460-2471`）**同样计入 R00-001**。⇒ **教训：统计某目标模块的消费方时，`@modules/x` 别名与相对路径两条写法都必须扫**（与 §1.5 通道 B 的"两条正则"同源）。
2. **表述错**：D-73 写"同族项已在 Phase 1 换成门面"**不成立**，二者本次才改。
3. **修正后账目自洽**：`余 10 = A 组 10 对`（A1 2 + A2 2 + A3 3 + A4 2 + A5 1），与 D-71 已记"`error` 本已为 0"吻合 ⇒ **无未列项**。

**🆕 顺带发现（预存，非本次引入；已登记台账）**：`core/StartupPrefetcher.ts` 的全部导出**零消费者**（`entrypoints/init.ts` 内的同名函数是独立本地定义）⇒ 疑为死模块，本次未删。

#### 3.5.6 A4 + A5 已执行 —— **A 类 `core -> infra` 桶清零**（2026-09-30，台账 D-77）

**范围**：A4 `core/migration/StateMigrator.ts` · `core/notifications/NotificationService.ts` → `state`（2 对）；A5 `core/index.ts` → `system`（1 对）。

- **A4 的解法修正**：D-73 预设"先判类型 vs 实例"（倾向建 SPI 端口）。实测两者确为**运行时实例/函数**，但**全仓含测试零消费**（且 `NotificationService` 的 `appStateStore as unknown as NotificationStore` 强转**运行期必抛错**）⇒ 改按 **D-59/D-70「零消费 ⇒ 删除」**先例，直接删除两个文件即清零，**无需端口**（比建端口更小且更正确）。
- **A5**：移除 `core/index.ts` 的 `system/state` 整包再导出与 `AuthManager`/`AuthConfig` 类型再导出（同对语句一次搬净）。
- **实测**：`已豁免` **273 → 270（净 −3，逐数吻合）** · `R03-002` **0 处** · `违规 0` · `错误 0 / 警告 1`；扫描文件数 3968 → 3966；`app` typecheck **0**（同时作为"零消费"的权威判据）；**探针实测本桶余量 = 0 对** ⇒ **`core -> infra` 已清零**。

**🔴🔴 必须写入规范的门禁陷阱（本次我亲自踩中，靠探针才定位）**：

**`parseModuleImports` 的两条正则都不剥离注释**（`lint-architecture.ts:2449-2474`） ⇒ **在注释里照抄一条 import/export 语句的完整片段，会让该依赖在门禁眼里「复活」**。本次实证：A5 的三处代码移除**全部落地**后，门禁仍报 `core/index.ts → system` **1 条**（读数 −2 而非 −3），原因仅仅是**说明注释里写了** `export * from '<包名>'` 的形式；改写为只写包名后立即降到位。

⇒ **两条通用纪律**：
1. **注释引用导入语句时，禁止写出 `from '包名'` 的完整片段**（只写包名本身；已在 `core/index.ts` 就地立下该约定）；
2. **门禁读数与"改了哪些代码"不一致时，优先怀疑"注释被当成依赖"，并用探针（临时置例外过期 ⇒ 打印真实违规）定位到 file → target 级**，不要靠理论推演（本轮理论推演一度把方向带偏到 `resolveModuleName`）。

**✅ 已裁定并执行（用户批准）**：`BULK-010` 例外条目**已从 `layer-exceptions.json` 删除**（空配置清理）。删除后门禁**单独复跑**：**违规 0 / 已豁免 270 / 错误 0 / 警告 1**，与删除前**逐数一致** ⇒ **反证该条目贡献为 0**，与"探针实测本桶余量 = 0"互为印证。

**剩余**：仅 **B 组**（动态跨层引用 ≈25 处，门禁不可见），须先出 spec 并由用户裁定"扩展门禁 vs 仅 warning 上报"。

## §3.6 B 组治理：动态跨层引用的**可见化**（2026-09-30 裁定，用户批准「仅 warning 级上报」）

### 3.6.1 背景（门禁盲区，A 类盘点时发现）

`parseModuleImports`（[`lint-architecture.ts:2449`](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2449)）**只匹配 `from '…'` 形式** ⇒ **动态 `import('…')` 完全不参与 R00-001（分层）与 R03-002（出口单一）**。core 层由此可以**把依赖藏起来**：盘点到的动态跨层引用集中在 `core/AppCoreOTelHelper.ts`（10 处）、`core/boot/BootPipelineIntegrator.ts`（14 处）、`core/loop/PlanDrivenLoop.ts`（1 处）、`modules/**`（13 处）。

> ⚠️ **账目更正**：`台账 D-73` 曾记 B 组"≈25 处"，与其自身分项（10+14+1+13 = **38**）不符 ⇒ 以本 spec **实测**为准（见 §3.6.4 回填）。

### 3.6.2 裁定（用户批准，2026-09-30）

采用 **「仅 warning 级上报」**，具体语义：

1. **扩展扫描**：门禁同时匹配**动态导入** `import('…')`（`@modules/<mod>` 别名与**相对路径**两种写法，与既有两条正则同口径）；
2. **不改判定**：这些引用**不计入** R00-001 的 `违规` / `已豁免` 计数 ⇒ 既有读数 `违规 0` / `已豁免 270` **不受影响**；
3. **不建白名单**：**不**区分"有意的装配懒加载"（`AppCoreOTelHelper` / `BootPipelineIntegrator`）—— 一律作为**可见事实**登记；理由是避免逼出"为过门禁而把懒加载改成静态"的劣化；
4. 新增**独立规则 `R00-003`**，`severity: 'warning'`、**不阻断提交**，形态**对齐既有 `R00-002`**（单条聚合）；**输出形态（2026-09-30 用户选定）**：按 **（源模块 → 目标模块）聚合**逐行列出（每组附**示例文件**与次数、按次数降序），**不截断** —— 实测 **55 行**（vs 逐文件明细 95 行），兼顾"完整覆盖"与"不刷屏"。

### 3.6.3 范围与非目标

- **范围内**：动态 `import('…')` 造成的**跨层倒挂**（目标模块层 ∉ `allowedDependencies[源层]`）。
- **非目标（明确不做）**：① 不把动态引用改判为违规；② 不建 composition-root 白名单；③ **不处理 `require('…')`**（同族盲区，见 §3.6.5）。

### 3.6.4 验收

- `lint:arch` **退出码仍 0**（warning 不阻断）；`违规 0` · `已豁免 270` **保持不变**；`警告` 由 **1（仅预存 R07-004）→ 2**（+`R00-003`）。
- `R00-003` 输出**全量清单**（文件 → 目标模块），盲区一次可读。
- `app` typecheck **0**；全量 `bun test` 与基线一致（4272 用例 / 447 文件；得分组不变）。
- **实测（2026-09-30 实施后复跑，回填）**：动态跨层引用 **95 处**；`违规 0` / `已豁免 270` **未变**；`错误 0 / 警告 1 → 2`（新增即 `R00-003`）；**退出码 0**。详见 §3.6.6。

### 3.6.5 同族盲区（本次按裁定**不处理**，登记备查）

`require('…')` 形式的运行时取用（如 `performance/StartupProfiler.ts:33/45` 的 `require('@modules/config')`、`ai/local/llama/LlamaCppServerManager.ts:359/721`、`workspaces/WorkspaceRegistry.ts:49`、`ai/transports/OllamaTransport.ts:55`）**同样不被门禁匹配**。留待下一轮评估。

### 3.6.6 实测结果（2026-09-30，实施后复跑）

| 指标 | 值 |
|---|---|
| 动态跨层引用（**对**口径 = 文件 × 目标模块，同 R00-001） | **95 处** |
| `R00-001` 读数 | **违规 0 / 已豁免 270**（**未变** ⇒ 判定未被扰动 ✓ 符合裁定） |
| 门禁汇总 | `错误 0 / 警告 1 → 2`（新增即 `R00-003`） |
| 退出码 | **0**（warning 不阻断提交） |
| 汇总行 | `… \| 违规 0 \| 已豁免 270 \| 动态跨层引用 95 处（R00-003，仅上报）` |

**按源模块聚合（top）**：`infrastructure/http/handlers` **36** · `core/boot` **11** · `core/extensibility` **6** · `modules` 4 · `diagnostics` 3 · `core/spi` 3 · `core` 3 · `core/performance` 2 · `runtime/api` 2（其余各 1–2）。

**按目标模块聚合（top）**：`ai` 13 · `tasks` 9 · `knowledge` 8 · `plugins` 6 · `services` 6 · `infrastructure` 5 · `tools` 5 · `monitoring` 4 · `performance` 3 · `runtime` 3 · `skills` 3。

**最集中的簇（= `R00-003` 聚合输出的 top，`源层 → 目标层` 口径）**：`infrastructure (service) → tasks (app)` **8** · `→ ai (app)` **7** · `→ knowledge (app)` **6** · `core (core) → monitoring (infra)` **4** · `infrastructure → tools (app)` **4** · `modules (core) → services (service)` **4** · `chronos (infra) → ai (app)` 3 · `core → performance (infra)` 3 · `infrastructure → plugins (app)` 3 · `state (infra) → infrastructure (service)` 3。
⇒ **`infrastructure/http/handlers` 的 `service → app` 一家占 36 对（≈38%）**，是单点最大簇；**55 个组合**的完整清单由 `R00-003` 每次门禁输出（收口清单另见台账 D-79）。

**🔴 三条必须记住的判读**：

1. **口径**：计数单元是 **(文件 × 目标模块) 对**（`parseDynamicImports` 返回 `Set`），**不是语句数** ⇒ 同一文件对同一目标模块的多次 `import()` 只算 **1 处**。此坑与 D-61/D-62 的"对 vs 语句"**同型，已第三次出现**（本次 D-73 的 B 组"≈25 处"即按语句估的 core 侧子集）。
2. **`core/spi/*Service.ts` 的 3 处是"有意为之"**：`LoggerService` / `OTelService` / `ProfilerService` 的 `registerXxxSpi()` 内动态导入上层实现，**正是 SPI 消除静态倒挂的机制本体**（三文件头注均有说明）⇒ **这正是本轮选 warning 而非违规的关键理由**；若改判为违规，会**惩罚正确的架构手法**。
3. **规模远超原估**：实测 **全仓 95 对**（含 `infrastructure/http/handlers` **36 对 service → app**、`diagnostics` / `state` / `memory` 等）⇒ 盲区与 A 类（120 对）**同量级，且跨全部层**，不再是"core 层的小尾巴"。

> **未做（按裁定）**：不改判为违规、不建 composition-root 白名单、不处理 `require('…')`。上述 95 对**尚无收口计划**，本条作为后续立项依据。

### 3.6.7 C5 与 C2 非设计项的**取证判定**（2026-09-30，台账 D-80）

覆盖 **24 对**（C5 全部 2 对 + C2 非设计项 22 对）。**结论：绝大多数并非"藏起来的真倒挂"，而是 ①装配本体错层 ②死模块 ③模块归类错。**

| 判定类别 | 对数 | 项 |
|---|:--:|---|
| **死模块**（✅ **已删，D-81**） | **3** | `core/performance/StartupPreloader`（2；全 `app` 仅自身定义、`initializeAndStartPreloading()` 无调用方）· `core/StartupPrefetcher`（1；D-76 已证）—— 已删除 ⇒ `已豁免` 270 → **269**、`R00-003` 95 → **92**，且 `BULK-017` 唯一命中项随之消失、条目退役 |
| **装配本体错层**（宜迁 entry，D-67 先例） | **13** | `core/AppCoreOTelHelper`（2；唯一调用方 `main.ts:1690`）· `core/boot/BootPipelineIntegrator`（11；**唯一消费方是 `app/scripts/benchmark-startup.ts:47`**，生产启动路径未引用） |
| **疑似退役遗留**（✅ **已判定并删除，D-83**） | **6** | `core/extensibility/ExtensibilityService` —— 判定：`init()` 自 **2026-08-06** 起**无任何调用方**（止血开关 `USE_LEGACY_EXTENSIBILITY` 无启用路径）⇒ 6 处动态引用运行期不可达 ⇒ **删本体**（`R00-003` 79 → 73）；同目录 `PluginLoader`/`ModuleManager`/`ConfigManager`/`EventBus` **保留**（仍被 `tools/EnhancedToolSystem.ts` 使用） |
| **模块归类错** | **1** | C5-2 `commands/builtin/hooks/Hooks → hooks` |
| **装配缝（保留）** | **1** | C5-1 `bridge/ModuleBridgeSetup → tasks`（已包成窄接口 `ModuleBridgeDependencies` 注入） |
| （另）`core/spi/{Logger,OTel,Profiler}Service` | 3 | **设计即如此**（D-78 已判，保留） |

**🔴 高杠杆发现 → ✅ 已实测并执行（2026-09-30，台账 D-84）**：`hooks` 被归 `ui`，但其主体是**运行时钩子链**（`core/ executors/ managers/ types/ utils/ postSampling/ cli/`），仅顶层 `use*.ts` 与 `notifs/use*.ts` 是真 React hooks。

**实测精确份额**：`app → hooks` **9 对** · `infra → hooks` **2 对** —— **不是**此前估的"≈40 对"（40 是两桶**总量**，`hooks` 只占其一角）⇒ **教训：桶的 `estimatedCount` 不能当作单项收益的依据，必须逐文件枚举**。

**处置**：`hooks` **零 ui 依赖**，且 `infra -> app` 已有桶（`BULK-007`）承接换桶 ⇒ **改归 `app`**：`已豁免` **269 → 260（−9）** · `R00-003` **73 → 72** · **违规 0**（自验证）。**混合体物理拆分**（React hooks 与运行时钩子链分离）记入后续项 —— 仅提升**归层精度**，**不加对数**。

**处置建议（顺序）**：① ~~删两个死模块（**−3 对**，零风险）~~ **✅ 已执行（2026-09-30，台账 D-81）** —— `已豁免` **270 → 269** · `R00-003` **95 → 92** · typecheck **0** · 门禁 **exit 0**；`BULK-017`（`core -> entry`）唯一命中项随之消失，**条目已退役**。→ ② ~~`AppCoreOTelHelper` + `BootPipelineIntegrator` **归属搬迁至 entry**（**13 对**）~~ **✅ 已执行（2026-09-30，台账 D-82）** —— `R00-003` **92 → 79（−13）** · 组合 55 → 44 · `已豁免` **269 不变** · `R03-002` **0 处** · typecheck **0** · 门禁 **exit 0**。**前置判定（实测）**：`main.ts` **零引用**该管道（**尚未接线**，唯一消费方是基准脚本 `app/scripts/benchmark-startup.ts`）⇒ 取**搬迁**（零行为变化），"接线 / 删"另立决策。搬到 `bootstrap/pipeline/**` + `bootstrap/AppCoreOTelHelper.ts`（**整目录搬迁必需**，否则跨模块 `core/boot/**` 引用会触发 R03-002）。→ ③ ~~判 `ExtensibilityService` 去留（6 对）~~ **✅ 已判定并执行（2026-09-30，台账 D-83）** —— 其 `init()` 自 **2026-08-06** 起无调用方（止血开关无启用路径）⇒ **删除本体，6 对全消**（`R00-003` **79 → 73**）；同目录 `PluginLoader`/`ModuleManager`/`ConfigManager`/`EventBus` **保留**（`tools/EnhancedToolSystem.ts` 仍在使用）→ ④ ~~`hooks` 归类专项~~ **✅ 已执行（2026-09-30，台账 D-84）** —— `hooks` 由 `ui` 改归 **`app`**（**零代码改动**，仅门禁配置 4 处）：`已豁免` **269 → 260（−9）** · `R00-003` **73 → 72** · **违规 0**（`infra → hooks` 2 对换桶并入 `BULK-007`）；`hooks` **混合体物理拆分**记入后续项。⇒ **①②③④ 全部完成**。

## §3.7 C1 治理：`infrastructure/http/handlers` 的 `service → app` 懒加载（2026-09-30 判定，**待裁定口径**）

### 3.7.1 现状（实测）

- **规模**：`infrastructure (service) → app` = **40 对 / 36 文件**。
  ⚠️ **口径更正**：D-79/D-80 记的"36 对"实为**文件数**；门禁统计单元是 **(文件 × 目标模块) 对** = **40**（有文件引用多个目标模块，如 `analytics-handlers` → `query`+`ai`、`project-artifact-handlers` → `workspace`+`project`）。**这是"对 vs 文件/语句"混淆的第 4 次**（前三次：D-61/D-62、D-73 的 A3、D-73 的 B 组）。
- **目标分布（实测）**：`tasks` **8** · `ai` **7** · `knowledge` **6** · `tools` **4** · `plugins` **3** · `dream` **2** · `query` / `buddy` / `commands` / `docs` / `chat` / `workspace` / `project` / `context` / `skills` / `workspaces` 各 **1**。
- **形态**：**全部是端点内的按需 `await import()`**（无一处位于模块顶层）。

### 3.7.2 判定：**设计使然（per-endpoint on-demand），不是"把依赖藏起来"**

| 证据 | 内容 |
|---|---|
| 路由层是**静态**的 | [`route-table.ts`](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/route-table.ts#L9-L28) 顶层静态导入 18 个 `dispatchXxxRoutes` ⇒ "路由注册"本身不懒加载 |
| 懒加载点在**端点内部** | [`agent1-handlers.ts:35-38`](file:///e:/PY/Documents/CODES/PY_APP/app/src/infrastructure/http/handlers/agent1-handlers.ts#L34-L39)（`handleListAgentTasks` 内才 `new SqliteTaskStore(); await store.init();`）· `analytics-handlers.ts:322/339/353` · `buddy-handlers.ts:167-169`（`Promise.all([...import()])`）等 ⇒ **只加载该端点需要的领域模块** |
| 同层**既有同构模式** | [`LocalHTTPServiceHelpers.ts`] 的 `CHANNEL_TABLE`（26 通道：`importPath` 字符串表 + `await import(entry.importPath)`）—— 那是 **service→service（合法）的有意懒加载**；handlers 只是把同一手法用在了**跨层**目标上 |
| 动机可证 | 静态化会把 36 个领域模块拉进 **HTTP 服务启动面**（启动成本 + 循环依赖/TDZ 风险）⇒ 与仓内"重模块 ON_DEMAND、避免启动期解析"的既定策略一致（见 `LazyModuleStrategy`） |

⇒ **结论：懒加载应保留，问题只在"方向"** —— service 层不应直接依赖 app 层的领域实现。

### 3.7.3 四个口径（**待裁定**）

| 口径 | 做法 | 收益 | 代价 / 风险 |
|---|---|---|---|
| **A 全量静态化** | 36 处改顶层 import | R00-003 −40 | ❌ **明确不建议**：把 36 个领域模块拉进 HTTP 启动面；且 40 对会**落入既有 `BULK-005`**（`service -> app`，22 → 62）⇒ **仅换桶、不算真收口** |
| **B 集中 seam** | service 层建**单一"领域访问器"**（或按域分组的访问表），handlers 只经它取能力；**懒加载语义保留** | R00-003 −39（40 → 1 处 seam） | ≈36 处改动 + seam 设计；**seam 本身仍是 `service → app` 1 对**（可见）；有"上帝入口"倾向 |
| **C 经 CoreAPI / 服务层接口**（**推荐**） | 把 handlers 需要的领域能力**按域**加到既有 `@modules/runtime/api/CoreAPIImpl`（service 层）或其分域接口；handlers 只依赖 service | 方向**真正正确**，R00-003 可归零 | **中等工程**：40 处能力面很宽（tasks/ai/knowledge/tools/plugins/buddy/…）⇒ 必须**分域分批**，并防 CoreAPI 膨胀 |
| **D 维持现状 + 登记** | 不动代码（36/40 已在 `R00-003` 中**可见**） | 0 | 盲区统计长期挂着 |

**推荐：C（分域分批，先易后难）**，**B 作为过渡**（对"一次性取用、域边界清晰"的 handler 先经 seam，再逐步替换为 CoreAPI 接口）。

**建议的第一批**（待裁定后执行）：从**对少且域清晰**的目标入手 —— `docs` / `chat` / `context` / `workspaces` / `skills` 各 1 对 + `dream` 2 对 ⇒ **6 对**，先验证口径与改动形态，再决定是否铺开。

> **未做**：本轮**只判定 + 出设计**，未改任何代码。

### 3.7.4 执行：第 1 个站点已落地（2026-09-30，台账 D-85）—— **度量口径须纠正**

**配方（每个站点 3 步，已跑通可复制）**：① `CoreAPI.ts` 增**内联 DTO** 的门面方法（⚠️ **不得引用 app 类型** —— `R00-001` 连类型导入也计）→ ② `CoreAPIImpl.ts` 实现（**app 动态导入收敛到此处**，该文件是本仓既有的 sanctioned `service → app` 缝）→ ③ handler 改调门面（**行为逐字保持**）。

**站点 1/6 = `context` → `GitContextService`**：实测 `typecheck 0`（内联 DTO 与 app `GitStatusInfo` 结构兼容 ✓）· `违规 0` · `已豁免 260 不变` · **`R00-003` 72 → 72** · exit 0。

**🔴 度量口径纠正（必须据此看待 C1 收益）**：`runtime/api/CoreAPIImpl` **本身在 service 层** ⇒ 把 handler 的跨层 import 收敛到它，是**同一对换源文件**（`(auth-access-routes.ts, context)` → `(CoreAPIImpl.ts, context)`）⇒ **`R00-003` 总数不减**。
⇒ **C1 的正确度量 = `infrastructure (service) → app` 的对数（40 → …）与承载源文件数（36 → …）**；收益本质是**收敛到唯一 sanctioned 缝**（`CoreAPIImpl`），而非计数下降。终态时 `R00-003` 里该簇将只剩 `CoreAPIImpl` 少数几对（是否为其建"设计即如此"标注，按 D-78 裁定**不建白名单**，仅登记）。

### 3.7.5 站点 1–3 已落地（2026-09-30，台账 D-85 / D-86）

| 站点 | 目标 | 门面方法（新增于 `CoreAPI`） | 状态 |
|:--:|---|---|:--:|
| 1 | `context` → `GitContextService` | `getGitContextSnapshot()`（DTO **mirror**） | ✅ D-85 |
| 2 | `chat` → `PathGuardService` | `getPathGuardMetrics()`（DTO **不透明**）· `resetPathGuardMetrics()` | ✅ D-86 |
| 3 | `workspaces` → `WorkspaceStorage` | `listWorkspaceEntries()` · `getWorkspacePath()` · `deleteWorkspace()` | ✅ D-86 |

**累计实测**：`infrastructure (service) → app` **40 → 37**；`R00-003` 72 → **71**；`runtime (service) → app` = **4 对，全部源自 `CoreAPIImpl.ts`**（= 收敛目标形态）；typecheck 0 · 违规 0 · `已豁免 260` 不变 · exit 0。

**DTO 取舍规则（本轮确立，后续沿用）**：service 侧**仅透传序列化** ⇒ 用**不透明 DTO**（`Record<string, unknown>`，免镜像字段漂移）；service 侧**需读字段** ⇒ 用**mirror DTO**（字段对齐 app 侧结构，⚠️ **禁引用 app 类型**）。

### 3.7.6 站点 5–6 已落地（`dream`，2 对）· 站点 4/7 交接（2026-09-30，台账 D-87）

| 站点 | 目标 | 门面方法 | 状态 |
|:--:|---|---|:--:|
| 5–6 | `dream`（`memory-handlers.ts` 3 处 + `routes/auth-access-routes.ts` 1 处） | `listDreamCycles`（返回 **`object`**）· `queryDreamCycles` · `getDreamCycle` · `readDreamMetrics` | ✅ D-87 |

**累计实测（站点 1–3、5–6）**：`infrastructure (service) → app` **40 → 35**；`R00-003` **72 → 70**；`runtime (service) → app` = **5 对，全部源自 `CoreAPIImpl.ts`**；typecheck 0 · 违规 0 · exit 0。

### 3.7.7 站点 4 已落地（`docs`，1 对；13 导入 / 14 调用）（2026-09-30，台账 D-88）

**站点 = `docs` → `FileDocsProvider`**（`knowledge-handlers.ts`）：**13 处导入 / 14 处调用**（`buildIndex()` ×2 · `clearCache()` ×12）⇒ 用 `replace_all` **6 处编辑**收敛完成（CoreAPI + Impl + 2 处 `replace_all` + 删 13 处解构 + 补 `getCoreAPI` 导入）。

**🔴 新增规则（第 4 条）：DTO 字段"必填 vs 可选"按「原调用方是否直接使用而无需回退」判定** —— 原代码里 `doc.relativePath` 直接进 `path.join`（无 `|| ''`）⇒ **必填 `string`**；其余字段均有 `|| ''` / `?? []` 回退 ⇒ **可选**。（首版把 `relativePath` 设为可选 ⇒ 实测 `TS2345`）

**累计实测（站点 1–6）**：`infrastructure (service) → app` **40 → 34**；`R00-003` **72 → 70**；`runtime (service) → app` = **6 对，全部源自 `CoreAPIImpl.ts`**；typecheck 0 · 违规 0 · `已豁免 260` 不变 · exit 0。

**剩余**：站点 7 `skills`（**适配器编排，DTO 覆盖不了** ⇒ 单独立项设计 service 层 API）· C1 余量 **33 对**（`tasks` 8 · `ai` 7 · `knowledge` 6 · `tools` 4 · `plugins` 3 · 其余各 1）。

**（承 §3.7.6：`dream` 站点）🔴 三条新增规则（后续沿用）**：
1. **门面返回类型按"调用方怎么用"选**：仅 `JSON.stringify` ⟶ `unknown`；会被**展开** `{...x}` 或取属性 ⟶ `object` / 镜像 DTO。（D-87 实测：`unknown` 触发 `TS2698`）
2. **`CoreAPIImpl` 内引用 app 模块用相对 2 段**（`../../dream/X`）⇒ `R03-002` 对 `parts.length < 3` 直接跳过；**改用 `@modules/dream/X` 别名会被 R03-002 判违规**（该模块有 `index.ts`）。
3. **参数形状必须以实参为准**（D-87 首版漏 `startTime`/`endTime`/`sortOrder` ⇒ `TS2353`）—— 写门面前先读**调用点全文**。

**剩余（交接）**：
- **站点 4 `docs`**（已**完整枚举**，可直接照配方做）：`knowledge-handlers.ts` **13 处导入 / 14 处调用**（`buildIndex()` ×2 · `clearCache()` ×12）⇒ **6 处编辑**（CoreAPI + Impl + 2 处 `replace_all` + 删解构 + 补 `getCoreAPI` 导入）；⚠️ 先确认 `buildIndex()` 返回值调用方**是否迭代**（是则不能用 `unknown`）。
- **站点 7 `skills`**：⚠️ **适配器编排，DTO 覆盖不了** ⇒ 须**单独立项**设计 service 层 API（工程量大，不在本批）。

## §3.8 C1 站点 7 **立项**：`skills` 第三方适配器（2026-09-30，台账 D-89）—— **服务层端口方案**

### 3.8.1 为什么不能照搬前 6 个站点的配方

前 6 站点都是"**少量方法 + 少量调用点**"（1–4 个方法），CoreAPI 门面配方即够。`skills` 不同：

- `handlers/skills-handlers.ts` 的 `getClawHubAdapter()` 被 **19 处**调用；
- 需要 **12 个适配器方法**：`initialize` · `getInstalledSkills` · `searchSkills` · `getSearchEngine` · `getSkillDetail` · `getRemoteVersion` · `getSkillRegistry` · `installSkill` · `uninstallSkill` · `updateSkill` · `enableSkill` · `disableSkill` · `getLocalStore`；
- 另需 **4 个搜索引擎方法**（`searchRemote` · `getSourceNames` · `addCustomSource` · `removeCustomSource`）+ **1 个本地存储方法**（`getSkill`）+ **1 个只读注册表**（`name` · `isEnabled?()`）。

⇒ 照搬配方要往 `CoreAPI` 塞 **12+ 个方法** ⇒ **CoreAPI 膨胀**（正是 §3.7.3 中 C 方案要防的）✗。

### 3.8.2 方案：**服务层端口 + 单入口方法**

1. **服务层定义 4 个端口**（按 handler **实际调用面**派生，不抄 app 全量 API）：

   | 端口 | 方法（= handler 实际用到的） |
   |---|---|
   | `ThirdPartySkillAdapterPort` | 上列 13 个（含三个 `get*` 取子对象的方法） |
   | `SkillSearchEnginePort` | `searchRemote` · `getSourceNames` · `addCustomSource` · `removeCustomSource` |
   | `SkillRegistryPort` | `name` · `isEnabled?()`（**只读**） |
   | `LocalSkillStorePort` | `getSkill(id)` |

   ⚠️ 端口**只引用服务层类型 / `unknown`**，**禁止**引用 app 类型（`R00-001` 连类型导入也计）。⚠️ handler 现有的 `ClawHubAdapterLike` 引用了 app 的 `SkillSearchEngine` / `LocalSkillStore`（**行为 + 类型双重**依赖）⇒ 下移时须一并替换为端口。
2. **`CoreAPI` 只加 1 个方法**：`getThirdPartySkillAdapter(name: string): Promise<ThirdPartySkillAdapterPort | null>`。
3. **编排内聚到 `CoreAPIImpl`**：把 `getClawHubAdapter()` 的"registry 查找 → `instanceof` 收窄 → `initialize()` → 单例 fallback"**原样搬进 Impl**（`instanceof` 需要 app 类，只有 Impl 可持有 ✓）⇒ **无需**新增组合根注册机制 ✓。
4. **handler 侧只改 1 处**：保留本地 `getClawHubAdapter()` 函数壳，函数体改为 `return getCoreAPI().getThirdPartySkillAdapter('clawhub')`，返回类型改用端口（自 CoreAPI 导入，service→service 合法 ✓）⇒ **19 处调用点零改动** ✓✓；再删 2 处动态导入。

### 3.8.3 预期验收

| 指标 | 预期 |
|---|---|
| `infrastructure (service) → app` | **34 → 33（−1）** |
| `R00-003` 总数 | **70 → 70**（1 迁出 +1 新建 `runtime→skills`，与前 6 站点同型） |
| `runtime (service) → app` | 6 → **7 对**（全部源自 `CoreAPIImpl.ts`） |
| 其它 | typecheck 0 · 违规 0 · `已豁免 260` 不变 · exit 0 |

### 3.8.4 **实施前唯一待补取证**

`SkillSearchEnginePort.searchRemote(query, opts)` 的**返回形状**：`skills-handlers.ts:956` 的 `const allResults = await searchEngine.searchRemote('', {})` **之后如何被消费**（是否取 `.results` / `.length`）**尚未读取** ⇒ 该端口方法暂定 `Promise<unknown>`，**须先读 L950–1060 确认**（若取属性，须给**最小投影 DTO** —— 与 §3.7.3 `buildIndex()` 同型风险）。

### 3.8.5 分批（建议）

① 服务层 4 端口 + `CoreAPI.getThirdPartySkillAdapter` + `CoreAPIImpl` 实现（含编排搬迁）；② `skills-handlers.ts` 函数体改写 + 删 2 处动态导入。**两步各自 typecheck + 门禁验证。**

### 3.8.6 批次 ①② 实测结果与**范围纠正**（2026-09-30，台账 D-90）

**已落地**：① 端口文件 `runtime/api/thirdPartySkillPorts.ts`（4 端口，实测 app 类**结构化满足** ⇒ 方案可行）；② `CoreAPI.getClawHubSkillAdapter()` + `CoreAPIImpl` 内聚编排；③ handler 壳改委托（**19 处调用点零改动**）+ 删 2 个本地最小接口 + 删 2 处 app 类型导入。

**⚠️ 但「对」未消除**：

| 指标 | 预测 | 实测 |
|---|---|---|
| `infrastructure (service) → app` | 34 → 33 | **34（未变）** |
| `R00-003` | 70 → 70 | **70 → 71**（+1 新 `runtime→skills`） |
| `已豁免` | 260 不变 | **260 → 259**（静态类型对经端口下移消除） |

**🔴 根因 = 本节早先的枚举范围错误**：`handlers/skills-handlers.ts` 内 `@modules/skills/**` 动态导入**共 11 处**，而非"2 处"：

| 子路径 | 处数 | 状态 |
|---|:--:|---|
| `clawhub/ClawHubAdapter` · `ThirdPartyAdapterRegistry` | 2 | ✅ 已迁（D-90 批次 ①②） |
| `utils/skillParser` | 1 | ⬜ 待迁（L88） |
| `loaders/adapter/safeSkillId` | **7** | ⬜ 待迁（L316/341/365/623/677/1293/1490） |
| `loaders/adapter/SkillPermission` | 1 | ⬜ 待迁（L705） |

**流程教训（强制）**：**枚举"某模块的全部动态导入"必须用 `@modules/<模块>` 前缀 grep**，不得按具体子路径 grep（前者才能穷尽，后者必漏）。

**批次 ③（待做）**：`parseSkillFrontmatter`（纯函数 ⇒ CoreAPI 方法）· `safeSkillId`/`validateSkillId`（7 处 ⇒ 优先）· `SkillPermission`（先判类/函数与用法）。完成后 `infrastructure→app` 才真正 **34 → 33**。

### 3.8.7 批次 ③ 完成 · **站点 7 收官**（2026-09-30，台账 D-91）

**实测该文件 `@modules/skills` 动态导入 = 0**（11 处全迁）。`CoreAPI` 新增 **4 个门面**（纯输入/输出）：

| 方法 | 形态 | 要点 |
|---|---|---|
| `validateSkillId(id)` | `Promise<string \| null>` | 返回**错误信息**，`null` = 通过 |
| `sanitizeSkillId(name)` | `Promise<string>` | 返回安全目录名 |
| `skillMdRequiresApproval(text)` | `Promise<boolean>` | **合并门面**：= `hasSensitivePermission(parseSkillPermissions(text))` |
| `parseSkillFrontmatter(content)` | 最小投影 DTO | 仅 `frontmatter.description`；`frontmatter` 可选 |

**累计实测（站点 1–7 全部完成）**：`infrastructure (service) → app` **40 → 33**；`R00-003` **95 → 70**；`runtime (service) → app` = **7 对，全部源自 `CoreAPIImpl.ts`**；typecheck 0 · 违规 0 · `已豁免 259` · exit 0。

**新增规则（第 5–7 条，后续沿用）**：
5. **合并门面**：若端口需串联多个 app 函数、且**最终只输出 `boolean`/`string`** ⇒ 合成**一个**门面方法，避免把 app 的中间类型（如权限对象）泄漏到服务层 —— 否则 `unknown` 形参与真实窄形参**不兼容**（方法参数双变也救不了必需形参）。
6. **DTO 可选性再确认**：字段若在原代码以 `?.` 访问 ⇒ 端口声明**可选**；且**必须同步放宽 handler 的 `as` cast**（`as X` → `as X | undefined`），否则 `undefined` 不可 cast。
7. **`replace_all` 前先数调用点**：**调用点数 ≠ import 数**（本例 `skillParser` 1 处 import / 2 处调用）—— 按 import 数估改动量会漏。

## §3.9 C1 **`plugins` 域完成**（3 对；2026-09-30，台账 D-92）

**枚举（穷尽）**：`infrastructure/` 下 `@modules/plugins` **3 文件 / 13 处** —— `channel-plugin-handlers.ts` 3 · `plugin-marketplace-handlers.ts` 9 · `skills-handlers.ts` 1。**方案 = 端口 + 单入口**：`runtime/api/pluginAdminPorts.ts`（**13 方法**）+ `CoreAPI.getPluginAdminPort()`；app 对象引用内聚 `CoreAPIImpl`。

**实测**：`infrastructure (service) → app` **33 → 30（−3，该域清零）** · `R00-003` **70 → 68** · `已豁免 259` 不变 · 违规 0 · exit 0。

**新增规则（第 8–10 条）**：
8. **"同 try/catch 内序贯调用"合并为一个门面方法**（如 `stopAndUnloadPlugin`）—— 保语义、减方法数。
9. **DTO 必填判据延伸**：字段被**直接赋值给 `boolean` 变量**或**直接用于 `if`**（无 `?.`/`??`）⇒ **必填**；反之（有回退）⇒ 可选。
10. **"逐条取字段"的列表结果必须给 DTO 数组**（`unknown` 会在 `.map` 处报 `TS18046`）。
11. **⚠️ 硬性纪律：编辑批次与验证命令不得同批发出**（D-91/D-92 各犯一次 ⇒ 抢跑读到中间态、误报错误）。**改完先复跑一次再判定。**

## §3.10 C1 **`tools` 域完成**（4 对；2026-09-30，台账 D-93）

**枚举（穷尽）**：`infrastructure/` 下 `@modules/tools` **7 文件 / 11 处**，**动态 4 对**（`image-handlers` · `video-handlers` · `video-task-handlers` · `knowledge-handlers`）；其余为**静态**导入（`R00-001` 豁免对，按口径**不动**）。**方案 = 端口 + 单入口**：`runtime/api/toolsPorts.ts`（**8 方法** + **12 字段 `VideoTaskDto`**）+ `CoreAPI.getToolsPort()`。

**实测**：`infrastructure (service) → app` **30 → 26（−4，该域清零）** · `R00-003` **68 → 65** · `已豁免 259` 不变 · 违规 0 · exit 0。

**新增规则（第 12–13 条）**：
12. **端口参数必须"照实参"定**：原 handler 的实参本身松散（`unknown` / `{} | undefined`）⇒ 端口收窄会**凭空制造** `TS2322`；反之若实参严格则**不得**放宽（见规则 9）。**唯一判据 = 原调用点的实参类型。**
13. **规避 app 类型引用的取形参手法**：需要 app 侧某函数形参类型时，用 **`Parameters<typeof fn>[n]`** 就地取（如 `{} as unknown as Parameters<typeof tool.execute>[1]`），**避免** `import type` app 类型而新增跨层类型对。

**C1 剩余（`infrastructure (service) → app` = 26）**：`tasks` 8 · `ai` 7 · `knowledge` 6 · `query`/`buddy`/`commands`/`workspace`/`project` 各 1。

## §3.11 C1 **`knowledge` 域立项**（6 对 · **63 处** —— 迄今最大域；2026-09-30，台账 D-94）— ✅ **三阶段 P1/P2/P3 全部完成，整域清零**（D-95 / D-96 / D-97）

### 3.11.1 实测清单（穷尽枚举，`@modules/knowledge` 前缀）

| 文件 | 处数 | 去重能力面 |
|---|:--:|---|
| `handlers/knowledge-handlers.ts` | **43** | `KnowledgeBaseRegistry` ×**26** · `frontmatter`（`parseFrontmatter`/`parseTags`）×3 · `KnowledgeRouter` · `KnowledgeDigestService` · `search/UnifiedSearchService` · `KnowledgeCompiler` · `CompileProgressTracker` · `lineage/LineageStore` · `KnowledgeLinter` · `ingestion/extractors/PdfOcrExtractor` · `KnowledgeBaseWriter` ×2 · `KnowledgeConfig` ×2 |
| `handlers/faq-handlers.ts` | 8 | `getFAQService()`（**同一入口重复 8 次**） |
| `handlers/semantic-index-handlers.ts` | 7 | `semantic/store` ×3（⚠️含**类型位** `import('…').SemanticStore`）· `semantic/builder` · `KnowledgeBaseRegistry` |
| `handlers/graph-handlers.ts` | 2 | `KnowledgeGraph`（`new` + `init()`） |
| `http/LocalHTTPServiceHelpers.ts` | 2 | `KnowledgeCompiler` · `KnowledgeCompileScheduler` |
| `handlers/datasource-handlers.ts` | 1 | `datasource/RSSConnector` |

### 3.11.2 三阶段（建议）

| 阶段 | 范围 | 对数 | 说明 |
|:--:|---|:--:|---|
| **P1** | 4 个小文件（`datasource` · `graph` · `LocalHTTPServiceHelpers` · `faq`） | **4** | 13 处，能力面小（`RSSConnector` / `KnowledgeGraph` / `KnowledgeCompileScheduler` / `FAQService`）⇒ 1–2 批 |
| **P2** | `semantic-index-handlers` | **1** | ⚠️ 含**类型位** app 类型（`SemanticStore`）⇒ 端口须**自持等价结构类型**（禁引用 app 类型）或改服务层 DTO |
| **P3** | `knowledge-handlers` | **1** | 最大（43 处 / 12 能力）；`KnowledgeBaseRegistry` **26 次**最可能坍缩为**少量方法** |

### 3.11.3 风险与判据

- ⚠️ **类型位动态导入**（`import('…').Type`）首次出现（P2）—— 端口须自持等价类型（规则：**禁引用 app 类型**）。
- ⚠️ P3 须**先统计 `KnowledgeBaseRegistry` 的实际调用方法集**（26 次访问很可能只落到 3–6 个方法）⇒ 端口规模由此定，**不可按访问次数估**。
- 预计端口方法总数 **~19–25**（跨 3 阶段）—— 本 C1 **单域最大者**；建议按 P1 → P2 → P3 逐批，每批独立 typecheck + 门禁。
  · **⚠️ 实测纠正（P3 完成后，2026-09-30）**：该预判**偏低** —— 实际 **39 方法**（P1 13 + P2 6 + P3 20）。偏差根因：**P3 的 43 处压着 12 个互相独立的能力面**（每个能力即便只 1–2 处调用也是独立方法）；"处数坍缩为方法数"**只对单一能力的重复调用成立**（如 `KnowledgeBaseRegistry`：26 次访问 → **7 方法**）。⇒ 后续估端口规模须按**能力面个数**而非处数。

### 3.11.4 **P1 已完成**（4 对；2026-09-30，台账 D-95）

`runtime/api/knowledgeOpsPorts.ts`（**13 方法**）+ `CoreAPI.getKnowledgeOpsPort()` + Impl 内聚；13 处调用点改经端口。

**实测**：`infrastructure (service) → app` **26 → 22（−4）** · `R00-003` **65 → 62** · `已豁免 259` 不变 · 违规 0 · exit 0 · `infrastructure → knowledge` **6 → 2**（余 P2/P3）。

**新增规则（第 14–15 条）**：
14. **回调/启动/DI 注册可整体内聚端口**：如 `startKnowledgeCompileScheduler(aiService, opts, registerNotify)` —— 调用方只交**参数 + 注册函数**，`new`/`start()`/绑定全在 Impl；且**返回句柄须按原函数的声明返回类型**给（本例 `{ stop }`，原实现虽返回实例但声明是结构类型 ⇒ **只回传声明面**，不改行为）。
15. **"守卫式收窄"也算实参判据**：`if (!base) return;` 之后的实参类型是**收窄后**的类型 ⇒ 端口须按**收窄后**声明（初版按变量原始类型写 ⇒ 5 处 `TS2345`）。
16. **边界 cast 的合法情形**：实参来自 `JSON.parse`（无静态类型）或 service 层持有的对象 ⇒ 端口无法"照实参定" ⇒ 允许 Impl 内**各一处**收窄并**在端口文档写明**（本例 3 处：`aiService` / `params` / `items`）。

### 3.11.5 **P2 已完成**（1 对；2026-09-30，台账 D-96）

`semantic-index-handlers.ts` 6 处（含 **2 处「类型位」**）⇒ `KnowledgeOpsPort` **+6 方法** + 2 个**句柄端口类型**（`SemanticStorePort` · `SemanticIndexBuilderPort`）。

**实测**：`infrastructure (service) → app` **22 → 21** · `R00-003` **62 → 61** · `infrastructure → knowledge` **2 → 1** · `已豁免 259` 不变 · 违规 0 · exit 0。

**新增规则（第 17–19 条）**：
17. **「类型位」引用收敛**：app 类型（`import('…').Type`）⇒ **服务层端口类型**（结构等价，仍**禁引用 app 类型**）。⚠️ **注释里不得写完整导入路径** —— 门禁不剥离注释，写了会让「对」**假复活**（D-77 陷阱，本次第 2 次踩到）。
18. **缓存归属**：原**模块级缓存保留在调用方**，端口只提供**原子操作**（读 stamp / 建+load 句柄）⇒ 结构与行为双不变；`readonly` 成员须用 **`ReadonlyArray` / `readonly`**（实测 `TS2416`）。
19. **同一域可分阶段共用同一端口**：P1 13 方法 + P2 6 方法同挂 `KnowledgeOpsPort`（单入口不变），避免同域多入口碎片化。

### 3.11.6 **P3 已完成 —— `knowledge` 域整域清零**（1 对 / **43 处 / 12 能力**；2026-09-30，台账 D-97）

`knowledge-handlers.ts` **43 处** ⇒ `KnowledgeOpsPort` **+20 方法 / +3 DTO 类型**（`KnowledgeRoutePort` · `KnowledgeFrontmatterDto` · `KnowledgeLintResultDto`）。
**根目录 21 处复用 P2 已有** `getDefaultKnowledgeRoot()`，未另立方法；`CoreAPIImpl` 内聚实现（含 `registry()` 单例取用 helper）。**端口方法总数 39**（P1 13 + P2 6 + P3 20）。

**枚举证实**：`KnowledgeBaseRegistry` **26 次访问 → 实际 7 方法**（`getKnowledgeRoot` + 6 CRUD）⇒ "方法数 ≠ 访问次数"（第三次成立）。

**实测**：`infrastructure (service) → app` **21 → 20（−1）** · `R00-003` **61 → 60** · `infrastructure → knowledge` **1 → 0（整域清零）** · `已豁免 259 → 258` · 违规 0 · `bun run typecheck` 0 错误 · exit 0。

**新增规则（第 20–23 条）**：
20. **实例语义能力的端口形态**：`new X()` + `init()` + `query()` + `close()`（`LineageStore`）或每次 `new`（`KnowledgeBaseWriter`）⇒ 端口只暴露**一次业务动作**（`queryKnowledgeLineage` / `listKnowledgeSnapshots` / `restoreKnowledgeSnapshot`），**实例生命周期内聚实现侧**。
21. **共享单例无需外传句柄**：当两个能力共用同一单例（`getKnowledgeRouter()` 与 `createUnifiedSearchService(router)`）⇒ 端口分别给**原子方法**，实现侧各自再次取用同一单例，调用方**零句柄传递**。⚠️ 对比 P2 的 `SemanticStorePort`：该处调用方**自持**模块级缓存 ⇒ **才需**回归句柄。
22. **DTO 必填/可选判据**：按"原调用点是否**无回退地直接读**"定 —— 本例 `KnowledgeFrontmatterDto.tags` **必填**（原码 `parsed.tags.length` 无 `?.`）。
23. **"类型位"二次出现（跨域类型）**：`KnowledgeRoute`（**`docs` 域**类型）⇒ `KnowledgeRoutePort`（服务层端口类型，`matchType` 联合**收宽为 `string`**）⇒ **顺带消除 `infrastructure → docs` 1 对**（同文件内）。

**⚠️ 残留（如实登记）**：该文件仍保留 **1 处 `@modules/ai`**（`handleKnowledgeCompile` 取 `aiService`）⇒ 归属 **`ai` 域批次**，**不移入本域**。

**累计**：`infrastructure (service) → app` **40 → 20**；`R00-003` **95 → 60**。

**C1 剩余（`infrastructure (service) → app` = 20，**动态组口径**）**：`tasks` **8** · `ai` **7**（含 `knowledge-handlers` 残留 1 处）· `query`/`buddy`/`commands`/`workspace`/`project` 各 **1**。
> ⚠️ **双口径纪律（D-98 起）**：上表数为 **R00-003 动态组**的**文件数**；域全貌须另计**静态**引用（在 R00-001 `已豁免` 内）。例：`tasks` 域动态组 8 文件，**并集实为 11 文件 / 50 处**（见 §3.12）。

## §3.12 C1 **`tasks` 域立项**（**11 文件 · 50 处** / 12 能力面；2026-09-30，台账 D-98）— ✅ **四阶段 P1/P2/P3/P4 全部完成，整域清零**（D-99 / D-101 / D-102+D-103 / D-104）

### 3.12.1 实测清单（穷尽枚举，`@modules/tasks` 前缀 **+ 相对路径**）

| 文件 | 处 | 动态 | 去重能力面 |
|---|:--:|:--:|---|
| `handlers/plan-flow-handlers.ts` | 8 | 8 | `TaskOrchestrator` 单例（**8 方法**）· `TaskFlowRegistry`（**3 方法**） |
| `handlers/cron-handlers.ts` | 11 | 11 | `CronJobStore`（**7 方法**）· `CronParser` · `GlobalCronScheduler`（**3 函数**）· `CronRunLog`（**3 方法**） |
| `handlers/pdca-handlers.ts` | 11 | 5 | `SqliteTaskStore`（**相对路径**）· `getOrCreateOrchestrator`/`getOrchestrator`/`getAllOrchestrators` · PDCA checkpoint 工具集（**6 函数 + 3 常量 + 1 类型**） |
| `handlers/agent2-handlers.ts` | 5 | 5 | `SqliteTaskStore` ×4 · `taskRegistry.recoverLostTask` |
| `handlers/kanban-handlers.ts` | 5 | 5 | `SqliteTaskStore` ×5 |
| `handlers/routes/goal-routes.ts` | 3 | 0 | `getTaskGoalStore`（**5 方法**）· `isTerminalGoalStatus` · `emitGoalCreated`/`emitGoalUpdated` |
| `handlers/inbox-handlers.ts` | 2 | 2 | `getOrCreateOrchestrator` → `resumeAfterApproval` / `abort` |
| `handlers/research-handlers.ts` | 2 | 1 | `pitfallRegistry.record` · `emitPdcaLiveEvent`（**相对路径**） |
| `handlers/agent1-handlers.ts` | 1 | 1 | `SqliteTaskStore` → `init` + `loadTaskStates` |
| `handlers/sessionWaitFields.ts` | 1 | 0 | `getCg3SelfWakeService()` → `getPendingBySession` |
| `handlers/task-handlers.ts` | 1 | 0 | `taskRegistry`（`getAllTasks`/`getTask`/`kill`/`remove`） |

**合计**：**11 文件 / 50 处**（48 条 `@modules/tasks` + **2 条相对路径**）；其中 **8 文件含动态引用**（= R00-003 组的 ×8）。

### 3.12.2 四阶段（建议）

| 阶段 | 范围 | 文件/处 | 说明 |
|:--:|---|:--:|---|
| **P1** | `agent1` · `agent2` · `kanban` · `task-handlers` | 4 / 12 | `SqliteTaskStore`（"新建 + init + 单次业务动作"）+ `taskRegistry` 4 方法 ⇒ 面最小 |
| **P2** | `cron-handlers` | 1 / 11 | cron 四件套；`new X(resolveDbPath())` 形态集中 |
| **P3** | `plan-flow-handlers` · `pdca-handlers` | 2 / 19 | ⚠️ 最大：`TaskOrchestrator` 8 方法 + PDCA 工具集 + Orchestrator 家族 |
| **P4** | `inbox` · `research` · `sessionWaitFields` · `goal-routes` | 4 / 8 | 零散单点：Orchestrator 取用 · `pitfallRegistry` · 自唤醒 · goal store + 事件发射 |

### 3.12.3 风险与判据

- ⚠️ **相对路径 2 处**（`../../../tasks/db/SqliteTaskStore` · `../../../tasks/PdcaLiveEvents`）—— `parseModuleImports` 相对分支同样计入 R00-001 ⇒ D-90 教训（枚举必须含相对路径）。
- ⚠️ `new CronJobStore(resolveDbPath())` —— `resolveDbPath()` **由调用方传入**；实测 cron 7 处**同参** ⇒ 可内聚实现侧（规则 12：照原实参）。
- ⚠️ **模块级常量 + 类型位**（PDCA 3 常量 + `PdcaMetrics` 类型）⇒ 端口须**自持等价只读常量 + 结构类型**（规则 17 同类）。
- ⚠️ **家族式入口 + 单例**（`getOrCreateOrchestrator`/`getOrchestrator`/`getAllOrchestrators` · `taskOrchestrator` · `taskRegistry` · `taskFlowRegistry`）⇒ 按规则 21「单例取用内聚」给**原子方法**，调用方**零句柄**。
- 预计端口方法总数 **~30–40**（分 4 批）。

### 3.12.4 预期验收（按批，**预测待实测**）

| 批次 | R00-003 `infrastructure→tasks`（文件数） | `已豁免` | KPI `infrastructure (service) → app` |
|:--:|:--:|:--:|:--:|
| 基线 | **8** | **258** | **20** |
| P1 后 | 8 → 5 | 258 → 257（`task-handlers` 静态对） | 20 → 17 |
| P2 后 | 5 → 4 | 257 | 17 → 16 |
| P3 后 | 4 → 2 | 257 → 256（`pdca` 静态对） | 16 → 14 |
| P4 后 | 2 → 0 | 256 → 253（`research`/`sessionWaitFields`/`goal-routes`） | 14 → **12** |

**最终预期**：`infrastructure → tasks` **整域清零**（8 动态 + 5 静态 = **11 对**）；KPI **20 → 12（−8）**；`已豁免` **258 → 253（−5）**。

### 3.12.5 **P1 已完成**（4 文件 / 12 处；2026-09-30，台账 D-99）

`runtime/api/taskOpsPorts.ts`（**12 方法 + 2 DTO**）+ `CoreAPI.getTaskOpsPort()` + Impl 内聚；12 处调用点改经端口。

**实测（与 §3.12.4 预测逐数吻合）**：`infrastructure (service) → tasks`（R00-003 文件数）**8 → 5** · KPI `infrastructure (service) → app` **20 → 17** · `已豁免` **258 → 257** · `R00-003` 总数 **60 → 58**（−3 迁出 +1 新增 `runtime → tasks`）· 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 24–25 条）**：
24. **投影字段类型由"调用方怎么用"定**（D-87 同族）：同一能力面的 DTO 须按**每个使用点**反推 —— 本例 `outputFile` 必须 `string | undefined`（agent2 直接喂 `fs.existsSync`）、`metadata` 必须 `Record<string, unknown> | undefined`（agent1 读 `metadata?.priority`）；而 `status` 可**收宽为 `string`**（app 侧是**字符串枚举** `TaskStatus` —— 字符串枚举成员**可赋给** `string`，且原码本就直接与 `'completed'` 比较 ⇒ 收宽反而消除枚举/字面量比较的隐患）。
25. **"保持不关闭"也是行为契约**：原调用点**普遍遗漏** `close()` 时，端口实现**不得顺手补上**（那是改行为）—— 须**逐字保持**，在端口文档 + Impl 注释注明，并把该缺陷**另案登记**（见台账 D-100）。

**⚠️ 预存问题（本批取证时发现，只登记不修）**：任务状态存储逐请求 `new` + `init()` 且**不 `close()`**（连接不复用 + 每次重跑建表/迁移）⇒ 台账 **D-100**。

### 3.12.6 **P2 已完成**（`cron-handlers` 1 文件 / 11 处；2026-09-30，台账 D-101）

`TaskOpsPort` **+5 方法 + 4 类型**（`CronJobStorePort` · `CronRunLogPort` · `CronJobRecord` · `CronStatsDto`）；`resolveDbPath()` 内聚实现侧。

**实测（与 §3.12.4 预测逐数吻合）**：`infrastructure (service) → tasks` **5 → 4** · KPI `infrastructure (service) → app` **17 → 16** · `已豁免` **257 不变** · `R00-003` 总数 **58 → 57** · 违规 0 · `typecheck` 0 错误 · exit 0。顺带移除该文件 **7 处 `@modules/core/paths`** 动态导入。

**新增规则（第 26–27 条）**：
26. **句柄 vs 原子方法的判据 = "原调用点是否显式 `close()`"**：**不** close（P1）⇒ **原子方法**（生命周期内聚实现侧，规则 20）；**显式** close（P2）⇒ **句柄**（调用方自持会话，`CronJobStorePort` / `CronRunLogPort`）。⚠️ **同一域两种形态并存是正常的** —— 按调用点**真实形态**定，不强行统一。
27. **🔴 Impl 端口方法以边界收窄（`as never`）作返回值时，`getXxxPort()` 必须显式标注返回类型**：`getCoreAPI()` 返回的是**实现类**（非 `CoreAPI` 接口），而 `implements` **不提供**方法体的上下文类型 ⇒ 不标注时返回被**推导**为 `never`；因 `never` 可赋给一切，**`implements` 校验通过且静默**，但调用方按**实现类型**解析 ⇒ 一片 `TS2339: property does not exist on 'never'`（本次 **10 处**）。修复 = 给该方法加 `: Promise<XxxPort>`（并在 Impl 内 `import type` 该端口）⇒ 对象字面量获得上下文类型，报错全消。

### 3.12.7 **P3-a 已完成**（`plan-flow-handlers` 1 文件 / 8 处；2026-09-30，台账 D-102）

`TaskOpsPort` **+11 方法 + 2 类型**（`PlanDto` · `PlanStepDto`）；单例取用内聚（`orchestrator()` / `flowRegistry()` helper）。

**实测**：`infrastructure (service) → tasks` **4 → 3** · KPI `infrastructure (service) → app` **16 → 15** · `已豁免` **257 不变** · `R00-003` 总数 **57 → 56** · 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 28 条）**：
28. **"是否需 `as never`"由目标类型是否带索引签名决定**：目标 DTO **无**索引签名 ⇒ app 的 `interface` 可**直接赋值**（本轮 `PlanDto` ⇒ **零收窄**，规则 27 不触发）；目标**带**索引签名（P2 的 `CronJobRecord`，为支持调用方**原地改**）⇒ interface 缺"隐式索引签名"而**不可直接赋值** ⇒ 需边界收窄 + 规则 27 的显式返回类型。⇒ **设计端口 DTO 时优先"无索引签名 + 最小字段"，可完全避免收窄**；只有"调用方需**原地修改**"时才引入索引签名。

### 3.12.8 **P3-b 已完成 —— P3 收口**（`pdca-handlers` 1 文件 / 11 处，含静态引用 + 类型位；2026-09-30，台账 D-103）

`TaskOpsPort` **+9 方法 + 4 类型**（`PdcaMetricsDto` · `PdcaDecisionRowDto` · `PdcaOrchestratorPort` · `PdcaStatusSetsDto`）；Impl 新增 `tasksModule()` / `pdcaBridge()` helper。

**实测（与 §3.12.4 预测逐数吻合）**：`infrastructure (service) → tasks` **3 → 2** · KPI `infrastructure (service) → app` **15 → 14** · `已豁免` **257 → 256** · `R00-003` 总数 **56 → 55** · 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 29–30 条）**：
29. **🔴 端口化的"连带签名变更"须核全部调用方并保序**：被端口化对象若经由**跨文件公共函数**暴露（本例 `scanAndAbortStalePdcaTasks` 被 `main.ts` 调用），而端口 API 为**异步** ⇒ 该函数被迫转 `async`。必须 ① **查全部调用方** ② **保持其既有次序/时序语义**（`main.ts` 注释明确"留存清理**必须**在扫描之后" ⇒ 改 `await`，**不是** fire-and-forget）③ 同步更新调用方。**不能只求编译通过**。
30. **模块级只读常量经端口暴露时"取一次、同步用"**：`ReadonlySet` 类常量（本例 3 个 PDCA 状态集）若逐次经异步端口调用，会把**同步 O(n) 扫描**放大为 O(n) 次 await ⇒ 端口给**一次性取用**（`getPdcaStatusSets()`），调用方缓存后同步 `.has()`，**保留原性能特征**。（附带：`PdcaOrchestratorPort.confirm?` 保持**可选** —— app 侧确无该方法，端口不应虚构"一定存在"。）

**⚠️ 形态再印证（P1/P2/P3-b 三形态并存）**：`listPdcaDecisionRows` 原调用点**既不 `init()` 也不 `close()`** ⇒ 端口**逐字保持**。⇒ 判据始终是**"原调用点怎么写"**：不 init 不 close（P3-b）/ new + init（P1）/ new + init + close（P2）。

### 3.12.9 **P4 已完成 —— `tasks` 域整域清零**（4 文件 / 8 处；2026-09-30，台账 D-104）

范围：`inbox-handlers`(2) · `research-handlers`(2，含相对路径) · `sessionWaitFields`(1) · `routes/goal-routes`(3)。
方案：`TaskOpsPort` **+12 方法 + 3 类型**（`TaskGoalStatusDto` · `TaskGoalDto` · `WakeEntryDto`）+ `PdcaOrchestratorPort` **+2 方法**（`resumeAfterApproval` / `abort`）。**端口最终 49 方法**（P1 12 + P2 5 + P3 20 + P4 12）。

**实测（与 §3.12.4 预测逐数吻合）**：`infrastructure (service) → tasks` **2 → 0（整域清零）** · KPI `infrastructure (service) → app` **14 → 12** · `已豁免` **256 → 253** · `R00-003` 总数 **55 → 53** · 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 31–32 条）**：
31. **DTO 字段类型由"调用方读什么"**+**"把它喂给谁"**共同决定（规则 24 的延伸）：本轮 `resumeAfterApproval().phase` 初版写 `unknown`，但调用方把它喂给 `span.setAttribute`（需 `AttributeValue`）⇒ 实测 **`TS2345`** ⇒ 改为**必填 `string`**。⇒ 定 DTO 时须**顺链看下游**，不能只看读取点。
32. **枚举/联合优先"逐字镜像"而非收宽为 `string`**：`TaskGoalStatusDto` 镜像 app 的 `TaskGoalStatus` 联合 ⇒ `isTerminalGoalStatus` **零 cast**；若图省事写成 `string`，则每处调用都需边界收窄，且丢失"契约变更即编译报错"的保护。

**🔴 行为差异（如实登记，台账 D-105）**：`recordPitfall` 原为**同步**调用，其抛错被 `VerifierAgent` 的 catch 捕获 ⇒ **把 REJECT 降级为 APPROVE**（旁路写盘故障污染判定）；异步端口化后**不再**降级（属**顺带修复**，但确为行为变更）。已在 handler 内 `try/catch + handleError` 兜底（避免 unhandled rejection）并标注。

**域结项**：`tasks` 域 **11 文件 / 50 处** 全部收敛（P1 4 · P2 1 · P3 2 · P4 4）。**`infrastructure → tasks` 归零**。
⚠️ 门禁残留 `bridge → tasks ×1` 与 `runtime → tasks ×1` —— **不属** `infrastructure` 域（前者为 `bridge` 模块；后者是 sanctioned 缝 `CoreAPIImpl`，经 `BULK-005` 豁免）。

**累计**：KPI `infrastructure (service) → app` **40 → 12**；`R00-003` **95 → 53**。

**C1 剩余（`infrastructure (service) → app` = 12，动态组口径）**：`ai` **7**（含 `knowledge-handlers` 残留 1 处）· `query`/`buddy`/`commands`/`workspace`/`project` 各 **1**。

## §3.13 C1 **`ai` 域立项**（**10 文件 · 28 处** / 10 能力面；2026-09-30，台账 D-106）— ✅ **四阶段 P1/P2/P3/P4 全部完成，整域清零**（D-107 / D-108 / D-109 / D-110）

### 3.13.1 实测清单（穷尽枚举，`@modules/ai` 前缀 **+ 相对路径**；相对路径 0）

| 文件 | 处 | 动态 | 去重能力面 |
|---|:--:|:--:|---|
| `handlers/llama-handlers.ts` | **16** | 14 | `LlamaCppServerManager`(9) · `registerLlamaCppProvider`(2) · `HardwareDetector`(2) · `ModelRecommender`(1) · `ModelDownloadService`(1) · **类型位** `MigrateProgress` |
| `handlers/analytics-handlers.ts` | 2 | 1 | `usageStatsService`（`initialize` / `getLatencyStats`）+ **类型位** `UsageStatsService['getLatencyStats']` |
| `handlers/cost-handlers.ts` | 2 | 2 | `modelPricingService`（`initialize`/`getAllPricing`）· `providerManager`（`initialize`/`listProviders`） |
| `handlers/translation-handlers.ts` | 2 | 0 | `translationService.translate` + **类型位** `TranslateRequest` |
| `handlers/research-handlers.ts` | 2 | 1 | `createAIService({...})` · `modelRouter.resolveRole`（另 1 行为**注释**，不计） |
| `http/LocalHTTPServiceHelpers.ts` | 1 | 1 | `aiService.getDefaultModel()` |
| `handlers/knowledge-handlers.ts` | 1 | 1 | `aiService`（**P3 遗留单点**，见 D-97） |
| `handlers/semantic-index-handlers.ts` | 1 | 1 | `globalEmbeddingManager`（`initialize`/`embedOne`） |
| `handlers/agent-role-handlers.ts` | 1 | 0 | `activeModelService.getActiveModels` · `deriveModelType` |
| `handlers/routes/auth-access-routes.ts` | 1 | 0 | `tryHandleRoute(req, res)` |

**合计**：**10 文件 / 28 处**（grep 29 行 − **1 行注释**）；其中 **7 文件含动态引用**（= R00-003 组的 ×7）。
**双口径**：另 **4 文件**（`agent-role-handlers` · `llama-handlers`（类型位）· `translation-handlers` · `auth-access-routes`）为**静态**引用 ⇒ 计入 R00-001 `已豁免`（**不在动态组内**）。

### 3.13.2 四阶段（建议）

| 阶段 | 范围 | 文件/处 | 说明 |
|:--:|---|:--:|---|
| **P1** | `LocalHTTPServiceHelpers` · `knowledge-handlers` · `semantic-index-handlers` · `research-handlers` | 4 / 4 | **单例取用**为主（`aiService` / `globalEmbeddingManager` / `createAIService`）；含 `knowledge-handlers` 的 **P3 遗留单点** |
| **P2** | `analytics-handlers` · `cost-handlers` | 2 / 4 | 计费 / 统计服务（`usageStatsService` · `modelPricingService` · `providerManager`）+ 1 类型位 |
| **P3** | `agent-role-handlers` · `routes/auth-access-routes` · `translation-handlers` | 3 / 4 | **静态**导入 + 2 类型位（`TranslateRequest`）—— ⚠️ **不进动态组** ⇒ 只降 `已豁免`，不动 KPI |
| **P4** | `llama-handlers` | 1 / **16** | ⚠️ 最大（占全域 **57%**）：本地模型管理五件套 + 类型位 `MigrateProgress` |

### 3.13.3 风险与判据

- **`llama-handlers` 16 处 = 全域 57%** ⇒ 单列 P4（能力面为 `LlamaCppServerManager` 同族 9 处 + 4 个单点模块）。
- **类型位 3 处**（`MigrateProgress` · `UsageStatsService['getLatencyStats']` · `TranslateRequest`）⇒ 端口须自持等价结构类型（规则 17）。
- **`createAIService({...})` 是"工厂调用"而非单例取用** ⇒ 端口须暴露**工厂方法**（参数照原实参，规则 12）—— 与本域其它形态不同。
- **`tryHandleRoute(req, res)` 是"路由接管"语义** ⇒ 端口形态待取证（可能需**原样透传** `req`/`res`）。
- 预计端口方法 **~15–20**（分 4 批）。

### 3.13.4 预期验收（按批，**预测待实测**）

| 批次 | R00-003 `infra→ai`（文件数） | `已豁免` | KPI `infrastructure (service) → app` |
|:--:|:--:|:--:|:--:|
| 基线 | **7** | **253** | **12** |
| P1 后 | 7 → 3 | 253 | 12 → 8 |
| P2 后 | 3 → 1 | 253 | 8 → 6 |
| P3 后 | 1（**不变** —— 静态对不进动态组） | 253 → 250 | 6（不变） |
| P4 后 | 1 → 0 | 250 → 249 | 6 → **5** |

**最终预期**：`infrastructure → ai` **整域清零**（7 动态 + 4 静态 = **11 对**）；KPI **12 → 5（−7）**；`已豁免` **253 → 249（−4）**；`R00-003` 总数 **53 → 46**。

### 3.13.5 **P1 已完成**（4 文件 / 4 处；2026-09-30，台账 D-107）

新建 `runtime/api/aiOpsPorts.ts`（**6 方法 + 1 句柄类型**）+ `CoreAPI.getAiOpsPort()` + Impl 内聚（入口**显式标注返回类型**，沿用规则 27）。

**实测（与 §3.13.4 预测逐数吻合）**：`infrastructure (service) → ai` **7 → 3** · KPI `infrastructure (service) → app` **12 → 8** · `已豁免` **253 不变** · `R00-003` 总数 **53 → 49** · 违规 0 · `typecheck` 0 错误 · exit 0（文件数 3968 → **3969**）。

**新增规则（第 33–34 条）**：
33. **⚠️ "透传句柄"与"消费句柄"是两种形态，不可混用**：本域 `getAiServiceHandle()` 必须回**真对象**（调用方把 `aiService` **原样转交**给知识库编译端口）—— 若照 tasks 域的"结构替身句柄"包装，**运行期即失效**（替身被当成真 `aiService` 传给 `runKnowledgeCompile`）。⇒ 判据：**句柄是被"调用"（可包装）还是被"转交"（必须原物）**。
34. **工厂调用 → 工厂方法 + 句柄**：`createAIService({...})` 造**新实例**并跨生成器复用 ⇒ 端口给工厂方法，句柄只暴露被消费面；其**流式**方法声明为 `AsyncIterable<unknown>`（比 `AsyncGenerator` 更宽松、更稳，调用方只需 `for await`）。另：同步取值（`getDefaultModel`）与"同步返回 Promise"（`initialize()`）统一包 `Promise`；**回 `void` 的方法须 `await` 且不返回**，以免撞上 `Promise<X>` → `Promise<void>` 的泛型赋值限制。

**顺带清理（D-77 纪律）**：改写 `research-handlers.ts` 的**文档注释**（原文含 `@modules/ai` 字样）⇒ 消除"注释令「对」假复活"的隐患。

### 3.13.6 **P2 已完成**（`analytics-handlers` + `cost-handlers` 2 文件 / 4 处；2026-09-30，台账 D-108）

`AiOpsPort` **+6 方法 + 3 类型**（`LatencyStatsDto` · `ModelPricingBriefDto` · `ProviderBriefDto`）。

**实测（与 §3.13.4 预测逐数吻合）**：`infrastructure (service) → ai` **3 → 1** · KPI `infrastructure (service) → app` **8 → 6** · `已豁免` **253 不变** · `R00-003` 总数 **49 → 47** · 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 35 条）**：
35. **并行初始化须保持并行**：原调用点用 `await Promise.all([a.initialize(), b.initialize()])` ⇒ 端口**分别**暴露两个方法，调用方**仍** `Promise.all(...)`。⚠️ 若把两者合成一个端口方法（内部串行 `await`），会**悄悄串行化**初始化 ⇒ 首请求耗时变化。⇒ **端口方法粒度应尊重原调用的并发结构**。

**附带（规则 24/31 同族）**：`ModelPricingBriefDto.providerId` **必须必填 `string`** —— 调用方 `Map<string,string>.get(rec.providerId)` **不接受 `undefined`**（app 侧本为 `providerId: string`）。类型位（`ReturnType<…>`）改用投影 DTO 后，**该行的 ai 引用一并消除**。

### 3.13.7 **P3 已完成**（`agent-role` + `auth-access` + `translation` 3 文件 / 4 处，**全静态**；2026-09-30，台账 D-109）

`AiOpsPort` **+4 方法 + 2 类型**（`ActiveModelBriefDto` · `TranslateRequestDto`）；port 文件新增 `import type http from 'http'`。

**实测（与 §3.13.4 预测逐数吻合 —— 双口径范例）**：`infrastructure (service) → ai` **1 不变**（静态对**不进动态组**）· KPI `infrastructure (service) → app` **6 不变** · `已豁免` **253 → 250** · `R00-003` 总数 **47 不变** · 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 36 条）**：
36. **🔴 新增导入前必须对"目标文件"单独复核其既有导入**：跨文件的**批量** grep（一次列出多文件）容易**漏看**目标文件已有的同名导入 ⇒ 本轮 `auth-access-routes` **重复导入** `getCoreAPI`（`TS2300`）。⇒ **给某文件加导入前，先单独 grep 该文件的 import 块**（或 Read 其头部）；不要依赖跨文件批量列表。

**两处实现要点**：
- **"路由接管"语义的形参照 node `http` 类型声明**（`http.IncomingMessage` / `http.ServerResponse`）⇒ 调用方**零 cast**；端口引入的是 node 内建类型，**不产生跨层「对」**。
- **类型位 → "不可信输入"投影**：`as Partial<TranslateRequest>` ⇒ `TranslateRequestDto`（全可选，照**收窄后**形态）；它同时是 `translateText` 实参类型来源（`targetLang` 经守卫收窄为 `string`，恰好满足端口必填）。

### 3.13.8 **P4 已完成 —— `ai` 域整域清零**（`llama-handlers` 1 文件 / 16 处；2026-09-30，台账 D-110）

`AiOpsPort` **+6 方法 + 4 类型 + 1 句柄**（`LlamaServerManagerPort` 9 方法 · `LlamaServerStatusDto` · `LlamaConfigBriefDto` · `LlamaMigrationSafetyDto` · `LlamaDownloadProgressDto`）。

**实测（与 §3.13.4 预测逐数吻合）**：`infrastructure (service) → ai` **1 → 0（整域清零）** · KPI `infrastructure (service) → app` **6 → 5** · `已豁免` **250 → 249** · `R00-003` 总数 **47 → 46** · 违规 0 · `typecheck` 0 错误 · exit 0。

**新增规则（第 37–38 条）**：
37. **⚠️ 句柄方法须保持 app 侧的同步/异步形态**（"只取一次"红利）：句柄只需**一次** `await` 取得 ⇒ 其**原为同步**的方法（`getConfig` / `getLogContent` / `subscribeLogs`）在端口句柄上**仍保持同步** ⇒ 相应调用点**一字未改**（含 SSE 的 `subscribeLogs` 取消函数）。⇒ **句柄形态天然保留了"同步语义"，避免把整片调用点改成 `await`**。另：**共享单例 ⇒ 句柄；`new`-per-use ⇒ 原子方法**（规则 26 判据再应用）。
38. **🔴 端口返回 `unknown` 时，先查调用方是"读字段"还是"展开"**：两者都会立刻报错 —— **`TS18046`**（`'x' is of type 'unknown'`）与 **`TS2698`**（Spread types may only be created from object types）。⇒ ① 读字段 ⇒ 给**最小 DTO**（如 `{ success?: boolean }`）；② **需展开** ⇒ 只能给 `Record<string, unknown>`，而 app 的 `interface` **无隐式索引签名** ⇒ Impl 内需**一处** `as never` 收窄（规则 28 的"展开"变体）。

**域结项**：`ai` 域 **10 文件 / 28 处** 全部收敛（P1 4 · P2 2 · P3 3 · P4 1）。**`infrastructure → ai` 归零**。
⚠️ 门禁残留 `chronos → ai ×3` · `memory → ai ×1` · `runtime → ai ×1` —— **不属** `infrastructure` 域（`chronos`/`memory` 模块与 sanctioned 缝 `CoreAPIImpl`）。

**累计**：KPI `infrastructure (service) → app` **40 → 5**；`R00-003` **95 → 46**；`已豁免` **435 → 249**。

**C1 剩余（`infrastructure (service) → app` = 5）**：`query` · `buddy` · `commands` · `workspace` · `project` 各 **1**。

## §3.14 C1 **五域静态并集立项**（`query`/`buddy`/`commands`/`workspace`/`project`；**16 文件 / 35 处**；2026-09-30，台账 D-111）

**背景（口径纠正）**：D-111 前把五域描述为「都是单点」，实测**双口径**：**动态组 = 4 文件（KPI 5 对）** vs **并集 = 19 文件 / 60 处**（`workspace` 一域即 38 处 / 14 文件）。经用户裁定，D-111 **只收尾 KPI**（动态），静态并集**另立本项**。

**D-111 后的余量（全部为静态引用，故在 `已豁免` 内、不进 KPI）**：

| 域 | 余量 | 文件 |
|---|:--:|---|
| `workspace` | **最大** | `workspaces-handlers`(6) · `council-handlers`(3) · `workitem-search-handlers`(3) · `orchestration-handlers`(2) · `agent-role`/`bottleneck`/`cost`/`orch-intelligence`/`rule`/`monitor-command-routes`/`team`/`workflow-template`/`project-artifact` 各 1（+2 相对） |
| `project` | 4 | `project-artifact-handlers`(4 相对) · `project-handlers`(3 相对) |
| `query` | 4 | `research-handlers`(3) · `checkpoint-handlers`(1，`TAORLoop`) |
| `buddy` / `commands` | **0** | D-111 已全清 ✅ |

合计 **35 处 / 16 文件**（`@modules/*` 27 处 / 15 文件 + 相对路径 8 处 / 2 文件）。

**处置建议**：
1. `workspace` **单独立项**（≈20 处 / 13 文件）：能力面含 `CouncilEngine` / `CouncilOrchestrator` / `RuleEngine` / `OrchIntelligence` / `WorkItemStore` / `LiriConfigManager` / `TeamStore` / `ChangeSetStore` / `ProjectStore` / `AgentRoleStore` / `TaskStore` / `BottleneckAnalyzer` + `types` ⇒ **须先做能力面枚举**（不同文件的能力面可能重复，如 `WorkItemStore`/`LiriConfigManager` 各出现 2 次）。
2. `project`（4 处 / 2 文件）与 `query`（4 处 / 2 文件）可合并为一个小批。
3. ⚠️ `project-artifact-handlers`（**815 行，FSZ 例外**）的静态面（`ProjectArtifactStore`/`ProjectContextService`/`ImplicitEngineHook`/`ProjectItemStore` ×5）与动态面**同文件** ⇒ 一并处理时须留意该文件规模。

**新增规则（第 39 条）**：
39. **新增 `@modules/<域>` 导入前必须先确认该别名存在**：`tsconfig` paths **未必覆盖每个域**（D-111 实测 `@modules/project` **无别名** ⇒ `TS2307`）。⇒ 无别名时用**相对路径**（如 `../../project/ProjectHistoryStore`）；D-111 实测门禁 **违规 0 · exit 0**（未引入新违规）。

## §3.15 C1 **`workspace` 域静态面立项**（承接 §3.14 的 `workspace` 部分；**26 处 / 14 文件 / 13 能力面**；2026-09-30，台账 D-112）

**口径**：本项**全部为静态引用** ⇒ 在 `R00-001 已豁免` 内，**不进 KPI**（KPI `infrastructure (service) → app` 已于 D-111 归零）。预期只降 `已豁免`。

**能力面枚举（逐文件核过，13 面 / 26 处）**：

| # | 能力面 | 处 | 消费文件 |
|:--:|---|:--:|---|
| 1 | `WorkItemStore`（`createWorkItemStore` / `new WorkItemStore`） | **4** | `orchestration-handlers`(1) · `workitem-search-handlers`(1) · `workspaces-handlers`(1) · `project-handlers`(1，相对) |
| 2 | `LiriConfigManager`（`createLiriConfigManager`） | **3** | `orchestration-handlers`(1) · `workitem-search-handlers`(1) · `workspaces-handlers`(1) |
| 3 | `types`（**纯类型位**） | **5** | `cost-handlers` · `project-artifact-handlers` · `workflow-template-handlers` · `workitem-search-handlers` · `workspaces-handlers` |
| 4 | `CouncilEngine` + `CouncilOrchestrator` + `CouncilTypes` | **3** | `council-handlers`(3) |
| 5 | `RuleEngine`（含**类型位** `RuleSpecialization`） | **2** | `rule-handlers`(1) · `routes/monitor-command-routes`(1) |
| 6 | `ProjectStore`（`createProjectStore`） | **2** | `workspaces-handlers`(1) · `project-handlers`(1，相对) |
| 7 | `TaskStore`（单例 `taskStore`） | **1** | `workspaces-handlers`(1) |
| 8 | `ChangeSetStore`（`createChangeSetStore`） | **1** | `workspaces-handlers`(1) |
| 9 | `TeamStore`（`createTeamStore`） | **1** | `team-handlers`(1) |
| 10 | `OrchIntelligence` | **1** | `orch-intelligence-handlers`(1) |
| 11 | `BottleneckAnalyzer`（单例 `bottleneckAnalyzer`） | **1** | `bottleneck-handlers`(1) |
| 12 | `AgentRoleStore`（`getAgentRoleStore`） | **1** | `agent-role-handlers`(1) |
| 13 | `ProjectItemStore` | **1** | `project-artifact-handlers`(1，**相对**静态) |
| | **合计** | **26** | **14 文件** |

**四阶段（按"文件数 × 能力面独立性"切）**：

| 批 | 范围 | 文件（**门禁单元**） | 能力面「处」 | 预期 `已豁免` |
|:--:|---|:--:|:--:|:--:|
| **P1** | 单能力面小文件：`bottleneck` · `agent-role` · `team` · `orch-intelligence` · `workflow-template`（⚠️ `rule-handlers` · `routes/monitor-command-routes` **移入 P2** —— 6 个 handler 为**同步** exported 函数，端口化需改 `async`，连带影响路由调用方，须单独成批） | **5**（立项预期 7） | 5 | 249 → **244**（✅ 实测） |
| **P2** | 多能力面文件：`orchestration-handlers` · `workitem-search-handlers` · `council-handlers` · `cost-handlers` + **移入的** `rule-handlers` / `routes/monitor-command-routes` | **6** | 11 | 244 → **238**（✅ 实测） |
| **P3** | ⚠️ 最大单文件：`workspaces-handlers`（含 `types` 2 类型位 + `ProjectStore`/`TaskStore`/`ChangeSetStore`…） | **1** | 6 | 238 → **237**（✅ 实测） |
| **P4** | 静态面残留：`project-artifact-handlers` · `project-handlers`（**仅 workspace 面**；其 `project` 面留下） | **2** | 4 | 237 → **235**（✅ 实测） |

**✅ 本项收官（2026-09-30）**：`已豁免` **249 → 235（−14，逐批实测：P1 −5 / P2 −6 / P3 −1 / P4 −2）** · KPI **0 不变** · `R00-003` **46 不变** · 违规 **0** · 13 个 handler/route 文件全部消除 `@modules/workspace` 引用（含 2 处相对路径导入）· 端口文件 `workspaceOpsPorts.ts` 单点收敛。

**总预期（P2 后校正）**：`已豁免` **249 → 235（−14，按 14 个文件）** · KPI **0 不变** · `R00-003` **46 不变** · 违规 **0** · 新增 **1 个端口文件**（`workspaceOpsPorts.ts`，能力面方法数按"调用方实际读字段"逐面定，**不按访问次数估** —— 规则 4/19）。

> 🔴 **框架纠错（P2 后，2026-09-30，台账 D-114）**：门禁 `R00-001` 的统计单元是 **(源文件 × 目标模块)**，**目标模块 = `workspace`（整模块）** —— 一个文件无论从 `@modules/workspace/**` 导入多少个子模块（`WorkItemStore` + `LiriConfigManager` …），**只计 1 对**。
> ⇒ 立项时按「能力面处数」预估的 **249 → 223（−26）作废**；正确口径见上表「文件（门禁单元）」列。
> ⇒ P1（5 文件 = 5 处）恰好掩盖差异；P2（6 文件 ≠ 11 处，实测 −6）首次暴露。

> ⚠️ **前次实测纠错（P1 后）**：`R00-003` **46 → 46 未变** —— `runtime → workspace` 动态对在 **D-111**（`workspaceOpsPorts.ts` 首次建立）时**已计入**，P1 复用同一 Impl 方法未新增对（原 `46 → 47` 预测作废）。


**关键判据（立项时预置）**：
1. **类型位 5 处（能力面 3）**：`CostReport` · `ProjectContext` · `WorkflowTemplate` · `TaskNode`/`TaskStatus` · `ProjectContext`（另 1）⇒ 按**调用方用法**决定「端口侧结构类型」或**最小投影 DTO**（规则 24/31/32）。
2. **Store 工厂 vs 单例**（规则 26/34）：`createXxxStore(...)` ⇒ **工厂方法**（每调用点新实例，生命周期内聚）；`taskStore`/`bottleneckAnalyzer`/`getAgentRoleStore()` ⇒ 单例 ⇒ **原子方法或句柄**（按"是否被转交"定，规则 33）。
3. **同能力面跨文件复用**：`WorkItemStore`(4) · `LiriConfigManager`(3) ⇒ **端口只出 1 组方法**，调用方零句柄（规则 21）。
4. **不得新增 `已豁免`**：Impl 侧用 `await import('@modules/workspace/…')`（既有约定）⇒ 只进 `R00-003` 聚合。
5. ⚠️ `project-artifact-handlers`（**815 行，FSZ 例外**）P4 只动其 workspace 静态面（`types` + `ProjectItemStore`），**project 面（4 相对）留下**。

**不在本项（留下）**：`project` 域 **5 处 / 2 文件**（`project-artifact` 4 · `project-handlers` 1）· `query` 域 **4 处 / 2 文件**（`research-handlers` 3 · `checkpoint-handlers` 1）⇒ 建议二者合并为一个小批（§3.14 处置建议 2）。


## §3.16 C1 **`project` + `query` 域静态面完成**（**4 文件**；2026-09-30，台账 D-117）— ✅ **两域静态面清零**

**口径**：全部为**静态引用** ⇒ 在 `R00-001 已豁免` 内，**不进 KPI**；门禁效果按**文件数**计（规则 41）。

> ⚠️ **口径纠错**：§3.15 立项时记「`project` **5 处** / 2 文件 · `query` **4 处** / 2 文件」——其中"处"为**导入语句组**数，
> **门禁单元是「文件 × 目标模块」** ⇒ 实测 **−4**（2 + 2），非 −9。

**落地内容（4 文件）**：

| 文件 | 原取用 | 端口形态 |
|---|---|---|
| `project-artifact-handlers` | **相对**导入 `ProjectArtifactStore`（类 + 2 类型）· `ProjectContextService` · `ImplicitEngineHook`；**模块级单例** `artifactStore` | `getProjectArtifactStore(storeDir)` **句柄** + `parseProjectRulesFile` / `persistImplicitEngine` **原子方法** + 类型镜像 `ArtifactKindDto` / `ProjectArtifactDto` |
| `project-handlers` | **相对**导入 `MigrationService`（`migrateLegacyFiles` / `migrateWorktrees`） | `migrateLegacyFiles()` / `migrateWorktrees(worktrees)` **原子方法** |
| `checkpoint-handlers` | `@modules/query` 的 `TAORLoop`（**纯类型位**） | **最小结构镜像** `TaorLoopPort`（2 方法） |
| `research-handlers` | `@modules/query` 的 `CompetitiveStrategyOrchestrator`（值）+ `CompetitiveOrchestrationResult` / `ResearchCallModel`（类型位） | `runCompetitiveOrchestration(description, signal, config)` **原子方法** + 4 类型镜像 |

**语义保全（4 条）**：

1. `TAORLoop` 结构上满足 `TaorLoopPort`（`getCheckpointsForSession(): Promise<TAORCheckpoint[] | null>` → `Promise<unknown>`；`resumeFromCheckpoint(id?): Promise<boolean>` 同形）⇒ **`registerTAORLoop` 入参零 cast**，导出契约对外行为不变。
2. `CompetitiveStrategyOrchestrator` 的 `config` 改为 `Record<string, unknown>` 传入 ⇒ 调用点**失去编译期 config 校验**（端口模式固有代价 —— 规则 4「参数照原调用点实参定」）；Impl 内 `as never` **一处**收窄并注明。
3. `ProjectArtifactStore` 原为**模块级单例** ⇒ 改为按需 `getProjectArtifactStore(storeDir)`（每次新建）；该 Store **每次读写文件**、无跨调用状态 ⇒ 无行为影响。
4. `ImplicitPersistResultDto` 只声明调用方**实际读**的 2 字段（`contexts` / `deliverables`）；其余字段运行时仍随 `...result` 展开透传。

**实测**：`已豁免` **235 → 231（−4）** · KPI **0 不变** · `R00-003` **46 不变** · 违规 **0** · `typecheck` exit 0（**一次通过**）· `lint:arch` exit 0。

**未纳入**：`project` 域在 `project-artifact-handlers` 的**动态取用**（D-111 已收）· `query` 域的 `analytics` 等（D-111 已收）。


## §3.17 R00-003 **后续治理立项**（动态跨层引用 **46 处 / 36 组合**；2026-09-30，台账 D-119）

### 3.17.1 现状与口径

- **现行口径**（§3.6.2 裁定，未变）：`R00-003` **仅 warning 级上报**、**不计入** `违规/已豁免`、**不建白名单**、不阻断提交。
- **当前实测**：**46 处 / 36 组合** —— 较 §3.6.6 的 **95 处降 49**（D-81 −3 · D-82 −13 · D-83 −6 · D-84 −1 · **C1 战役 D-85…D-117 −26**）。

### 3.17.2 结构分解（本次逐文件取证，30/30 与门禁吻合）

| 类别 | 处 | 组合 | 判定依据 |
|---|:--:|---|---|
| **① sanctioned 缝**（设计即如此） | **16** | `runtime (service) → <16 个 app 模块>` 各 1 | C1 战役的**唯一 sanctioned 缝** `CoreAPIImpl`（`await import('@modules/<app>')`）—— 与 `core/spi/*Service` **同类**：机制本体 |
| **② SPI 机制**（设计即如此） | **3** | `core → monitoring` ×2（`OTelService` / `LoggerService` SPI）· `core → performance` ×1（`ProfilerService` SPI） | `registerXxxSpi()` 内动态导入实现（§3.6.6 判读 2 已确立） |
| **③ 装配缝**（保留） | **1** | `bridge → tasks` ×1（`ModuleBridgeSetup`） | §3.6.7 C5-1 已判：已包成窄接口 `ModuleBridgeDependencies` 注入 |
| **④ 装配/懒加载**（分层合理） | **6** | `modules → services` ×4 · `modules → cost` ×1 · `modules → session` ×1 | 模块生命周期 / DI 注册（`ModuleDefinitions` / `ModuleInitializer` / `DocModule` / `elicitationPrompts` / `officeHandlers`） |
| **⑤ 装配本体错层** | **1** | `modules → entrypoints` ×1（`ModuleRegistry.initializeEnvironment()` 反向调 `entrypoints/init`） | 与 D-67 / D-82 先例同类（装配宜在 entry） |
| **⑥ 真倒挂（候选治理）** | **19** | 见 §3.17.3 | infra / service 反向依赖 app，或 core 反向依赖 service / infra |
| | **46** | **36** | |

**P0 结论（零改动）**：①②③ 共 **20 处**为"**设计即如此**"，仅在 spec / 台账**登记**（**不改门禁判定、不建白名单** —— 延续 §3.6.2 裁定）⇒ 后续只面对 **26 处**（④⑤⑥）。

### 3.17.3 候选治理清单（⑥ 19 处，按**能力面**归组）

| 组 | 能力面 | 处 | 文件（行号见台账 D-119） |
|---|---|:--:|---|
| **G1** | `broadcastEvent`（← `@modules/infrastructure`） | **4** | `state/background/BackgroundTaskStateMachine` · `state/task/TaskStateMachine` · `state/app/AppLifecycle` · `core/loop/PlanDrivenLoop` |
| **G2** | `aiService` / `providerRegistry`+`modelRouter` / `BalanceStore`+`providerManager`（← `@modules/ai`） | **4** | `chronos/autoDream/AutoDream` · `chronos/maintenance/ChronosBackgroundHousekeeping` · `memory/MemoryManager` |
| **G3** | 诊断采集（← `@modules/services` ×2 · `@modules/channels` ×1） | **3** | `diagnostics/SystemHealthChecker` · `diagnostics/infrastructure-diagnostics` |
| **G4** | `runKnowledgeCompile` / `runKnowledgeLint` / `getDefaultDigestService`（← `@modules/knowledge`） | **2** | `chronos/autoDream/AutoDream` · `chronos/knowledge/knowledgeMaintenance` |
| **G5** | `pluginSystem`（← `@modules/plugins`） | **2** | `services/mcp/EnhancedMCPConfigManager` · `utils/plugins/loadPluginAgents` |
| **G6** | 杂项单点 | **4** | `constants/systemPromptSections`→skills · `modules/calendar/ScheduleHook`→runtime · `modules/doc/api/officeHandlers`→infrastructure · `permission/PermissionChecker`→runtime |
| | | **19** | |

### 3.17.4' 🔴 **P1 前提纠正（2026-09-30，立项后取证 —— 如实记录）**

立项时按"装配容器"语义预估 P1 为**零代码改动**，**实测推翻**：

- **入向（关键）**：`modules` 现归 **core** ⇒ `allowedDependencies.core = ["core"]` ⇒ **入向零约束**（任何层都允许依赖 core）。实测入向引用：
  | 来源 | 层 | 文件 | 改归 `app` | 改归 `entry` |
  |---|---|---|---|---|
  | `tools/` | app | `DependencyGraphScanner` · `DependencyValidator` · `ModuleMigrationTool` | ✅ app→app | ❌ |
  | `performance/` | **infra** | `PerformanceReportParser` · `PerformanceMonitor`（均引 `LazyModuleStrategy`） | **❌** | ❌ |
  | `core/di/DIContainer.ts:277` | core | **注释**内的 `import { moduleRegistry } from '@modules/modules/ModuleRegistry';`（D-77 同型陷阱，门禁不剥注释） | **❌** | ❌ |
  ⇒ 改归 `entry` 会使 **6 处**入向全变违规；改归 `app` 仍会使 **3 处**变违规。
- **出向**：静态仅 `core` / `tools`(app) / `tasks`(app) / `runtime`(service)（后三者现由 **BULK-011 core→service** / **BULK-012 core→app** 承接）；**动态**即 R00-003 的 `modules → services/runtime/infrastructure/cost/session/entrypoints`（**6 组合 / 9 处**，其中 `→ entrypoints` 即 §3.17.2 的 ⑤）。
- **修订后的 P1（真代码改动）**：① 改归 **`modules → app`**；② 前置修复 3 处入向 —— `DIContainer` 注释去掉"像导入语句"的路径文本（**零行为**）· `performance` ×2 的 `LazyModuleStrategy` **下沉 core**（小搬迁，须单独取证其是否被 modules 自身使用）；③ ⑤（`ModuleRegistry.initializeEnvironment()` 反向调 `entrypoints/init`）需**单独处理**（反转调用方向，或保留例外）。
- **预期收益（修订，实测后按差调 `estimatedCount`）**：`R00-003` **−8**（组合 1/13/14/15/16）· `已豁免` **≈ −8**（`modules → tools` ×4 文件 + `→ tasks` ×3 + `→ runtime` ×1）· 违规须保持 **0**。
- **结论**：P1 由"零代码高杠杆"**降级为"需 3–4 处前置修复的中等批次"**；是否仍优先于 P2 由用户重裁（见 §3.17.5）。

### 3.17.4 建议阶段（立项初版，**P1 部分已被 §3.17.4' 修订**）

| 阶段 | 内容 | 处 | 风险 |
|:--:|---|:--:|---|
| **P0** | ①②③ 登记为"设计即如此"（**零改动**，仅文档） | 20 | 无 |
| **P1** | **`modules/` 层归属复核（高杠杆）**：`modules` 现归 **core**，但其实际角色是**模块装配 / 注册容器** ⇒ 复核改归 **`entry`**（D-84 `hooks` 改归先例，**零代码改动**）。若改归，**④⑤ 共 7 处**（`modules → services/cost/session/entrypoints`）自然出清或改判；G6 中 `modules → runtime/infrastructure` 2 处亦受影响 | 7–9 | 门禁配置（可逆） |
| **P2** | **G1 `broadcastEvent` 端口化**（单能力面 ⇒ C1 同手法；或改走 `globalEventBus`，须先取证实现） | 4 | 中 |
| **P3** | **G5 `pluginSystem`**（单能力面） | 2 | 中 |
| **P4** | **G3 诊断采集**（健康检查为"观测者" ⇒ 宜经端口读取） | 3 | 中 |
| **P5** | **G2 `aiService`**（chronos/memory → ai） | 4 | 中 |
| **P6** | **G4 + G6 杂项** | 6 | 低 |

**预期**（P1 采纳 + P2–P6 全做）：`R00-003` **46 → 20**（余 ①16 + ②3 + ③1）。

> ⚠️ **`R00-003` 为 warning 级** ⇒ 上述**不影响** `违规 0` / `已豁免 231`；收益体现为**真实依赖收敛**与盲区可见度的提升。

### 3.17.5 待裁定（3 项）

1. **`modules/` 是否改归 `entry`**（P1）—— 影响 **7–9 处**，零代码改动，最像 D-84 的高杠杆动作。
2. ①②③ 的"设计即如此"**仅 spec 登记**（延续不建白名单），还是门禁加 **by-design 标注**（会改门禁判定口径，须重新裁定）。
3. 是否采纳 **P0 → P6** 的顺序。

### 3.17.6 取证说明

- 逐文件盘点由检索子代理完成，**实查 30 处 = 门禁 30 处**（20 组合逐一吻合，无差异、无凑数）。
- 计数口径复核：`parseDynamicImports` 用 `Set<string>` 收集 ⇒ **同一文件对同一目标模块的多行 `import()` 只算 1 处**；`require('…') as typeof import('…')` 的**类型位置 `import()` 计入**，`require()` 本身不计（这解释了 `state/**` 3 处与 `permission` 1 处的来源）。

### 3.17.19 🔎 **遗留盲区取证：字符串路径表（`R00-003` 视野之外），2026-09-30**

> 触发：§3.17.18 收官后，按 **D-65「把依赖藏起来不可接受」** 原则做的**只读取证**。**未改任何代码 / 门禁**，仅登记 + 报请裁定（台账 D-133）。

**门禁可见性边界（已核实）**：`parseDynamicImports` 用正则 `/import\(\s*['"]([^'"]+)['"]/g`（[`lint-architecture.ts:2506`](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-architecture.ts#L2506)）⇒ **只认字面量**；`import(变量)` / `` import(`模板`) `` **一律不匹配**（`tools/DependencyGraphScanner.extractImports:270` 同型）。

**最大盲区：`core/LazyModuleStrategy.ts:338-353` 的 `DYNAMIC_IMPORT_PATHS`（14 条字符串路径）**，唯一消费点 `:447` / `:458`（`await import(importPath)`）。该文件层 = **core**，而 `core.allowedDependencies = ["core"]` ⇒ **14 条全部构成 core → 上层**，且**门禁零可见**。

| 目标模块 | 层 | `loadMode` | 可达 | 路径实体（相对 `app/src/core/` 解析） |
|---|---|:--:|:--:|---|
| `featureflags` · `memory` · `chronos` · `lsp` · `security` | infra ×5 | ON_DEMAND | ✅ | ✅ 存在 |
| `ui` · `ink` | ui ×2 | ON_DEMAND | ✅ | ✅ 存在 |
| `voice` | service | ON_DEMAND | ✅ | ✅ 存在 |
| `remote` | service | ON_DEMAND | ✅ | 🔴 `app/src/remote/` **无 `index.ts`**（7 文件）⇒ 调用即 `ERR_MODULE_NOT_FOUND` |
| `sandbox` | app | ON_DEMAND | ✅ | ✅ 存在 |
| `mcp` | service | **CRITICAL** | ❌ | ✅ 存在 |
| `doc` | **未映射** | **CRITICAL** | ❌ | 🔴 `app/src/doc/` **不存在**（真实位置 `app/src/modules/doc/index.ts`）|
| `mail` | **未映射** | DEFERRED/BATCH | ❌ | 🔴 `app/src/mail/` 与 `modules/mail/` 均**无 `index.ts`** |
| `calendar` | **未映射** | DEFERRED/BATCH | ❌ | 🔴 `app/src/calendar/` **不存在**（真实位置 `app/src/modules/calendar/index.ts`）|

- **可达性判据**：`ModuleInitializer.requestOnDemandModule:412` 先做 `isModuleOnDemand()` 校验 ⇒ 只有 `LAZY_MODULE_STRATEGY` 中标 `loadMode: ON_DEMAND` 的 **10 个**能走到 `requestModule()`；`mcp`/`doc`/`mail`/`calendar` **4 条为死条目**（永不可达）。
- **休眠证据**：`requestOnDemandModule` 全仓**无调用方**（仅 `modules/index.ts:60` 再导出）⇒ ON_DEMAND 通道**当前整体未激活** ⇒ 上述失效路径是**潜在**故障，**非现网故障**。
- **若该表改为字面量可见**：`R00-003` 将 **+11 组合**（`core → ui`/`ink`/`voice`/`mcp`/`sandbox`/`remote`/`featureflags`/`memory`/`chronos`/`lsp`/`security`）—— `doc`/`mail`/`calendar` 因 `moduleToLayer.get()` 未命中而**仍被跳过**。

**同型扫描（全仓 `import()` 非字面量，31 行命中含注释噪声，实质约 20 处）**：除本表外多为 **外部/插件路径**（`agent/managers/PluginLoader` · `core/extensibility/PluginLoader` · `modules/ImportManager` · `evals/sourceTask`（生成代码串））或 **同层路径表**（`LocalHTTPServiceHelpers` · `channels/setupChannels` · `channel-handlers` 的**三份**通道路径表 = service→service，**合法**；⚠️ 该三份（实为 **4 份**，含 `ALL_CHANNEL_DEFS`）**已于 2026-09-30 收敛为单一事实源** `channels/ChannelCatalog.ts`，并顺带修复"23/26 条漂移"缺陷 —— 见台账 **D-134**；`channels/ChannelCatalog` 已按本文件惯例登记进 `canonicalEntryKeys`）；`commands/loader/*` · `commands/builtin/command-registry` · `tools/utils/OptimizedToolManagerUtils` 为**参数化路径**（静态不可判）⇒ 需逐点取证（**本轮未做**）。

**待裁定（4 项）**

| # | 选项 | 影响 |
|:--:|---|---|
| A ✅ | **字符串表 → thunk 表**（`() => import('../ui/index.js')`），并清理失效条目 | 零门禁改动、零启发式 ⇒ 依赖**原生可见**（实测 `R00-003` **18 → 28**，**数字变差但真实**，与 D-65 原则一致）；惰性不变 |
| B | **扩展门禁**（同文件含 `import(变量)` + 相对路径字符串字面量 ⇒ 并入 `R00-003`） | 覆盖所有同型；但属**启发式**，有误报风险（注释 / 外部路径）|
| C ✅ | **仅清理失效 4 条**（删 `doc`/`mail`/`calendar`，`remote` 修或删） | 零门禁影响；止血潜在故障 |
| D | **不动，仅登记** | — |

**✅ 已裁定并执行（2026-09-30，用户裁定「A+C 组合」，不采纳 B）**：`DYNAMIC_IMPORT_PATHS`（字符串）→ **`DYNAMIC_IMPORT_LOADERS`（字面量 thunk）**共 10 条；删除 4 条失效条目（`remote`/`doc`/`mail`/`calendar`）；删除零消费的 `getDynamicImportPath()`；`requestModule()` 改 `await loader()`。**四证**：`typecheck` **exit 0** · `lint:arch` **违规 0 / 已豁免 220（均不变）/ `R00-003` 18 → 28** · `eslint` **0 problem** · `bun test src/core` **47 pass / 0 fail**。（⚠️ 实测 **+10** 而非上文预测的 +11 —— `remote` 随 C 一并删除。）详见台账 **D-133**。

### 3.17.18 ✅ **收口小结（`R00-003` 治理收官，2026-09-30）**

> ⚠️ **数值口径同步（2026-09-30 · D-133 / §3.17.19）**：下文的 **18** 是**该批次收官时点**的值；把 `LazyModuleStrategy` 的字符串路径表改为**字面量 thunk** 后，`R00-003` = **28**（**+10 = 由"隐藏"转为"可见"**，**非新增违规**；`违规 0` / `已豁免 220` 均不变）。

**结论**：`R00-003` **95（§3.6.6 基线）→ 46（治理前）→ 18**；**三类真实错层（②/⑤/⑥）全部归零**，剩余 18 处**均为"设计即如此"或测试文件**。

| 类别 | 治理前 | 现在 | 说明 |
|---|:--:|:--:|---|
| ⑥ 真倒挂 | 19 | **0** | P1–P6-b 逐批消除 |
| ⑤ 装配本体错层 | 1 | **0** | P6-c：惰性回调注入（不改启动时序） |
| ② SPI 家族 | 9 | **0** | P6-d/P6-e：**推送模型**（实现体迁 `entrypoints/spiWiring.ts`） |
| ① sanctioned 缝 | 16 | 16 | **设计如此** —— C1 战役的服务层端口缝（`runtime → app`） |
| ③ 装配缝 | 1 | 1 | **设计如此** —— 装配点保留 |
| 入向（`core/__tests__` → `modules`） | 1 | 1 | **测试文件**（非产品路径，仅 warning） |

**阶段账（10 批，逐批实测）**：

| 批 | 内容 | `R00-003` |
|:--|---|---:|
| P1 | `modules` 归 app + `LazyModuleStrategy` 下沉 core | 46 → 39 |
| P2 | G1 `broadcastEvent` SPI 化 | 39 → 36 |
| P3 | G5 `pluginSystem` SPI 化 | 36 → 35 |
| P4 | G3 诊断采集 SPI 化 | 35 → 34 |
| P5 | G2 AI 能力访问 SPI 化 | 34 → 31 |
| P6-a | G4 知识运维 SPI 化 | 31 → 30 |
| P6-b | G6 杂项（迁 `skills` + entry 注入） | 30 → 28 |
| P6-c | ⑤ 装配错层（惰性回调注入） | 28 → 27 |
| P6-d | ② 推送模型（第一批） | 27 → 24 |
| P6-e | ② 推送模型（全量） | 24 → **18** |

**同时期门禁面**：`R00-001` **违规全程 0** · `已豁免` 现值 **220** · `R03-002` **0** · `lint:arch` 错误 0 / 警告 2 · 退出码 **0**。

**纪律沉淀（本项新增，均已在台账留痕）**：

- **规则 41**：门禁统计单元是「**文件 × 目标模块**」，不是"语句组/处数"（P2、P3、D-117 三次据此纠正预估）。
- **规则 43**：改**层归属**前必须做「**出向 + 入向**」双向取证 —— P1/P4/P5 三次据此**否决**了 `chronos`/`memory`/`diagnostics` 的"改归"路线（入向含 infra/service 消费方 ⇒ 反增违规）。
- **规则 44**：**验证命令（`RunCommand`）不得与 `Edit` 同批** —— 并发会读到**中间态**（P6-e 出现 1 处假报错 `TS2554`，顺序复跑即消失）。
- **D-77 家族**：注释中**不得复写**完整导入路径 —— 门禁 `parseModuleImports` **不剥离注释**，写了会让「对」假复活（本战役共踩 3 次，均已修）。

**未做（可选，均已登记台账，不阻塞收官）**：

1. `mcp` 模块归属裁决（处 `project_rules.md §1.11` 红线邻域，见 §3.5.x）；
2. `BootstrapOptions` **双声明归一化**（`core/di/types.ts` ↔ `modules/ModuleRegistry.ts`，CS01 欠账，台账 D-127 附注）；
3. 沙箱放开后复跑 `bun test` 全量（本项全程未跑单测，验收依赖四证）。

### 3.17.17 ✅ **P6-e 已执行实测（② **推送模型**改造 · 第二批（全量）—— 🎯 **② 归零**，2026-09-30，台账 D-129）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | 未变 |
| `R00-003` 动态 | 24 | **18** | **−6**（三件套 **3** + 广播 **1** + 插件 **1** + 知识 **1** 全部消除；**零新增对**）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**改动（7 文件 + 1 追加）**：
1. `entrypoints/spiWiring.ts` **追加 6 个实现体**：Logger / OTel / Profiler / Broadcast / PluginSystem / Knowledge；
2. `core/spi/{LoggerService, OTelService, ProfilerService, BroadcastService, PluginSystemService, KnowledgeService}.ts` —— 签名改 `registerXxxSpi(container, impl)`，**移除全部反向动态导入**；
3. `core/di/DIContainer.ts` —— 移除 **6 个旧注册块**，整段仅保留 **1 次** `registerSpis` 回调；
4. `core/spi/KnowledgeService.ts` 顺带清理失效的 `resolveAiAccess` 导入。

**顺序保持**：装配体内顺序 = 原 `DIContainer` 顺序（Logger → OTel → Profiler → 广播 → 插件 → AI → 诊断 → 知识）⇒ **注册时序不变**；`Knowledge` 对 `AiAccess` 的依赖在文件内已满足。

**⚠️ 过程教训（新增规则 44）**：**不得把 `RunCommand` 验证与 `Edit` 放同一批** —— 并发执行会读到**中间态**；本轮即出现 1 处**假报错**（`DIContainer.ts(334,15): TS2554: Expected 2 arguments, but got 1`），**顺序执行后消失**（实测 `TSC=0`）。

**🎯 里程碑**：**② SPI 家族归零**（9 → 0）；`core/spi/**` 内 `await import('../…')` **grep 零残留** ✓。

**P6-e 后 `R00-003` 结构（18 处）**：① sanctioned 缝 **16** · ② **0** · ③ 装配缝 **1** · ⑤ **0** · ⑥ **0** · 入向（`core/__tests__` → `modules`，**测试文件**）**1**。
⇒ **仅剩"设计即如此"与测试**：① 16（C1 战役的 sanctioned 缝）· ③ 1（装配缝）· 测试入向 1。

### 3.17.16 ✅ **P6-d 已执行实测（② **推送模型**改造 · 第一批，2026-09-30，台账 D-128）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | 未变 |
| `R00-003` 动态 | 27 | **24** | **−3**（`core -> ai` ×1 + `core -> services` ×1 + `core -> channels` ×1 **消除**；**零新增对**）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**机制（推送模型 = 实现体主动注册）**：

| 环节 | 改造前 | 改造后 |
|---|---|---|
| 实现体位置 | `core/spi/Xxx.ts`（**core**）内动态导入 `ai`/`services`/`channels` | **`entrypoints/spiWiring.ts`（entry）** —— entry 可依赖任意层 ⇒ **零跨层对** |
| SPI 文件签名 | `registerXxxSpi(container)`（自导自建） | `registerXxxSpi(container, impl)` —— **只收实现体** |
| 调用点 | `DIContainer.bootstrap()` 内逐块 `await registerXxxSpi(this)` | 同一位置，改调 `BootstrapOptions.registerSpis(this)`（**回调由入口注入**）|
| 时机 | 逐个 await | **不变**（调用点即原注册点；实现体内部仍惰性导入）|

**改动（7 处 / 6 文件 + 1 新建）**：① **新增** `entrypoints/spiWiring.ts`（AI 能力访问 + 诊断采集两个实现体）；② `core/spi/AiAccessService.ts`；③ `core/spi/DiagnosticsProbeService.ts`；④ `core/di/DIContainer.ts`（两块 → 1 次回调）；⑤ `core/di/types.ts` + ⑥ `modules/ModuleRegistry.ts`（`BootstrapOptions.registerSpis`，**双声明同步**）；⑦ `main.ts`（注入惰性 thunk）。

**收益**：② 由 **9 → 6**；`core/**` 内 `await import('../ai|../services|../channels')` **grep 零残留** ✓。

**本批范围（= 已批准预期 −3）**：`AiAccessService`（P5）+ `DiagnosticsProbeService`（P4）。

**⚠️ 剩余 6 处（同一机制可直接套用，未做）**：`LoggerService` / `OTelService` / `ProfilerService`（**三件套，既有**）+ `BroadcastService`(P2) + `PluginSystemService`(P3) + `KnowledgeService`(P6-a)
⇒ 若全数迁移，`R00-003` 可再 **−6（24 → 18）** 且 **② 归零**。

**P6-d 后 `R00-003` 结构（24 处）**：① **16** · ② **6** · ③ **1** · ⑤ **0** · ⑥ **0** · 入向（测试文件）**1**。

### 3.17.15 ✅ **P6-c 已执行实测（⑤ 装配本体错层消除，2026-09-30，台账 D-127）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | 未变 |
| `R00-003` 动态 | 28 | **27** | **−1**（`modules → entrypoints` 消除；**零新增对**）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**问题（⑤ 装配本体错层）**：`modules/ModuleRegistry.ts`（app）的 `initializeEnvironment()` 内**动态导入** `../entrypoints/init` 并调用 `init()` ⇒ `app -> entry` 跨层引用。

**方案（**惰性回调注入** —— 不改启动时序）**：
1. `BootstrapOptions` 增 `initializeEnvironment?: () => Promise<void>`（⚠️ **两处声明须同步**：`modules/ModuleRegistry.ts` + `core/di/types.ts`，见下方附带发现）。
2. `ModuleRegistry.initializeEnvironment(init?)` —— 改用**注入回调**；未注入 ⇒ 跳过（原 `catch` 降级语义保留）。
3. `DIContainer.bootstrap()` **透传**该回调；**`main.ts`（entry）注入惰性回调**（回调体内再 `await import('./entrypoints/init')`）⇒ 与原先的**加载时机逐字一致**（原实现本身即动态导入）⇒ **启动时序零变化**。

**⚠️ 附带发现（预存问题，已登记）**：`BootstrapOptions` **存在两处独立声明** —— `core/di/types.ts:53` 与 `modules/ModuleRegistry.ts:349`，二者**结构须人工保持一致**（本次仅改一处即触发 **3 处** `TS2353`/`TS2339`）。属 CS01 归一化欠账，待专项合并（不影响门禁）。

**P6-c 后 `R00-003` 结构（27 处）**：① sanctioned 缝 **16** · ② SPI 机制 **9** · ③ 装配缝 **1** · ⑤ **0** · ⑥ **0** · 入向（`core/__tests__` → `modules`，**测试文件**）**1**。
⇒ **仅剩**：① 设计缝（16）+ ② SPI 家族（9）+ ③ 装配缝（1）+ 测试入向（1）。

### 3.17.14 ✅ **P6-b 已执行实测（G6 杂项 2 处 —— 🎯 **⑥ 真倒挂归零**，2026-09-30，台账 D-126）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | 未变 |
| `R00-003` 动态 | 30 | **28** | **−2**（G6-a / G6-b 各 **−1**，且**零新增对**）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**G6-a（`constants → skills`，1 处）—— 取路线 ①**：
- ⚠️ **前置澄清（关键，解释了 R03-002 长期为 0）**：`constants` **不在 `checkModuleSingleExport.moduleRoots` 名单中** ⇒ 其**静态子路径导入不被检查** ⇒ 可安全用**静态**导入取单例（无 R03-002 风险）。
- `initBuiltinSkills` / `reloadUserSkills` **迁入 `skills/BuiltinSkillBootstrap.ts`**：加载器 / 类型 / `BuiltinEnabledStore` 变**同模块内引用**（自洽）；**单例不动** —— 仍复用 `constants/systemPromptSections` 的 `skillRegistry` / `skillInjectionService`（`app → infra` **合法**、**不新增对**，且**避免出现第二份注册表**）。
- 调用方重接：`entrypoints/init.ts`（entry → app ✓）· `skills-handlers`（**service**）改经**新建** `runtime/api/skillsOpsPorts.ts` + `CoreAPIImpl.getSkillsOpsPort()`（`runtime → skills` 属**既有 sanctioned 缝 ①**，**不新增对**）。
- 顺带清理：`constants/systemPromptSections.ts` 移除 `getSkillHub` / `loadBuiltinEnabled` 两个静态导入（唯一用途均在迁走的函数内）。

**G6-b（`permission → runtime`，1 处）—— 取路线 ④**：
- `PermissionChecker` 新增 `PermissionRuntimeDeps` + `setPermissionRuntimeDeps()`；两处 `await import('@modules/runtime/…')` 改为读**注入依赖**（未注入 ⇒ **显式降级**，与原 `catch {}` 同语义）。
- **入口** `entrypoints/init.ts` 注入 runtime 依赖（`service → infra` **合法**）⇒ **零新增对**。

**🎯 里程碑**：`R00-003` 的 **⑥「真倒挂」由 19 → 0**（**全程清零**）；`R00-003` 总体 **95（§3.6.6 基线）→ 28**。

**P6-b 后 `R00-003` 结构（28 处）**：① sanctioned 缝 **16** · ② SPI 机制 **9** · ③ 装配缝 **1** · ⑤ 装配本体错层 **1** · ⑥ **真倒挂 0** · 入向（`core/__tests__` → `modules`，**测试文件**）**1**。

**剩余可选项（已登记，未做）**：② 的 **9 处**为 SPI 家族（"设计即如此"）—— 若改**推送模型**（provider 主动注册）可再 **−3**（P4 +2 · P5 +1）；⑤ 装配本体错层 1 处（`ModuleRegistry → entrypoints/init`）待专项。

### 3.17.12 ✅ **P6-a 已执行实测（G4 知识运维 SPI 化，2026-09-30，台账 D-125）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | 未变 |
| `R00-003` 动态 | 31 | **30** | **−1**（2 处转合法；SPI 自身新增 `core → knowledge` **1 处**）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**方案**：第 **8** 个 SPI（`core/spi/KnowledgeService.ts`）—— `runCompile(options)` / `runLint()` / `buildDigest()`。
⚠️ **关键设计**：`aiService` **经 `AiAccessService` SPI 取得**（同目录 `core → core`，**不额外产生跨层对**）—— 若此文件自建 `ai` 动态导入会**多算 1 对**（P5 的同类结论）。

**改动（5 处 / 5 文件）**：① 新增 `core/spi/KnowledgeService.ts`；② `core/spi/index.ts` 导出；③ `core/di/DIContainer.ts` 注册（**第 8 个 SPI**）；④ `chronos/autoDream/AutoDream.ts`；⑤ `chronos/knowledge/knowledgeMaintenance.ts`（**3 个动态导入 + 编译/摘要/巡检 3 处调用 → 3 次端口调用**）。

**P6-a 后 `R00-003` 结构（30 处）**：① sanctioned 缝 **16** · ② SPI 机制 **9** · ③ 装配缝 **1** · ⑤ 装配本体错层 **1** · ⑥ 真倒挂 **2** · 入向（`core/__tests__` → `modules`）**1**。

### 3.17.13 ✅ **P6-b 路线（**已裁定 ①+④**；执行记录见 §3.17.14）**

> 状态更新（2026-09-30）：本节原为「⏸ 路线待裁定」，用户已选 **①+④** 并于 §3.17.14 执行完毕
> （`R00-003` 30 → 28，⑥ 归零）。下表保留为**决策依据**。

| 项 | 现状 | "迁 entry" 可行性 | 候选路线（含计数） |
|---|---|---|---|
| **G6-a** `constants → skills`（1 处动态）| `initBuiltinSkills` / `reloadUserSkills` 定义在 `constants/systemPromptSections.ts`（**infra**） | ❌ **被入向证据否决**：`reloadUserSkills` 的调用方含 **service** 层 `infrastructure/http/handlers/skills-handlers.ts`（`service → entry` **非法**）| **①** 两函数**迁入 `skills`** + 为 service 调用方新建 `runtime/api/skillsOpsPorts.ts` + `CoreAPIImpl.getSkillsOpsPort()`（`runtime → skills` 属**既有 sanctioned 缝 ①**，**不新增对**）⇒ **R00-003 −1**<br>**②** 新建 core SPI（`core → skills` +1）⇒ **0** |
| **G6-b** `permission → runtime`（1 处动态）| `PermissionChecker`（**infra**）动态取 `unattendedMode` / `inboxManager`（runtime = **service**）| n/a（非层归属问题）| **③** 新建 core SPI（+1）⇒ **0**<br>**④** **启动注入**：entry 把 runtime 依赖注入 permission（`service → infra` **合法**）⇒ **零新增对** ⇒ **R00-003 −1** |

**计数**：取 **①+④** ⇒ `R00-003` **30 → 28**；取 **②+③** ⇒ **30 不变**（仅把 ⑥ 的 2 处挪进 ② 的"设计即如此"）。

### 3.17.11 ✅ **P5 已执行实测（G2 **AI 能力访问** SPI 化，2026-09-30，台账 D-124）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | **未变**（静态 `credentialStore` / `trackUsage` 导入按本批范围保留）|
| `R00-003` 动态 | 34 | **31** | **−3**（**4 处**转合法；SPI 自身新增 `core → ai` **1 处**）|
| `R03-002` 子目录 import | 0 | **0** | ✓（`core/spi` 为规范子入口）|
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**规则 43 双向取证（前置，**否决"改归"路线 ×2**）**：
- **`chronos` 改归 app** ⇒ **入向**含 **infra** 的 `daemon/CronBridge`、`monitoring/archival/archivalCronTask` 与 **service** 的 `services/BridgeChronosIntegration` ⇒ **反增 3 处违规** ❌
- **`memory` 改归 app** ⇒ **入向**含 `voice/*`、`constants/systemPromptSections`、`security/scanner/secret`、`session/bootstrap`、`services/{teamMemorySync,prompt/*}` 等 ⇒ 更多 ❌
⇒ 二者**确为 infra**（被 infra / service 广泛消费），只能走端口。

**方案**：第 **7** 个 SPI（`core/spi/AiAccessService.ts`），与既有 6 个**同构**；**4 处合并进单文件**（⚠️ 若按能力拆多个 SPI 文件，每个文件各计 1 个 `core → ai` 对 ⇒ 计数更差，故合并）。

- **端口面 = 4 项能力**：`getAiService()`（知识编译）· `listActiveProviders()` + `refreshProviderBalance(id, baseUrl, apiKey, threshold)`（余额刷新，**原子**：查询 + 落库）· `chatWithRole(role, messages, options)`（按角色解析模型 + 匹配 provider 后调用）。
- **未注册 ⇒ 空值 / 空数组** ⇒ 消费方各自的既有降级路径生效（编译跳过 · 余额跳过 · 记忆精选降级 top-K）。
- `chatWithRole` 返回 **`raw`（原样透传）** ⇒ 调用方 `trackUsage(...)` 行为**逐字不变**。

**改动（7 处 / 7 文件）**：① 新增 `core/spi/AiAccessService.ts`；② `core/spi/index.ts` 导出；③ `core/di/DIContainer.ts` 注册（**第 7 个 SPI**）；④ `chronos/autoDream/AutoDream.ts`；⑤ `chronos/knowledge/knowledgeMaintenance.ts`；⑥ `chronos/maintenance/ChronosBackgroundHousekeeping.ts`（3 个动态导入 + 整段余额循环 → **2 次端口调用**）；⑦ `memory/MemoryManager.ts`（provider/chat/trackUsage → **1 次端口调用 + `raw` 透传**）。

**保留（范围外，静态 ⇒ 属 `已豁免`）**：`chronos/maintenance` 的 `import { credentialStore, CRED_STORED_MARKER } from '@modules/ai'` 与 `memory` 的 `import { trackUsage } from '@modules/ai'` —— **静态**导入属 R00-001（非 R00-003）⇒ 按本批范围保留，故 `已豁免` 未变。

**P5 后 `R00-003` 结构（31 处）**：① sanctioned 缝 **16** · ② SPI 机制 **8** · ③ 装配缝 **1** · ⑤ 装配本体错层 **1** · ⑥ 真倒挂 **4** · 入向（`core/__tests__` → `modules`）**1**。

**后续项（已登记）**：**推送模型**（provider 主动注册 ⇄ core 侧注册表）可把 ② 的新增对（P4 **+2** · P5 **+1**）一并消掉 ⇒ 理论再 **−3**。

### 3.17.10 ✅ **P4 已执行实测（G3 诊断采集 **SPI 化**，2026-09-30，台账 D-123）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | 未变（本批仅动动态面）|
| `R00-003` 动态 | 35 | **34** | **−1**（3 处转合法；SPI 自身新增 `core → services` + `core → channels` **2 处**）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**规则 43 双向取证（前置，否决了"改归"路线）**：评估过 **`diagnostics` 改归 `service`**（这样 `→ services` / `→ channels` 全部合法）⇒ **不可行** —— 其**入向** 含 **infra** 层的 `memory/consolidation/MemoryDreamService`、`monitoring/MonitoringService`（`enterPhase`/`exitPhase`）⇒ 改归会**反向新增 2 处 `infra → service` 违规**。（`diagnostics` 现归 infra，正因它被 infra 层消费。）

**方案**：第 **6** 个 SPI（`core/spi/DiagnosticsProbeService.ts`），与既有 5 个**同构**。

- **端口面 = 只读快照**：`getProvidersSnapshot()`（`sttProviders` / `ttsProviders` / `channelNames`）+ `getMcpSnapshot()`（`serverCount` / `toolCount`）—— 恰为两处消费点**所需字段**。
- **逐能力隔离异常**：SPI 实现内对 3 个 provider **各自** try/catch → `[]`，**保留原调用点的隔离语义**（任一 provider 未初始化不影响其余）。
- **未注册 ⇒ 空快照**（等价于原 `catch → []` 与"未初始化"分支）。

**改动（5 处 / 5 文件）**：① 新增 `core/spi/DiagnosticsProbeService.ts`；② `core/spi/index.ts` 导出；③ `core/di/DIContainer.ts` 注册（**第 6 个 SPI**）；④ `diagnostics/infrastructure-diagnostics.ts`（**3 个 try + dynamic-import 块 → 1 次快照调用**）；⑤ `diagnostics/SystemHealthChecker.ts`（`await import('@modules/services/mcp')` → `getMcpSnapshot()`）。

**收益 vs 预测**：预测 `R00-003 → 33`；实测 **→ 34**（差 1 —— SPI 自身引入 **2 处**（`core → services` · `core → channels`），比原 3 处仅少 1）⇒ ② 由 **5 → 7 处**。

**后续项（更彻底，需三方改动 ⇒ 本批未做）**：让 3 个 provider **主动推送**健康数据到 core 侧注册表（**推送模型**），可把新增的 2 处 `core → *` 也消掉 ⇒ 理论可再 **−2**；代价是 `services/mcp` / `services/voice` / `channels` 各需一处注册调用。已登记为 ⑥ 之外的候选优化。

**P4 后 `R00-003` 结构（34 处）**：① sanctioned 缝 **16** · ② SPI 机制 **7** · ③ 装配缝 **1** · ⑤ 装配本体错层 **1** · ⑥ 真倒挂 **8** · 入向（`core/__tests__` → `modules`）**1**。

### 3.17.9 ✅ **P3 已执行实测（G5 `pluginSystem` **SPI 化**，2026-09-30，台账 D-122）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 220 | **220** | **未变**（`utils/plugins` 的 `LoadedPlugin` **静态类型位**按本批范围保留）|
| `R00-003` 动态 | 36 | **35** | **−1**（`services/mcp` ×1 + `utils/plugins` ×1 转为 `→ core/spi` 合法；SPI 自身 `core → plugins` ×1）|
| `R03-002` 子目录 import | 0 | **0** | ✓ |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**方案**：第 **5** 个 SPI（`core/spi/PluginSystemService.ts`），与既有 4 个**同构**。

- **端口面 = 最小投影**：`getLoadedPlugins(): LoadedPluginBriefDto[]` —— 字段（`name` / `path` / `agentsPaths?` / `mcpServers?`）**恰为两处消费方实际读取**者（规则 24/31）。
- **未注册 ⇒ 返回空列表**（与两处消费方既有 `catch → []` 语义对齐；不同于 Broadcast 的静默丢弃，因"无插件"本就是合法空集）。
- `utils/plugins/loadPluginAgents` 的下游 `parseAgentFromMarkdown` / `parseAgentsFromJson` 需**完整** `LoadedPlugin` ⇒ 在**边界处收窄**（`as LoadedPlugin[]`）并**保留**其静态类型位（故 `已豁免` 未变）。

**P3 后 ② 由 4 → 5 处；`R00-003` 结构（35 处）**：① sanctioned 缝 **16** · ② SPI 机制 **5** · ③ 装配缝 **1** · ⑤ 装配本体错层 **1** · ⑥ 真倒挂 **11** · 入向（`core/__tests__` → `modules`）**1**。

**范围外（合法，明确不改）**：`import('@modules/plugins')` 仍存 **4 处** —— `entrypoints/init`（entry ✓）· `commands/builtin/plugins` ×2（app → app ✓）· `runtime/api/CoreAPIImpl`（service → app，即 **C1 战役的 sanctioned 缝 ①**）⇒ 均**不构成倒挂**，无收口必要。

### 3.17.8 ✅ **P2 已执行实测（G1 `broadcastEvent` **SPI 化**，2026-09-30，台账 D-121）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | ✓ |
| `R00-001` 已豁免 | 221 | **220** | **−1**（`daemon/CronBridge` 静态 `infra → infrastructure` 转入 SPI 端口）|
| `R00-003` 动态 | 39 | **36** | **−3**（`state/**` ×3 + `core/loop/PlanDrivenLoop` ×1 转为 `→ core/spi`（infra/core 内自洽）；新增 SPI 自身 `core → infrastructure` ×1）|
| `R03-002` 子目录 import | 0 | **0** | ✓（`core/spi` 已登记规范子入口）|
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**方案**：与 `LoggerService` / `OTelService` / `ProfilerService` **同构的 SPI** —— 新增 `core/spi/BroadcastService.ts`（`IBroadcastService` 端口 + **转发代理** `resolveBroadcast()` + `registerBroadcastSpi()`），在 `DIContainer.start()` 内**动态导入** `infrastructure/http/LocalHTTPServiceSSE` 后注入。**未注册 ⇒ 静默 noop**（与各调用点既有 try/catch 语义一致）。

**改动（9 处）**：
1. **新增** `app/src/core/spi/BroadcastService.ts`。
2. `core/spi/index.ts` 导出（与三件套并列）。
3. `core/di/DIContainer.ts` 注册（**第 4 个 SPI**，与前三者同构）。
4. `core/loop/PlanDrivenLoop.ts`：`await import('@modules/infrastructure')` → `resolveBroadcast().broadcast(...)`（相对导入 `../spi/index.js`）。
5. `state/app/AppLifecycle.ts` · `state/task/TaskStateMachine.ts` · `state/background/BackgroundTaskStateMachine.ts`：删 `require('@modules/infrastructure/http/LocalHTTPServiceSSE') as typeof import(...)` → `resolveBroadcast().broadcast(...)`。⚠️ **D-77 同型陷阱再获印证**：`require(...) as typeof import(...)` 的**类型位置 `import()` 同样被 `R00-003` 计入**。
6. `daemon/CronBridge.ts`：静态 `import { broadcastEvent } from '@modules/infrastructure'` → `@modules/core/spi`（**同层双轨消除** —— infra 层原有两条广播路径合一）。
7. `scripts/lint-architecture.ts`：`canonicalEntryKeys` 登记 **`core/spi`**（SPI 端口目录；infra/core 消费方须按端口精确导入，避免拉入 core 桶整图）。

**收益 vs 预测**：预测 `R00-003 39 → 35`；实测 **→ 36**（差 1，因 **SPI 自身**新产生 `core → infrastructure` 1 处动态跨层）—— 与 **②** 的 SPI 三件套**同类，属"设计即如此"**。⇒ ② 由 **3 处增至 4 处**。

**P2 后 `R00-003` 结构（36 处）**：① sanctioned 缝 **16** · ② SPI 机制 **4** · ③ 装配缝 **1** · ⑤ 装配本体错层 **1** · ⑥ 真倒挂 **13** · 新增入向（`core/__tests__` → `modules`）**1**。

**明确不改（范围外）**：`broadcastEvent` 在 **app 层**（`ai/` · `chat/` · `dream/` · `knowledge/` 等）与 **service 层**（`runtime/` · `session/`）的直接调用**保持不变** —— 这两类为**同层或向下**（合法，不产生跨层引用）；仅"**低于 service 层**"的消费方（infra / core）迁到 SPI。

### 3.17.7 ✅ **P1 已执行实测（2026-09-30，台账 D-120）**

| 指标 | 前 | 后 | 说明 |
|---|:--:|:--:|---|
| `R00-001` 违规 | 0 | **0** | 保持 ✓ |
| `R00-001` 已豁免 | 231 | **221** | **−10**（`modules` 出向 `tools`×4 文件 / `tasks`×3 / `runtime`×1 转为合法；另有 2 处随 `tools`/`performance` 导入路径改写而稳定）|
| `R00-003` 动态 | 46 | **39** | **−7**（出向 5 组合 −8：`services`4/`cost`1/`session`1/`runtime`1/`infrastructure`1；入向 新增 +1：`core/__tests__/DIContainerIntegration.test.ts` → `modules`）|
| `R03-002` 子目录 import | 0 | **0** | 期间一度 +5（`@modules/core/LazyModuleStrategy`），已按既有机制**登记为规范子入口**后归零 |
| 门禁汇总 | 错误 0 / 警告 2 | **错误 0 / 警告 2** | 退出码 **0** |

**落地（11 处改动）**：
1. `scripts/modules-to-layers.json`：`modules` 层 **core → app**（含 rationale 注释）。
2. `modules/LazyModuleStrategy.ts` → **`core/LazyModuleStrategy.ts`**（**迁移**，非复制；该文件仅依赖 `core/profilerFacade` + `core/loggerFacade` ⇒ core 内自洽）。原因：`performance`(infra) 引其**值** `deferredLoader`（非仅类型）⇒ 若不迁走，`modules` 改归 app 后仍构成 infra→app 静态倒挂。
3. 5 处导入点改 `@modules/core/LazyModuleStrategy`（`modules/index` · `modules/ModuleInitializer` · `tools/DependencyValidator` · `performance/PerformanceMonitor` · `performance/PerformanceReportParser`）。
4. 2 处**注释**去路径文本（`core/di/DIContainer.ts` · `core/extensibility/ModuleManager.ts` ×2 —— D-77 同型陷阱：门禁不剥注释）。
5. 2 处**失效注释**随迁移更新路径（`core/spi/ProfilerService.ts` · `core/profilerFacade.ts`）。
6. `scripts/lint-architecture.ts`：`canonicalEntryKeys` 登记 **`core/LazyModuleStrategy`**（与 `core/systemgraph` 同属"循环安全子入口"：叶子级、避免 core 桶把 `core/loop/PlanDrivenLoop`→`tasks` 链路拉入 `performance` 与模块加载路径）。

**经验沉淀（规则 43）**：**改层归属前必须做「双向」取证** —— ① **出向**（该模块依赖哪些层）② **入向**（**哪些层依赖它**）。本项立项时只看出向（"装配容器"语义）⇒ 误判为"零代码"；实测入向（`performance`/`core` 共 3 文件 + 1 注释）才是真正的成本所在。**归 core 的模块入向零约束，改归 app/entry 会把入向全部翻成违规。**

**遗留（不在本批）**：① `scripts/lint-architecture.ts` 自身 **6 项 eslint warning**（`any` ×1、unused `fullLine` / `MODULE_ROOTS`）—— **存量**；其 2 项 prettier 已按方案 A 口径 `eslint --fix` 修掉（**证据更正**：HEAD 探针为 **1 error + 6 warning**，本批修改后一度为 2 error + 6 warning ⇒ 多出的 1 项 prettier 在 L352；**因 HEAD 版不含本战役的 R00-003 实现（§3.6 / D-73），无法用 HEAD 精确归因到某一批**，故按口径直接修掉）；② ⑤ `modules/ModuleRegistry → entrypoints/init` 仍为 R00-003 warning（`app → entry` 跨层，属装配本体错层，待专项）；③ `performance` 主动**拉取**模块懒加载状态（`deferredLoader`）语义上仍属"观察者拉取"，可在 P5（G2 同类）复核是否改为 SPI 推送。


## §4 建议的落地批次

### 4.1 首轮（G1 最小集）
- **范围（口径 = 门禁统计单元「对」）**：**5 个「纯类型对」**——该 (文件,目标模块) 对的**全部语句均为类型导入**，收口即消除该对、可直接下调 `estimatedCount`。
  1. `app/src/core/boot/BootPipelineIntegrator.ts:17` → `ai`（`RouterTier`）
  2. `app/src/core/context/index.ts:21` → `context`（`ContextData`，export 再导出）
  3. `app/src/core/index.ts:65` → `plugin-sdk`（`Plugin`，export 再导出）
  4. `app/src/core/session/SessionStoreAdapter.ts:12` → `session`（`SessionStore`）
  5. `app/src/core/tokenBudget/UnifiedTokenTracker.ts:10` → `query`（`ContextTracker`）
- **附带说明**：全库类型语句共 **36 条**（§3.1），另有 **31 条分散在含值导入的对中**（如 `mcp/types/MCPTypes.ts:23` → `services`）。这些对**只要还残留一条值导入，收口类型语句不会改变门禁计数**，须与该对的值/实现导入一并处理才生效。
- **为何风险最低**：类型/接口仅参与编译期，**运行时零依赖**；不改运行时行为，类型擦除故不引入循环依赖风险，可用 `bun run typecheck` 直接验证。
- **预估改动面**：把类型定义下沉至 `core/types/`（或由 core 声明接口、上层实现），逐条替换 import 路径；5 个纯类型对随之消失 ⇒ 可把对应 A 类条目的 `estimatedCount` 各下调 1。

### 4.2 后续批次（按风险递增）
1. **G2 共享常量/工具（50 条）**：以 `@modules/error` 的错误基元（`AppError`/`ErrorCategory`/`ErrorSeverity`/`ErrorCodes` 等 26 条）为主，无外部依赖、可下沉 core；`lazySingleton`/`TTLCache` 等通用工具同理。中等偏低风险。
2. **G3 SPI/DI（183 条）**：以 `@modules/monitoring`（103 条，`getLogger` 占绝大多数）与 `handleError`（37 条）为主。需 core 定义 Logger/错误处理端口 + 上层实现 + 注入，或经 DI 容器（`getDIContainer`）延迟解析。中高风险，改动面大。
3. **G4 反转调用（11 条）**：`PlanDrivenLoop`/`Coordinator`/`StartupPrefetcher`/`mcp` barrel 对应用层引擎与入口能力的直接依赖。需改为事件 / 注册表 / 注入，风险最高，最后处理。

---

## §5 验收方式

1. **门禁判据**：每收口一条（消除一个 (文件,目标模块) 对），应能把 `scripts/layer-exceptions.json` 中对应 A 类条目的 `estimatedCount` **调低**；当某 pattern 归零时删除该例外条目。
2. **不得在未收口时删例外**：删/减 `estimatedCount` 必须以门禁复跑结果为准（收口前后 R00-001 计数差 = 收口条数）。
3. **复跑命令**：项目根执行 `bun run scripts/lint-architecture.ts`，要求 `错误 0`；`警告` 数 = 基线 1（R07-004） + 尚未收口的 A 类计数。
4. **类型安全**：G1/G2 收口后 `bun run typecheck` 必须通过。
5. **禁止**"临时放宽门禁"式解法（如扩大 `allowedDependencies`、把 A 类 pattern 重新登记为新例外）。

---

## §6 风险与未覆盖

- **取数通道局限**：门禁只输出前 5 条样本，218/280 条来自仓库外复刻脚本；已用「文件数/对数/样本」三项与门禁交叉校验一致（§1.5），但复刻脚本本身非门禁本体。**权威总数以门禁 218 为准。**
- **分组为静态判定**：G3/G4 的归类依据「被导入符号的形态 + 调用点」；个例如 `TTLCache`（类但通用工具）归 G2、`handleError`（函数但有副作用，依赖 Logger）归 G3，属判据边界，落地时以实际重构方案复核。
- **未覆盖**：`core -> ui` 实测为 0，但例外条目 `BULK-013`（estimatedCount=10）仍在清单中为空账，建议同步核实。
- **未覆盖**：门禁 R00-002 指出的「未登记分层映射的顶层目录」不在本 spec 范围（其文件不参与分层检查，可能隐藏更多倒挂）。
- **未覆盖**：本 spec 不含 `core -> core` 内部耦合（合法），以及 infra→app 等其他层倒挂（BULK-007/008 等，非 A 类）。

---

## §7 合规清单

| 项 | 结论 |
|----|------|
| GR01 复用既有基础设施 | 取数复用门禁本体 `scripts/lint-architecture.ts` 与 `modules-to-layers.json`，未新造判据 |
| CS01 不新造轮子 | 未新增源码/配置；枚举脚本置于仓库外临时目录，复刻门禁逻辑仅作校验 |
| R00-001 判据遵循 | 分组与计数严格按 `allowedDependencies.core=["core"]` |
| 禁用"临时放宽门禁" | 未修改 `modules-to-layers.json`；`layer-exceptions.json` 最终逐字节还原 |
| 只新增 1 个文件 | 仓库内仅新增本 spec；未改任何源码 |

---

## 附：例外条目 ↔ pattern 对照

| 例外 id | pattern | estimatedCount | 本 spec 组 |
|---------|---------|:---:|-----------|
| BULK-010 | core -> infra | 50 | 主要落在 G3（monitoring/error/config…） |
| BULK-011 | core -> service | 10 | G3（services/runtime/…） |
| BULK-012 | core -> app | 28 | G2/G3/G4（ai/tasks/tools/query/context/state/session/tool/plugin-sdk） |
| BULK-013 | core -> ui | 0 | 无实测边 |
| BULK-017 | core -> entry | 3 | G4（bootstrap/entrypoints） |
