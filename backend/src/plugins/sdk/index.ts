/**
 * plugins/sdk/ — 插件开发 SDK 统一入口
 *
 * 为第三方插件开发者提供的完整 API 接口。
 *
 * 注意：此模块为旧版 DIP，新插件应直接使用 @modules/plugin-sdk。
 * 此处公开的类型和函数来自 `@modules/plugin-sdk`（新标准 SDK）及旧版兼容导出。
 *
 * 三层命名空间：
 *   sdk/core     — 核心类型定义
 *   sdk/setup    — 插件创建和配置
 *   sdk/runtime  — 插件运行时
 */

// === 三层命名空间导出 ===
import * as core from './core/index';
import * as setup from './setup/index';
import * as runtime from './runtime/index';

export { core, setup, runtime };

// === 向后兼容：顶层导出常用类型 ===

// core 层 - 插件清单类型
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

// core 层 - SDK 类型
export type {
  PluginContext,
  Plugin,
  SkillDefinition,
  SkillParameter,
  SkillContext,
} from '@modules/plugin-sdk';

// core 层 - 配置类型
export type { PluginSDKConfig } from '../../core/PluginSDK';

// setup 层 - 验证器
export { PluginValidator } from './PluginValidator';
export type { PluginValidatorOptions } from './PluginValidator';

// setup 层 - 版本管理
export {
  PluginVersionManager,
  calculatePluginVersion,
  pluginVersionManager,
} from '../utils/pluginVersioning';
export type {
  VersionInfo,
  UpdateCheckResult,
  VersionCompareResult,
} from '../utils/pluginVersioning';

// setup 层 - Schema
export {
  PluginManifestSchema,
  PluginTypeEnum,
  PluginSkillManifestSchema,
  PluginHookManifestSchema,
  PluginSkillParameterSchema,
} from '../utils/schemas';

// setup 层 - 创建插件
export { createPlugin } from '../utils/createPlugin';
export type { PluginDefinition } from '../utils/createPlugin';

// runtime 层 - 钩子系统
export { PluginHooks, pluginHooks } from '../hooks/PluginHooks';
export type {
  HookType,
  HookStage,
  HookContext,
  HookFunction,
  HookResult,
  HookRegistration,
} from '../hooks/PluginHooks';

export { GlobalRunner, globalRunner } from '../hooks/GlobalRunner';
export type {
  GlobalRunnerStrategy,
  GlobalHookFilter,
  GlobalRunResult,
} from '../hooks/GlobalRunner';

export { HostHooks, hostHooks } from '../hooks/HostHooks';
export type {
  HostHookType,
  HostHookContext,
  HostHookFunction,
  HostHookResult,
  HostHookRegistration,
} from '../hooks/HostHooks';

export { PhaseHooks, phaseHooks } from '../hooks/PhaseHooks';
export type {
  PhaseName,
  PhaseHookContext,
  PhaseHookFunction,
  PhaseHookResult,
  PhaseHookRegistration,
  PhaseExecutionRecord,
} from '../hooks/PhaseHooks';

// runtime 层 - 生命周期管理
export {
  PluginLifecycleManager,
  pluginLifecycleManager,
} from '../lifecycle/PluginLifecycleManager';
export type {
  PluginState,
  LifecycleConfig,
} from '../lifecycle/PluginLifecycleManager';

export { PluginLifecycleEvent } from '../core/PluginLifecycleManager';
export type {
  LifecycleHook,
  LifecycleContext,
} from '../core/PluginLifecycleManager';

// runtime 层 - PluginSDK
export { PluginSDK, createPluginSDK } from '../../core/PluginSDK';
