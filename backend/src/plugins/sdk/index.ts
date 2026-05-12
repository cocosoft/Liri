/**
 * plugins/sdk/ — 插件开发 SDK 统一入口
 *
 * 为第三方插件开发者提供的完整 API 接口。
 */

export type {
  PluginManifest,
  PluginSkillManifest,
  PluginSkillParameter,
  PluginHookManifest,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from './PluginManifest';

export { PluginType } from './PluginManifest';

export { PluginValidator } from './PluginValidator';
export type { PluginValidatorOptions } from './PluginValidator';

export type {
  PluginContext,
  Plugin,
  SkillDefinition,
  SkillParameter,
  SkillContext,
  PluginSDKConfig,
} from '../../core/PluginSDK';

export { PluginSDK } from '../../core/PluginSDK';