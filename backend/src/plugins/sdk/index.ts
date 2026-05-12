/**
 * plugins/sdk/ — 插件开发 SDK 统一入口
 *
 * 为第三方插件开发者提供的完整 API 接口。
 *
 * 注意：此模块为旧版 DIP，新插件应直接使用 @modules/plugin-sdk。
 * 此处公开的类型和函数来自 `@modules/plugin-sdk`（新标准 SDK）及旧版兼容导出。
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
} from '@modules/plugin-sdk';

export type { PluginSDKConfig } from '../../core/PluginSDK';
export { PluginSDK } from '../../core/PluginSDK';
