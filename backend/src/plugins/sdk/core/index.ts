/**
 * SDK core — 插件核心类型定义
 *
 * 包含所有插件开发者需要的基础类型、接口和枚举。
 * 纯类型模块，不包含任何实现逻辑。
 */

// SDK 插件清单类型
export type {
  PluginManifest,
  PluginSkillManifest,
  PluginSkillParameter,
  PluginHookManifest,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from '../PluginManifest';

export {
  PluginType,
} from '../PluginManifest';

// @modules/plugin-sdk 类型
export type {
  PluginContext,
  Plugin,
  SkillDefinition,
  SkillParameter,
  SkillContext,
} from '@modules/plugin-sdk';

// PluginSDK 配置类型
export type { PluginSDKConfig } from '../../../core/PluginSDK';
