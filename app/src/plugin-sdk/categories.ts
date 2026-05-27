/**
 * plugin-sdk/categories.ts — 插件分类类型与创建入口
 *
 * 第三方插件开发者通过此模块了解并实现各分类的专属接口契约。
 * 每个分类提供独立的 createXxxPlugin() 辅助函数。
 *
 * 边界红线：此文件不引用 src/ 下的任何模块。
 */

import type { Plugin, SkillDefinition, PluginContext } from './types';

// ─── 分类枚举 ───

export type PluginCategoryCapability =
  | 'provider'
  | 'tool'
  | 'hook'
  | 'channel'
  | 'harness'
  | 'cli_backend'
  | 'skill'
  | 'middleware'
  | 'image_generation'
  | 'speech';

export interface CategoryMetadata {
  capability: PluginCategoryCapability;
  description: string;
  requiredInterfaces: string[];
}

export const PLUGIN_CATEGORIES: Record<
  PluginCategoryCapability,
  CategoryMetadata
> = {
  provider: {
    capability: 'provider',
    description: '注册 AI 模型 Provider（如 OpenAI/Anthropic/DeepSeek）',
    requiredInterfaces: ['IProviderPlugin'],
  },
  tool: {
    capability: 'tool',
    description: '注册 Agent 工具（如文件读写/命令行执行/网络请求）',
    requiredInterfaces: ['IToolPlugin'],
  },
  hook: {
    capability: 'hook',
    description: '注册运行时钩子（before/after/onError 生命周期）',
    requiredInterfaces: ['IHookPlugin'],
  },
  channel: {
    capability: 'channel',
    description: '注册消息通道（如企业微信/飞书/钉钉）',
    requiredInterfaces: ['IChannelPlugin'],
  },
  harness: {
    capability: 'harness',
    description: '注册 Agent 运行器（自定义 Agent 循环）',
    requiredInterfaces: ['IHarnessPlugin'],
  },
  cli_backend: {
    capability: 'cli_backend',
    description: '注册 CLI 后端扩展',
    requiredInterfaces: ['ICliBackendPlugin'],
  },
  skill: {
    capability: 'skill',
    description: '注册技能模块',
    requiredInterfaces: ['ISkillPlugin'],
  },
  middleware: {
    capability: 'middleware',
    description: '注册工具结果中间件（拦截/修改工具返回）',
    requiredInterfaces: ['IMiddlewarePlugin'],
  },
  image_generation: {
    capability: 'image_generation',
    description: '注册图片生成 Provider',
    requiredInterfaces: ['IImageGenerationPlugin'],
  },
  speech: {
    capability: 'speech',
    description: '注册语音合成 Provider',
    requiredInterfaces: ['ISpeechPlugin'],
  },
};

export function getCategoryMeta(
  capability: PluginCategoryCapability
): CategoryMetadata {
  return PLUGIN_CATEGORIES[capability];
}

export function validateCategory(
  capability: string
): capability is PluginCategoryCapability {
  return Object.keys(PLUGIN_CATEGORIES).includes(capability);
}

export function listCategories(): PluginCategoryCapability[] {
  return Object.keys(PLUGIN_CATEGORIES) as PluginCategoryCapability[];
}

// ─── 分类专属 Plugin 接口 ───

export interface ProviderPlugin extends Plugin {
  category: 'provider';
  providerName: string;
  getModels: () => string[] | Promise<string[]>;
  healthCheck: () => Promise<boolean>;
}

export interface ToolPlugin extends Plugin {
  category: 'tool';
  toolName: string;
  getSchema: () => Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    context: PluginContext
  ) => Promise<Record<string, unknown>>;
}

export interface HookPlugin extends Plugin {
  category: 'hook';
  hookName: string;
  onEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
  onIntercept?: (
    payload: Record<string, unknown>
  ) => Promise<{ allowed: boolean; reason?: string }>;
}

export interface ChannelPlugin extends Plugin {
  category: 'channel';
  channelName: string;
  connect: (config: Record<string, unknown>) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (
    target: string,
    message: string
  ) => Promise<{ success: boolean; messageId?: string }>;
  onMessage?: (callback: (msg: Record<string, unknown>) => void) => void;
}

export interface SkillPlugin extends Plugin {
  category: 'skill';
  skillName: string;
  getSkillDefinition: () => Record<string, unknown>;
  execute: (
    context: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}

export type CategoryPlugin =
  | ProviderPlugin
  | ToolPlugin
  | HookPlugin
  | ChannelPlugin
  | SkillPlugin;

// ─── 分类专属创建函数 ───

export function createProviderPlugin(def: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  skills?: SkillDefinition[];
  providerName: string;
  getModels: () => string[] | Promise<string[]>;
  healthCheck: () => Promise<boolean>;
}): ProviderPlugin {
  return {
    ...def,
    tags: def.tags ?? [],
    category: 'provider' as const,
  } as ProviderPlugin;
}

export function createToolPlugin(def: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  skills?: SkillDefinition[];
  toolName: string;
  getSchema: () => Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    context: PluginContext
  ) => Promise<Record<string, unknown>>;
}): ToolPlugin {
  return {
    ...def,
    tags: def.tags ?? [],
    category: 'tool' as const,
  } as ToolPlugin;
}

export function createHookPlugin(def: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  skills?: SkillDefinition[];
  hookName: string;
  onEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
  onIntercept?: (
    payload: Record<string, unknown>
  ) => Promise<{ allowed: boolean; reason?: string }>;
}): HookPlugin {
  return {
    ...def,
    tags: def.tags ?? [],
    category: 'hook' as const,
  } as HookPlugin;
}

export function createChannelPlugin(def: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  skills?: SkillDefinition[];
  channelName: string;
  connect: (config: Record<string, unknown>) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMessage: (
    target: string,
    message: string
  ) => Promise<{ success: boolean; messageId?: string }>;
  onMessage?: (callback: (msg: Record<string, unknown>) => void) => void;
}): ChannelPlugin {
  return {
    ...def,
    tags: def.tags ?? [],
    category: 'channel' as const,
  } as ChannelPlugin;
}

export function createSkillPlugin(def: {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags?: string[];
  skills?: SkillDefinition[];
  skillName: string;
  getSkillDefinition: () => Record<string, unknown>;
  execute: (
    context: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}): SkillPlugin {
  return {
    ...def,
    tags: def.tags ?? [],
    category: 'skill' as const,
  } as SkillPlugin;
}
