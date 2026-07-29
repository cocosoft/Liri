/**
 * 模型配置定义（纯类型 + 运行时代理）
 *
 * ALL_MODEL_CONFIGS 不再包含硬编码数据，
 * 改为 Proxy 代理到 ModelRegistry（数据源为 YAML 文件）
 */

import { ModelCapability } from './types.js';

import { handleError } from '@modules/error';

/**
 * API提供商类型
 */
export type APIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'openai'
  | 'deepseek'
  | 'google'
  | 'ollama'
  | 'grok'
  | 'moonshot';

/**
 * 模型配置接口
 */
export interface ModelConfig {
  firstParty: string;
  bedrock: string;
  vertex: string;
  azure: string;
  openai: string;
  deepseek: string;
  google: string;
  grok: string;
  moonshot: string;
  ollama: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities?: ModelCapability[];
  pricing?: {
    inputPer1M: number;
    outputPer1M: number;
    cacheReadPer1M?: number;
    cacheWritePer1M?: number;
  };
  extendedContextWindows?: Array<{
    suffix: string;
    windowSize: number;
  }>;
}

/**
 * 模型键类型（字符串，不再枚举）
 */
export type ModelKey = string;

function _getRegistry(): any {
  try {
    const mod =
      (globalThis as any).__ModelRegistryModule ??
      (() => {
        try {
          return require('./ModelRegistry.js');
        } catch {
          return null;
        }
      })();
    (globalThis as any).__ModelRegistryModule = mod;
    return mod;
  } catch {
    return null;
  }
}

function _getAllFromRegistry(): Record<string, ModelConfig> {
  try {
    const mod = _getRegistry();
    if (mod?.ModelRegistry) {
      const reg = mod.ModelRegistry.getInstance();
      return reg.getAllModelsAsRecord();
    }
  } catch (err) {
    // ModelRegistry 不可用
    handleError(err, { module: 'ai:models', action: 'getAllFromRegistry' });
  }
  return {};
}

/**
 * ALL_MODEL_CONFIGS - 运行时模型配置集合
 *
 * 由 Proxy 代理到 ModelRegistry，数据源为 YAML 文件
 * 支持 ALL_MODEL_CONFIGS[key] 的读写方式，保持向后兼容
 *
 * @deprecated 推荐使用 ModelRegistry.getInstance() 替代直接访问
 */
export const ALL_MODEL_CONFIGS: Record<ModelKey, ModelConfig> = new Proxy(
  {} as Record<ModelKey, ModelConfig>,
  {
    get(_target, prop: string | symbol): any {
      if (typeof prop === 'string' && prop !== 'then' && prop !== 'toJSON') {
        const data = _getAllFromRegistry();
        return data[prop];
      }
      return undefined;
    },
    has(_target, prop: string | symbol): boolean {
      if (typeof prop === 'string') {
        const data = _getAllFromRegistry();
        return prop in data;
      }
      return false;
    },
    ownKeys(): (string | symbol)[] {
      return Object.keys(_getAllFromRegistry());
    },
    getOwnPropertyDescriptor(
      _target,
      prop: string | symbol
    ): PropertyDescriptor | undefined {
      const data = _getAllFromRegistry();
      if (typeof prop === 'string' && prop in data) {
        return { configurable: true, enumerable: true, value: data[prop] };
      }
      return undefined;
    },
  }
) as Record<ModelKey, ModelConfig>;

/**
 * 获取模型配置
 * @param modelKey 模型键
 * @returns 模型配置
 */
export function getModelConfig(modelKey: ModelKey): ModelConfig | undefined {
  return ALL_MODEL_CONFIGS[modelKey];
}

/**
 * 根据模型名称获取模型键
 * @param modelName 模型名称
 * @returns 模型键或null
 */
export function getModelKeyByName(modelName: string): ModelKey | null {
  const data = _getAllFromRegistry();
  for (const [key, config] of Object.entries(data)) {
    const providerKeys: (keyof ModelConfig)[] = [
      'firstParty',
      'bedrock',
      'vertex',
      'azure',
      'openai',
      'deepseek',
      'google',
      'grok',
      'moonshot',
      'ollama',
    ];
    for (const pk of providerKeys) {
      if (
        (config as unknown as Record<string, string>)[pk as string] ===
        modelName
      ) {
        return key;
      }
    }
  }
  return null;
}

/**
 * 获取模型在指定提供商的名称
 * @param modelKey 模型键
 * @param provider API提供商
 * @returns 模型名称
 */
export function getModelNameForProvider(
  modelKey: ModelKey,
  provider: APIProvider
): string {
  const config = ALL_MODEL_CONFIGS[modelKey];
  if (!config) return '';
  return (config as unknown as Record<string, string>)[provider] || '';
}

/**
 * 根据规范模型ID获取模型配置
 * @param id 规范模型ID
 * @returns 模型配置
 */
export function getModelConfigById(id: string): ModelConfig | undefined {
  const data = _getAllFromRegistry();
  for (const config of Object.values(data)) {
    if (config.firstParty === id) return config;
  }
  const key = getModelKeyByName(id);
  return key ? data[key] : undefined;
}

/**
 * 获取包含指定能力的模型列表
 * @param capability 模型能力
 * @returns 支持该能力的模型键列表
 */
export function getModelsWithCapability(
  capability: ModelCapability
): ModelKey[] {
  return (Object.entries(ALL_MODEL_CONFIGS) as [string, ModelConfig][])
    .filter(([_, config]) => config.capabilities?.includes(capability))
    .map(([key]) => key as ModelKey);
}

/**
 * 获取模型支持的能力列表
 * @param modelName 模型名称
 * @returns 能力列表
 */
export function getModelCapabilities(modelName: string): ModelCapability[] {
  const modelKey = getModelKeyByName(modelName);
  if (modelKey) {
    const config = ALL_MODEL_CONFIGS[modelKey];
    return config.capabilities ?? [];
  }
  return [];
}

/**
 * 检查模型是否支持指定能力
 * @param modelName 模型名称
 * @param capability 能力枚举
 * @returns 是否支持
 */
export function modelSupportsCapability(
  modelName: string,
  capability: ModelCapability
): boolean {
  return getModelCapabilities(modelName).includes(capability);
}

/**
 * 获取模型的上下文窗口大小
 * 从 YAML 配置读取真实的 contextWindow，找不到时返回 65536
 */
export function getModelContextWindow(modelName: string): number {
  return ALL_MODEL_CONFIGS[modelName]?.contextWindow ?? 65536;
}

/**
 * 完整的模型定价（含缓存价格）
 * @deprecated 迁移中，请使用 ModelRegistry.getModelPricing()
 */
export interface CompleteModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

/**
 * 成本层级常量
 */
export const PRICING_TIER_SONNET = {
  inputPer1M: 3,
  outputPer1M: 15,
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
};
export const PRICING_TIER_OPUS = {
  inputPer1M: 15,
  outputPer1M: 75,
  cacheReadPer1M: 1.5,
  cacheWritePer1M: 18.75,
};
export const PRICING_TIER_OPUS45 = {
  inputPer1M: 5,
  outputPer1M: 25,
  cacheReadPer1M: 0.5,
  cacheWritePer1M: 6.25,
};
export const PRICING_TIER_HAIKU45 = {
  inputPer1M: 1,
  outputPer1M: 5,
  cacheReadPer1M: 0.1,
  cacheWritePer1M: 1.25,
};
export const PRICING_TIER_HAIKU35 = {
  inputPer1M: 0.8,
  outputPer1M: 4,
  cacheReadPer1M: 0.08,
  cacheWritePer1M: 1,
};

/**
 * 获取模型的完整定价（含缓存）
 * 优先从 ModelRegistry 获取，回退到内置值
 */
export function getModelCompletePricing(
  modelName: string
): CompleteModelPricing | null {
  const config = getModelConfigById(modelName);
  if (config?.pricing) {
    return {
      inputPer1M: config.pricing.inputPer1M,
      outputPer1M: config.pricing.outputPer1M,
      cacheReadPer1M: config.pricing.cacheReadPer1M ?? 0,
      cacheWritePer1M: config.pricing.cacheWritePer1M ?? 0,
    };
  }
  return null;
}

/**
 * 获取指定提供商支持的所有模型
 * @param provider API提供商
 * @returns 该提供商可用的模型键列表
 */
export function getModelsByProvider(provider: APIProvider): ModelKey[] {
  return (Object.entries(ALL_MODEL_CONFIGS) as [string, ModelConfig][])
    .filter(([_, config]) => config[provider] && config[provider] !== '')
    .map(([key]) => key as ModelKey);
}
