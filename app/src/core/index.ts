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
 */

export * from '@modules/system/state';
export * from './paths';
export * from './events/EventBus';
export * from './events/UiEvents';
export { UiEventBus, uiEventBus } from './events/UiEventBus';

export { AppCore, createAppCore, type AppCoreConfig } from './AppCore';
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
/** @deprecated 由 ModuleRegistry + DIContainer 替代。保留用于 --use-legacy-module-system */
export {
  ModuleDependencyManager,
  type ModuleDefinition,
} from './ModuleDependencyManager';
/** @deprecated 由 pluginSystem 统一替代。保留用于 --use-legacy-module-system */
export { PluginEcosystem, type EcosystemConfig } from './PluginEcosystem';
/** @deprecated 由 pluginSystem 统一替代。保留用于 --use-legacy-module-system */
export { PluginSDK, type PluginSDKConfig } from './PluginSDK';
export type { Plugin } from '@modules/plugin-sdk';
export { Coordinator, type CoordinatorConfig } from './Coordinator';
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

// ==================== 交付模块（从 delivery/ 迁移） ====================
export * from './delivery/index';

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
