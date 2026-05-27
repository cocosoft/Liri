/**
 * @pyapp/core — 核心包入口
 *
 * 导出 Core API、Feature Flags 和构建变体工具函数。
 */

export { AppCore } from './core/AppCore';
export type { AppCoreConfig } from './core/AppCore';

export { CoreAPI } from './core/api/CoreAPI';
export type { CoreAPIConfig } from './core/api/CoreAPI';

export { CoreAPIImpl } from './core/api/CoreAPIImpl';

export {
  FEATURE_FLAGS,
  feature,
  isFeatureEnabled,
  getBuildVariant,
  isBuildVariant,
  isAtLeastVariant,
  BUILD_VARIANT,
  BUILD_VARIANTS,
} from './core/featureFlags';

export type { FeatureFlag, BuildVariant } from './core/featureFlags';

export { PluginSDK } from './core/PluginSDK';
export type {
  Plugin,
  PluginContext,
  SkillDefinition,
  SkillParameter,
  SkillContext,
  PluginSDKConfig,
} from './core/PluginSDK';