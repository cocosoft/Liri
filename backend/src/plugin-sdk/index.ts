/**
 * plugin-sdk/index.ts - 插件 SDK 公开入口
 *
 * 第三方插件开发者通过此入口获取所有插件开发所需的类型和工具函数。
 * 此模块不引用任何核心内部模块，保证隔离边界。
 */

export { createPlugin, validatePluginManifest } from './core';

export type {
  Plugin,
  PluginContext,
  PluginConfig,
  PluginRuntime,
  PluginRuntimeStatus,
  ToolRegistration,
  SkillDefinition,
  SkillParameter,
  SkillContext,
  PluginManifest,
  PluginSkillManifest,
  PluginSkillParameter,
  PluginHookManifest,
  PluginValidationResult,
  PluginValidationError,
  PluginValidationWarning,
} from './types';
