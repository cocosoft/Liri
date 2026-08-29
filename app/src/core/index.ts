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
 * 注意：paths 必须最先求值——后续导出（system/state → monitoring → config）
 * 可能在模块顶层访问 configManager/路径函数，若 paths 尚未初始化会触发
 * userDataDirOverride 的 TDZ（循环导入）。
 */

export * from './paths';
export * from '@modules/system/state';
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
export type { Plugin } from '@modules/plugin-sdk';
export {
  Coordinator,
  coordinator,
  type CoordinatorConfig,
  type CoordinatorTask,
} from './Coordinator';
export type { ContextData } from './context/index';
export type { AuthManager, AuthConfig } from '@modules/system/auth/AuthManager';

export {
  NotificationService,
  notificationService,
  createNotificationService,
  type NotificationOptions,
} from './notifications/NotificationService';

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
  TtlCache,
  AppError,
  ErrorCategory,
  ErrorSeverity,
  ERROR_SERVICE_ID,
} from './spi';

// 2026-08-29 R03-002 收敛：loop / trajectory / utils 统一出口
export {
  PlanDrivenLoop,
  classifyTaskComplexity,
  hasDangerousToolIntent,
  isEligibleForFastPath,
} from './loop/PlanDrivenLoop';
export type { PlanDrivenLoopResult } from './loop/PlanDrivenLoop';
export { trajectoryRuntime } from './trajectory/TrajectoryRuntime';
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
