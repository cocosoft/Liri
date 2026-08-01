/**
 * 模型配置查询函数 + ALL_MODEL_CONFIGS Proxy
 *
 * ALL_MODEL_CONFIGS 通过 Proxy 代理到 ModelRegistry（DB 驱动），
 * 运行时数据来源为 DB model_registry 表。
 * 类型定义在 types.ts（消除与 ModelRegistry 的循环依赖）。
 */

import { ModelCapability } from './types.js';
import type { ModelConfig, ModelKey, APIProvider } from './types.js';
import { API_PROVIDER_KEYS } from './types.js';

// 重导出以保持向后兼容
export type { ModelConfig, ModelKey, APIProvider };
export { API_PROVIDER_KEYS };

import { handleError } from '@modules/error';

function _getRegistry(): unknown {
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
    if (mod && typeof mod === 'object' && 'ModelRegistry' in mod) {
      const reg = (mod as Record<string, unknown>).ModelRegistry as unknown as {
        getInstance(): { getAllModelsAsRecord(): Record<string, ModelConfig> };
      };
      return reg.getInstance().getAllModelsAsRecord();
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
 * Proxy 代理到 ModelRegistry（数据源为 DB model_registry 表）。
 * 支持 ALL_MODEL_CONFIGS[key] 的读写方式，保持向后兼容。
 */
export const ALL_MODEL_CONFIGS: Record<ModelKey, ModelConfig> = new Proxy(
  {} as Record<ModelKey, ModelConfig>,
  {
    get(_target, prop: string | symbol): unknown {
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
    for (const pk of API_PROVIDER_KEYS) {
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
