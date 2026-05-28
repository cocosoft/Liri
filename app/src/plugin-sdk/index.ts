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
