// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
/**
 * 核心模块统一入口
 * 导出所有核心相关的类型、类和函数
 *
 * P1（2026-10-28，v3 §6.1 批次 4）：`paths`（含 fs/os 环境探测）整体迁至
 * `@modules/environment`，内核不再持有目录解析实现。此前「paths 必须最先求值」
 * 的顺序约束随之消失；内核仍保留其**零依赖叶子** `productIdentity`
 * （`ports` / `featureFlags` 与本文件都要用），并由本桶转出以维持既有导入面。
 */

export * from './productIdentity';
// `core/ids`（ID 熵源 + UUID 形态判定真源）：归属 core 供**各层**使用（`core → infra` 属分层倒挂）
export * from './ids';
// P2（2026-10-23）：按需加载器注册表 —— 宿主推送清单，内核只持机制（内核不再 import 上层）
export * from './lazy/loaderRegistry';
// 迁移注册表与版本中枢已迁至 `@modules/system/state/migration`（2026-10-23，core 减重：
// 唯一消费者在 app 层的 `/migrate` 命令；与其兄弟 `StateMigrator` 同属 state/infra 域）
// 硬编码治理 HD-P0-2：端点 / 本机 host 唯一事实源（纯常量、零副作用、零配置依赖 ⇒ 置于 paths 之后安全）
export * from './endpoints';
// 硬编码治理 B5-2-98：官方供应商 API 基址唯一事实源（纯常量、零 import、零副作用；各层共用）
export * from './providerEndpoints';
// 硬编码治理 B5-2㉘：WebSocket 握手协议常量唯一事实源（RFC 6455；纯常量、零 import、零副作用）
export * from './protocol/websocket';
// G1 收口（台账 D-77 / A5）：移除 `@modules/system/state` 的整包再导出（`export *`）——
//   零消费（删除后 `bun run typecheck` 无符号缺失），且消掉 core → system(infra) 的对边；
//   消费方一律直连 `@modules/state/*`（如 `promptSuggestion/types.ts`）。
//   ⚠️ **写法约定**：本文件及同类注释中**禁止出现"from '<包名>'"的完整导入片段** ——
//   门禁 `parseModuleImports` 的两条正则**都不剥离注释**，照抄一条 import 语句会让该依赖
//   在门禁眼里"复活"（2026-09-30 实测踩中：本行原写作 `export * from '<包名>'` 的形式，
//   导致该对边在删除后再现，靠探针才定位到）。要提及包名时只写包名本身即可。
export type {
  ProtocolMessage,
  ToolCall,
  ToolResult,
  ToolContext,
} from './types';
export * from './events/EventBus';
export * from './events/UiEvents';
export { UiEventBus, uiEventBus } from './events/UiEventBus';

export {
  BootstrapPhase,
  BootstrapPriority,
  type ModuleBootstrapper,
  type ModuleLifecycle,
  type BootstrapperModule,
  type BootstrapProgress,
} from './ModuleBootstrapper';
export {
  DIContainer,
  getDIContainer,
  resetDIContainer,
  ContainerScope,
  CycleDetector,
  AutoWiringEngine,
  DisposeManager,
  DEFAULT_CONTAINER_CONFIG,
  type ServiceScope,
  type ContainerConfig,
  type ServiceDescriptor,
  type CycleDetectionResult,
} from './DIContainer';
// `DIContainer.bootstrap(moduleRegistry, options)` 的公开参数类型：宿主（app）要按它装配，
// 但只需类型 ⇒ 走 `export type`（编译期擦除，零运行时求值），消费方无需深路径。
export type { BootstrapOptions } from './di/types';
// J-7 清理：旧版 PluginSDK 双轨已删除（@deprecated 由 pluginSystem 统一替代），re-export 一并移除
// G1 收口（台账 D-59）：`Plugin` 的再导出亦移除——core 不得转出 app 层 plugin-sdk 类型（消费方直连 @modules/plugin-sdk，
//   且 plugin-sdk 自身有「零反向引用」红线，故不能反向下沉到 core）
// P2（2026-10-28，v3 §6.1）：`Coordinator`（多 Agent 并行编排，Q3 任务语义）迁 `@modules/runtime/coordinator`。
// G1 收口（台账 D-59）：移除 core → app(context) 的 ContextData 再导出（无消费方，消费方直连 @modules/context/types/ContextData）
// G1 收口（台账 D-77 / A5）：同批移除 `AuthManager` / `AuthConfig` 的 core → system 再导出（零消费，
//   与上方 `system/state` 同属 `(core/index.ts × system)` 这一对 —— 同对语句须一次搬净）。
// 2026-09-30（台账 D-77 / A4）：`core/notifications/NotificationService.ts` 零消费（全仓含测试无引用）
//   且构成 core → infra(`state`) 倒挂 ⇒ 按 D-59/D-70 先例删除该文件，此处再导出一并移除。

export {
  FEATURE_FLAGS,
  feature,
  isFeatureEnabled,
  getToolFlag,
  TOOL_FLAG_KEYS,
  type FeatureFlag,
  // P3（2026-10-23）：变体层由宿主注入（内核不再 import 构建期生成物）
  setBuildVariantFlags,
  isBuildVariantFlagsInitialized,
  getBuildVariantFlags,
  resetBuildVariantFlags,
} from './featureFlags';

// 2026-08-29 R03-002 收敛：子模块统一出口
export * from './data-models';
export * from './ports';
// P2（2026-10-28，v3 §6.1）：验收标准（`successCriteria`，Q3 任务语义）迁 `@modules/tasks/successCriteria`。
export type { HealthStatus } from './health';
export { HEALTH_SEVERITY, isAcceptable, mergeHealthStatuses } from './health';
// P1（2026-10-28）：`performance/SprintPerformanceChecker`（fs 读数）迁 `@modules/performance`。
export { getBuildVariant } from './featureFlags';

// ==================== 交付模块 ====================
// P1（2026-10-28，v3 方案 §6.1）：`delivery/**` 含 fs / fs/promises / child_process ⇒
// 整体迁出内核到 `@modules/runtimeHost`（infra · zone: runtime-host）。此处不再转出。

// ==================== 并发工具 ====================
export { SimpleMutex } from './SimpleMutex';

// ==================== SPI 接口（core 层定义的上层抽象契约） ====================
export {
  type ILogger,
  type ILoggerService,
  SpiLogLevel,
  LOGGER_SERVICE_ID,
  registerLoggerSpi,
  resolveLogger,
  type IOTelService,
  type IOTelTracing,
  OTEL_SERVICE_ID,
  registerOTelSpi,
  resolveOTelTracing,
  TtlCache,
  AppError,
  ErrorCategory,
  ErrorSeverity,
  resolveBroadcast,
} from './spi';

// P2（2026-10-28，v3 §6.1）：`patterns/**`（任务模式语义，Q3）迁 `@modules/query/patterns`。
// 装配解析层（app/query/patternAssembler）改为同模块相对引用，不再经内核 barrel。

// 13-P2-1（2026-10-05）：输出侧护栏统一契约（core 层；具体护栏在 app 层注册）
// P2（2026-10-28，v3 §6.1）：注册表实现（排序 / fail-closed 聚合策略）迁 `@modules/security/outputGuardRegistry`，
// 内核只保留类型契约，避免「策略实现藏在 core」。
export type {
  OutputGuard,
  OutputGuardAction,
  OutputGuardIssue,
  OutputGuardVerdict,
  OutputGuardRunResult,
} from './outputGuard';

// 2026-08-29 R03-002 收敛：trajectory / utils 统一出口
// 2026-10-01 D-144：PlanDrivenLoop 及其辅助判定函数已移至 tasks 层
// （消除 core → app 倒挂；新出口见 `@modules/tasks`）
export { ErrorHandler } from './utils/ErrorHandler';
export {
  getPerformanceProfiler,
  performanceUtils,
  PerformanceProfiler,
  createPerformanceProfiler,
  MemoryCache,
  createMemoryCache,
} from './utils/Performance';
export { LazyModuleLoader } from './utils/LazyModuleLoader';

// 2026-08-30 R03-002 收敛：sleep / exit 统一出口
export { sleepMonitor, SLEEP_EVENTS } from './sleep/SleepMonitor';
export type { SleepInfo, TickResult } from './sleep/SleepMonitor';
// P1（2026-10-28）：`exit/ExitRecorder`（fs）迁 `@modules/runtimeHost`，内核不再转出；
// `abortReason` 契约仍留在 core（`@openliri/kernel/abortReason`）。

// P2（2026-10-28，v3 §6.1）：`phases/PhaseVocabulary`（PDCA 阶段词汇，Q3 任务语义）迁 `@modules/tasks/phases`。
// 2026-10-01 D-144：`scheduleTopoBatches` / `TopoBatchTask` 已移至 `@modules/tasks`
// （原 core → app 倒挂；consumer 见 `ai/router/OrchEngine.ts`）
// P0-1（2026-09-24，基础期）：运行时系统图内核（图结构 + 只读投影）
// 设计见 .trae/specs/graph-engineering-p0.md（零侵入：本期无生产调用点）
export * from './systemgraph/SystemGraph';
export * from './systemgraph/types';
// P1（2026-10-28）：`estop/estop`（fs 落盘）迁 `@modules/runtimeHost`，内核不再转出。
