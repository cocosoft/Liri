/**
 * 运行时模型注册表（YAML 驱动版）
 * 三层模型数据合并：内置默认值（YAML） → 用户配置覆盖（~/.pyapp/models.yaml） → 运行时发现
 */

import { ModelConfig, ModelKey, APIProvider } from './ModelConfigs.js';
import { ModelCapability } from './types.js';
import { loadDefaultModels, type DefaultModelsData, type ModelYamlConfig } from '../config/defaultModels.js';
import {
  loadProvidersConfig,
  loadModelsConfig,
  loadPricingConfig,
  type PricingOverride,
  type ProviderConfig,
} from '../config/ConfigLoader.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/config/paths';

const DEFAULT_PRICING_SOURCE =
  'https://raw.githubusercontent.com/community/llm-pricing/main/pricing.json';

const PRICING_CACHE_PATH = join(resolvePyappHome(), 'cache', 'pricing.json');

const API_PROVIDER_KEYS: APIProvider[] = [
  'firstParty', 'bedrock', 'vertex', 'azure',
  'openai', 'deepseek', 'google', 'grok', 'moonshot', 'ollama',
];

/** 将 YAML 格式的 providers 映射转换为平面字段 */
function yamlEntryToModelConfig(entry: ModelYamlConfig, key: string): ModelConfig {
  const providers: Record<string, string> = {};
  for (const pk of API_PROVIDER_KEYS) {
    providers[pk] = entry.providers[pk] ?? '';
  }

  const caps: ModelCapability[] = [];
  if (entry.capabilities) {
    for (const c of entry.capabilities) {
      const upper = c.toUpperCase() as keyof typeof ModelCapability;
      const val = ModelCapability[upper];
      if (val !== undefined) {
        caps.push(val);
      }
    }
  }

  return {
    ...providers as unknown as ModelConfig,
    displayName: entry.displayName,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    ...(caps.length > 0 && { capabilities: caps }),
    ...(entry.pricing && { pricing: entry.pricing }),
    ...(entry.extendedContextWindows && { extendedContextWindows: entry.extendedContextWindows }),
  };
}

/**
 * 运行时模型注册表
 */
export class ModelRegistry {
  private static instance: ModelRegistry;

  private builtinModels: Map<string, ModelConfig> = new Map();
  private userModels: Map<string, ModelConfig> = new Map();
  private discoveredModels: Map<string, ModelConfig> = new Map();

  private providerConfigs: Map<string, ProviderConfig> = new Map();
  private userPricing: Map<string, PricingOverride> = new Map();
  private syncedPricing: Map<string, PricingOverride> = new Map();

  private constructor() {
    // 启动时从 ModelRegistry 构造函数加载内置模型
  }

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry();
    }
    return ModelRegistry.instance;
  }

  /** 从 YAML 加载内置默认模型 */
  loadDefaultModels(): void {
    const data = loadDefaultModels();
    for (const [key, entry] of Object.entries(data.models)) {
      this.builtinModels.set(key, yamlEntryToModelConfig(entry, key));
    }
  }

  /** 加载用户配置（providers.yaml + models.yaml + pricing.yaml） */
  loadUserConfigs(): void {
    const providersCfg = loadProvidersConfig();
    const modelsCfg = loadModelsConfig();
    const pricingCfg = loadPricingConfig();

    for (const [id, cfg] of Object.entries(providersCfg.providers)) {
      this.providerConfigs.set(id, cfg);
    }

    for (const [modelId, override] of Object.entries(modelsCfg.models)) {
      if (override.baseModel && this.builtinModels.has(override.baseModel)) {
        const base = this.builtinModels.get(override.baseModel)!;
        this.userModels.set(modelId, {
          ...base,
          firstParty: modelId,
          displayName: override.displayName ?? base.displayName,
          contextWindow: override.contextWindow ?? base.contextWindow,
          maxOutputTokens: override.maxOutputTokens ?? base.maxOutputTokens,
          ...(override.capabilities && { capabilities: override.capabilities as ModelCapability[] }),
        });
      } else {
        const existing = this.builtinModels.get(modelId);
        this.userModels.set(modelId, {
          ...(existing ?? {} as ModelConfig),
          firstParty: modelId,
          displayName: override.displayName ?? existing?.displayName ?? modelId,
          contextWindow: override.contextWindow ?? existing?.contextWindow ?? 200000,
          maxOutputTokens: override.maxOutputTokens ?? existing?.maxOutputTokens ?? 4096,
          ...(override.capabilities && { capabilities: override.capabilities as ModelCapability[] }),
        });
      }
    }

    for (const [modelId, pricing] of Object.entries(pricingCfg.pricing)) {
      this.userPricing.set(modelId, pricing);
    }

    this.loadSyncedPricingCache();
  }

  getAllModels(): ModelConfig[] {
    const result = new Map(this.builtinModels);
    for (const [id, cfg] of this.userModels) result.set(id, cfg);
    for (const [id, cfg] of this.discoveredModels) {
      if (!result.has(id)) result.set(id, cfg);
    }
    return Array.from(result.values());
  }

  getModel(modelId: string): ModelConfig | undefined {
    return this.userModels.get(modelId)
      ?? this.discoveredModels.get(modelId)
      ?? this.builtinModels.get(modelId);
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return this.providerConfigs.get(providerId);
  }

  getAllProviderConfigs(): Map<string, ProviderConfig> {
    return new Map(this.providerConfigs);
  }

  discoverModel(modelId: string, config: Partial<ModelConfig>): void {
    this.discoveredModels.set(modelId, {
      firstParty: modelId,
      displayName: modelId,
      contextWindow: 200000,
      maxOutputTokens: 4096,
      ...config,
    } as ModelConfig);
  }

  /** 根据模型名查询内置键名 */
  getModelKeyByName(modelName: string): string | null {
    for (const [key, config] of this.builtinModels) {
      const providerKeys: (keyof ModelConfig)[] = ['firstParty', 'bedrock', 'vertex', 'azure', 'openai', 'deepseek', 'google', 'grok', 'moonshot', 'ollama'];
      for (const pk of providerKeys) {
        if ((config as unknown as Record<string, string>)[pk as string] === modelName) {
          return key;
        }
      }
    }
    return null;
  }

  /** 获取模型在指定提供商的名称 */
  getModelNameForProvider(modelKey: string, provider: APIProvider): string {
    const config = this.builtinModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** 获取指定提供商的模型列表 */
  getModelsByProvider(provider: APIProvider): string[] {
    const result: string[] = [];
    for (const [key, config] of this.builtinModels) {
      if ((config as unknown as Record<string, string>)[provider]) {
        result.push(key);
      }
    }
    return result;
  }

  /** 以 Record 形式返回所有模型（用于向后兼容 ALL_MODEL_CONFIGS） */
  getAllModelsAsRecord(): Record<string, ModelConfig> {
    const result: Record<string, ModelConfig> = {};
    for (const [key, config] of this.builtinModels) {
      result[key] = config;
    }
    for (const [key, config] of this.userModels) {
      result[key] = config;
    }
    for (const [key, config] of this.discoveredModels) {
      if (!result[key]) result[key] = config;
    }
    return result;
  }

  /** 获取模型在指定提供商的字段值 */
  getProviderField(modelKey: string, provider: APIProvider): string {
    const config = this.builtinModels.get(modelKey)
      ?? this.userModels.get(modelKey)
      ?? this.discoveredModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** 同步获取模型定价（用户YAML > 社区同步 > 内置YAML） */
  getModelPricing(modelName: string): { inputPer1M: number; outputPer1M: number } | null {
    const user = this.userPricing.get(modelName);
    if (user) return { inputPer1M: user.inputPer1M, outputPer1M: user.outputPer1M };

    const synced = this.syncedPricing.get(modelName);
    if (synced) return { inputPer1M: synced.inputPer1M, outputPer1M: synced.outputPer1M };

    const model = this.getModel(modelName);
    if (model?.pricing) return model.pricing;

    return null;
  }

  /** 异步获取模型定价（DB > 用户YAML > 社区同步 > 内置YAML，含 DB 用户自定义定价） */
  async getModelPricingAsync(
    modelName: string,
  ): Promise<{ inputPer1M: number; outputPer1M: number } | null> {
    // 1. DB 用户自定义定价（最高优先级）
    try {
      const { modelPricingService } = await import(
        '@modules/ai/models/ModelPricingService.js'
      );
      await modelPricingService.initialize();
      const dbPricing = await modelPricingService.getPricing(modelName);
      if (dbPricing) {
        return {
          inputPer1M: dbPricing.inputCostPerMillion,
          outputPer1M: dbPricing.outputCostPerMillion,
        };
      }
    } catch {
      // DB 不可用时回退
    }

    // 2-4. 同步定价链
    return this.getModelPricing(modelName);
  }

  async syncPricing(sourceUrl?: string): Promise<number> {
    const url = sourceUrl ?? DEFAULT_PRICING_SOURCE;
    const response = await fetch(url);
    const data = await response.json() as { pricing: Record<string, PricingOverride> };

    let count = 0;
    for (const [modelId, pricing] of Object.entries(data.pricing)) {
      this.syncedPricing.set(modelId, pricing);
      count++;
    }

    const cacheDir = join(resolvePyappHome(), 'cache');
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    writeFileSync(PRICING_CACHE_PATH, JSON.stringify(data), 'utf-8');

    return count;
  }

  private loadSyncedPricingCache(): void {
    if (existsSync(PRICING_CACHE_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(PRICING_CACHE_PATH, 'utf-8'));
        const data = raw as { pricing: Record<string, PricingOverride> };
        for (const [modelId, pricing] of Object.entries(data.pricing)) {
          this.syncedPricing.set(modelId, pricing);
        }
      } catch {
        // 缓存文件损坏时忽略
      }
    }
  }
}
