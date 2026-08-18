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
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ai:models:configs');

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
 *
 * 与 getModelContextWindow 一致：先按模型名查 userModels/discoveredModels（key 即模型名），
 * 命中则直接返回；未命中则用 getModelKeyByName 转换为 ModelKey（内置模型 key）再查。
 * 全部 miss 时返回空数组。
 *
 * 同源问题修复（2026-08-18）：原实现只走 getModelKeyByName 转换，对 user 自定义模型
 * 会返回基础模型的能力（因为 user config 通过 ...base 继承了基础模型的 provider 字段，
 * 导致 getModelKeyByName 返回基础模型的 key），而非用户在 models.yaml 中通过
 * override.capabilities 自定义的能力。
 * @param modelName 模型名称
 * @returns 能力列表
 */
export function getModelCapabilities(modelName: string): ModelCapability[] {
  // 1. 直接按模型名索引（命中 userModels / discoveredModels，key 即模型名）
  const direct = ALL_MODEL_CONFIGS[modelName];
  if (direct?.capabilities) {
    logger.info('getModelCapabilities:命中直接索引', {
      modelName,
      hitStep: 'direct',
      source: 'userModels/discoveredModels',
      capabilities: direct.capabilities,
      capabilityCount: direct.capabilities.length,
    });
    return direct.capabilities;
  }
  // 2. 内置模型 key 转换（ALL_MODEL_CONFIGS 的内置 key 是 ModelKey 如 "deepseek"）
  const modelKey = getModelKeyByName(modelName);
  if (modelKey) {
    const config = ALL_MODEL_CONFIGS[modelKey];
    const caps = config?.capabilities ?? [];
    logger.info('getModelCapabilities:命中 key 转换', {
      modelName,
      hitStep: 'keyConversion',
      resolvedKey: modelKey,
      source: 'builtinModels',
      hasConfig: !!config,
      capabilities: caps,
      capabilityCount: caps.length,
      // 若 direct 索引存在但 capabilities 为空，标记为异常（可能 user 覆盖了 capabilities 为空）
      directExistsButEmpty: !!direct && !direct.capabilities,
    });
    return caps;
  }
  // 3. 全部 miss：返回空数组（可能是未注册的模型名）
  logger.warn('getModelCapabilities:全部 miss', {
    modelName,
    hitStep: 'none',
    directExists: !!direct,
    resolvedKey: null,
  });
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
 *
 * 与 getModelCapabilities 一致：先按模型名查 userModels/discoveredModels（key 即模型名），
 * 命中则直接返回；未命中则用 getModelKeyByName 转换为 ModelKey（内置模型 key）再查。
 * 全部 miss 时返回 65536 兜底。
 */
export function getModelContextWindow(modelName: string): number {
  // 1. 直接按模型名索引（命中 userModels / discoveredModels，key 即模型名）
  const direct = ALL_MODEL_CONFIGS[modelName]?.contextWindow;
  if (direct !== undefined) return direct;
  // 2. 内置模型 key 转换（ALL_MODEL_CONFIGS 的内置 key 是 ModelKey 如 "deepseek"）
  const modelKey = getModelKeyByName(modelName);
  if (modelKey) {
    return ALL_MODEL_CONFIGS[modelKey]?.contextWindow ?? 65536;
  }
  return 65536;
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
