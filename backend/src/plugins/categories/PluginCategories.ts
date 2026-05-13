/**
 * 插件能力分类接口
 * 按能力类型区分插件注册入口
 * 对齐 OpenClaw plugins/types.ts 分类体系
 */

import type { Logger } from '@modules/monitoring/logs/Logger';

export type PluginCapability =
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

export interface PluginCategoryMetadata {
  capability: PluginCapability;
  description: string;
  requiredInterfaces: string[];
  optionalInterfaces: string[];
}

export const PLUGIN_CATEGORIES: Record<PluginCapability, PluginCategoryMetadata> = {
  provider: {
    capability: 'provider',
    description: '注册 AI 模型 Provider',
    requiredInterfaces: ['IProviderPlugin'],
    optionalInterfaces: [],
  },
  tool: {
    capability: 'tool',
    description: '注册 Agent 工具',
    requiredInterfaces: ['IToolPlugin'],
    optionalInterfaces: ['IToolUIProvider'],
  },
  hook: {
    capability: 'hook',
    description: '注册运行时钩子',
    requiredInterfaces: ['IHookPlugin'],
    optionalInterfaces: [],
  },
  channel: {
    capability: 'channel',
    description: '注册消息通道',
    requiredInterfaces: ['IChannelPlugin'],
    optionalInterfaces: ['IMessageFormatter'],
  },
  harness: {
    capability: 'harness',
    description: '注册 Agent 运行器',
    requiredInterfaces: ['IHarnessPlugin'],
    optionalInterfaces: [],
  },
  cli_backend: {
    capability: 'cli_backend',
    description: '注册 CLI 后端扩展',
    requiredInterfaces: ['ICliBackendPlugin'],
    optionalInterfaces: [],
  },
  skill: {
    capability: 'skill',
    description: '注册技能模块',
    requiredInterfaces: ['ISkillPlugin'],
    optionalInterfaces: [],
  },
  middleware: {
    capability: 'middleware',
    description: '注册工具结果中间件',
    requiredInterfaces: ['IMiddlewarePlugin'],
    optionalInterfaces: [],
  },
  image_generation: {
    capability: 'image_generation',
    description: '注册图片生成 Provider',
    requiredInterfaces: ['IImageGenerationPlugin'],
    optionalInterfaces: [],
  },
  speech: {
    capability: 'speech',
    description: '注册语音合成 Provider',
    requiredInterfaces: ['ISpeechPlugin'],
    optionalInterfaces: [],
  },
};

export interface IProviderPlugin {
  readonly capability: 'provider';
  readonly providerName: string;
  getModels(): string[];
  healthCheck(): Promise<boolean>;
}

export interface IToolPlugin {
  readonly capability: 'tool';
  readonly toolName: string;
  getSchema(): Record<string, unknown>;
  execute(input: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface IHookPlugin {
  readonly capability: 'hook';
  readonly hookName: string;
  onEvent?(event: string, payload: Record<string, unknown>): Promise<void>;
  onIntercept?(payload: Record<string, unknown>): Promise<{ allowed: boolean; reason?: string }>;
}

export interface IChannelPlugin {
  readonly capability: 'channel';
  readonly channelName: string;
  connect(config: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(target: string, message: string): Promise<void>;
  onMessage(callback: (msg: Record<string, unknown>) => void): void;
}

export interface ISkillPlugin {
  readonly capability: 'skill';
  readonly skillName: string;
  getSkillDefinition(): Record<string, unknown>;
  execute(context: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export type CategoryPlugin =
  | IProviderPlugin
  | IToolPlugin
  | IHookPlugin
  | IChannelPlugin
  | ISkillPlugin;

export function getPluginCategory(capability: PluginCapability): PluginCategoryMetadata {
  return PLUGIN_CATEGORIES[capability];
}

export function validatePluginInterfaces(
  capability: PluginCapability,
  implementedInterfaces: string[]
): { valid: boolean; missing: string[] } {
  const meta = getPluginCategory(capability);
  const missing = meta.requiredInterfaces.filter((iface) => !implementedInterfaces.includes(iface));
  return { valid: missing.length === 0, missing };
}
