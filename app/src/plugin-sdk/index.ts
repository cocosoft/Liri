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

// categories — 插件分类系统
export {
  PLUGIN_CATEGORIES,
  getCategoryMeta,
  validateCategory,
  listCategories,
  createProviderPlugin,
  createToolPlugin,
  createHookPlugin,
  createChannelPlugin,
  createSkillPlugin,
} from './categories';
export type {
  PluginCategoryCapability,
  CategoryMetadata,
  ProviderPlugin,
  ToolPlugin,
  HookPlugin,
  ChannelPlugin,
  SkillPlugin,
  CategoryPlugin,
} from './categories';

// manifest-loader — 插件清单加载器
export {
  loadPluginManifest,
  loadPluginManifests,
  getPluginSkills,
  getPluginHooks,
} from './ManifestLoader';

// channel-contract — 通道插件契约
export { validateChannelPlugin } from './channel-contract';
export type {
  ChannelId,
  ChannelMeta,
  ChannelCapabilities,
  ChannelConfigAdapter,
  ChannelLifecycleAdapter,
  ChannelOutboundAdapter,
  ChannelSecurityAdapter,
  ChannelPairingAdapter,
  IChannelPlugin,
  ChannelStatus,
  ChannelSendResult,
  ChannelInteractiveCard,
  ChannelMessageContext,
} from './channel-contract';

// ==================== Provider 实现（从 extensions/ 迁移） ====================
export { createOpenAIProvider } from './providers/OpenAIProvider.js';
export type { OpenAIProviderConfig } from './providers/OpenAIProvider.js';

export { createAnthropicProvider } from './providers/AnthropicProvider.js';
export type { AnthropicProviderConfig } from './providers/AnthropicProvider.js';
