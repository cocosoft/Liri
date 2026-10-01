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
 * 注意：paths 必须最先求值——后续导出（monitoring → config 等）
 * 可能在模块顶层访问 configManager/路径函数，若 paths 尚未初始化会触发
 * userDataDirOverride 的 TDZ（循环导入）。
 */

export * from './paths';
// P2-9（2026-09-25）：迁移注册表与版本中枢（`core/migration/` 内部用相对路径引 `../paths`，无环）
export * from './migration/AppMigrationStore';
export * from './migration/MigrationRegistry';
// G1 收口（台账 D-77 / A5）：移除 `@modules/system/state` 的整包再导出（`export *`）——
//   零消费（删除后 `bun run typecheck` 无符号缺失），且消掉 core → system(infra) 的对边；
//   消费方一律直连 `@modules/state/*`（如 `promptSuggestion/types.ts`）。
//   ⚠️ **写法约定**：本文件及同类注释中**禁止出现"from '<包名>'"的完整导入片段** ——
//   门禁 `parseModuleImports` 的两条正则**都不剥离注释**，照抄一条 import 语句会让该依赖
//   在门禁眼里"复活"（2026-09-30 实测踩中：本行原写作 `export * from '<包名>'` 的形式，
//   导致该对边在删除后再现，靠探针才定位到）。要提及包名时只写包名本身即可。
export * from './seedSync';
export type { Message, ToolCall, ToolResult, ToolContext } from './types';
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
// J-7 清理：旧版 PluginSDK 双轨已删除（@deprecated 由 pluginSystem 统一替代），re-export 一并移除
// G1 收口（台账 D-59）：`Plugin` 的再导出亦移除——core 不得转出 app 层 plugin-sdk 类型（消费方直连 @modules/plugin-sdk，
//   且 plugin-sdk 自身有「零反向引用」红线，故不能反向下沉到 core）
export {
  Coordinator,
  coordinator,
  type CoordinatorConfig,
  type CoordinatorTask,
} from './Coordinator';
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
  TOOL_NAMES,
  type FeatureFlag,
} from './featureFlags';

// 2026-08-29 R03-002 收敛：子模块统一出口
export * from './data-models';
export * from './ports';
export type { HealthStatus, UnifiedHealthStatus } from './health';
export { HEALTH_SEVERITY, isAcceptable, mergeHealthStatuses } from './health';
export * from './performance';
export { getBuildVariant } from './featureFlags';

// ==================== 交付模块（从 delivery/ 迁移） ====================
export * from './delivery/index';

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
  ERROR_SERVICE_ID,
  resolveBroadcast,
} from './spi';

// 2026-10-01 D-144：patterns 出口（供 tasks 层的 PlanDrivenLoop 消费，
// 避免 `@modules/core/patterns/index.js` 子目录直连触发 R03-002）
export { selectPattern } from './patterns';

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
export {
  installExitRecorder,
  logStartupContext,
  readLastExit,
  recordAbnormalExit,
  recordExit,
  isAbnormalExit,
} from './exit/ExitRecorder';
export type {
  ExitReason,
  ExitRecord,
  AbnormalExitRecord,
} from './exit/ExitRecorder';

// 2026-09-24 R03-002 收敛：phases / topoBatches / estop 统一出口
export {
  toPdcaPhase,
  pdcaCheckpointStatus,
  PDCA_TO_WORKITEM,
  PDCA_TERMINAL_PHASES,
} from './phases/PhaseVocabulary';
export type {
  PdcaIntent,
  ImplicitIntent,
  PdcaPhase,
  WorkItemStatus,
} from './phases/PhaseVocabulary';
// 2026-10-01 D-144：`scheduleTopoBatches` / `TopoBatchTask` 已移至 `@modules/tasks`
// （原 core → app 倒挂；consumer 见 `ai/router/OrchEngine.ts`）
// P0-1（2026-09-24，基础期）：运行时系统图内核（图结构 + 只读投影）
// 设计见 .trae/specs/graph-engineering-p0.md（零侵入：本期无生产调用点）
export * from './systemgraph/SystemGraph';
export * from './systemgraph/types';
export {
  estopSentinelPath,
  isEstopEngaged,
  engageEstop,
  disengageEstop,
  getEstopState,
  checkEstop,
} from './estop/estop';
export type { EstopState } from './estop/estop';
