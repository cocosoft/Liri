//
/**
 * 核心模块统一入口
 * 导出所有核心相关的类型、类和函数
 */

export * from '@modules/system/state';
export * from './events/EventBus';
export * from './tasks/TaskService';

export { AppCore, createAppCore, type AppCoreConfig } from './AppCore';
export { DIContainer } from './DIContainer';
export {
  ModuleDependencyManager,
  type ModuleDefinition,
} from './ModuleDependencyManager';
export { PluginEcosystem, type EcosystemConfig } from './PluginEcosystem';
export { PluginSDK, type PluginSDKConfig } from './PluginSDK';
export type { Plugin } from '@modules/plugin-sdk';
export { Coordinator, type CoordinatorConfig } from './Coordinator';
export { ContextManager, type ContextData } from './context/index';
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
