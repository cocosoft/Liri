/**
 * 运行时模型注册表
 *
 * 模型定义（displayName, contextWindow, capabilities, providerMappings）从 YAML 加载。
 * 模型定价 + 启停状态统一从 DB（model_registry 表，通过 ModelPricingService）加载。
 *
 * YAML 是模型定义的播种源，DB 是定价和启停的单一事实来源。
 * 删除旧的 4 级定价回退链，改为单一路径：DB → 内存缓存。
 */

import { ModelConfig, APIProvider } from './ModelConfigs.js';
import { ModelCapability } from './types.js';
import {
  loadDefaultModels,
  type ModelYamlConfig,
} from '../config/defaultModels.js';
import {
  loadProvidersConfig,
  loadModelsConfig,
  type ProviderConfig,
} from '../config/ConfigLoader.js';

const API_PROVIDER_KEYS: APIProvider[] = [
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

/** 将 YAML 格式的 providers 映射转换为平面字段 */
function yamlEntryToModelConfig(
  entry: ModelYamlConfig,
  key: string
): ModelConfig {
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
    ...(providers as unknown as ModelConfig),
    displayName: entry.displayName,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    ...(caps.length > 0 && { capabilities: caps }),
    ...(entry.pricing && { pricing: entry.pricing }),
    ...(entry.extendedContextWindows && {
      extendedContextWindows: entry.extendedContextWindows,
    }),
  };
}

/**
 * 运行时模型注册表
 *
 * 模型定义 + 定价双源设计：
 * - 模型定义（字段、能力、provider 映射）→ YAML 加载 → builtinModels
 * - 模型定价 + 启停 → DB model_registry → 内存缓存
 */
export class ModelRegistry {
  private static instance: ModelRegistry;

  private builtinModels: Map<string, ModelConfig> = new Map();
  private userModels: Map<string, ModelConfig> = new Map();
  private discoveredModels: Map<string, ModelConfig> = new Map();

  private providerConfigs: Map<string, ProviderConfig> = new Map();

  /** DB 中加载的定价缓存，键为 modelId（唯一来源） */
  private dbPricing: Map<string, { inputPer1M: number; outputPer1M: number }> =
    new Map();

  private constructor() {
    // 启动时通过 loadDefaultModels + loadDbPricing 初始化
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

  /** 从 ModelPricingService（DB）加载定价到内存缓存 */
  async loadDbPricing(): Promise<void> {
    try {
      const { modelPricingService } = await import(
        '@modules/ai/models/ModelPricingService.js'
      );
      await modelPricingService.initialize();
      const all = await modelPricingService.getAllPricing();
      this.dbPricing.clear();
      for (const rec of all) {
        this.dbPricing.set(rec.modelId, {
          inputPer1M: rec.inputCostPerMillion,
          outputPer1M: rec.outputCostPerMillion,
        });
      }
    } catch {
      // DB 不可用时持有空 Map，getModelPricing 返回 null
    }
  }

  /** 加载用户配置（providers.yaml + models.yaml）— 不含 pricing，pricing 统一走 DB */
  loadUserConfigs(): void {
    const providersCfg = loadProvidersConfig();
    const modelsCfg = loadModelsConfig();

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
          ...(override.capabilities && {
            capabilities: override.capabilities as ModelCapability[],
          }),
        });
      } else {
        const existing = this.builtinModels.get(modelId);
        this.userModels.set(modelId, {
          ...(existing ?? ({} as ModelConfig)),
          firstParty: modelId,
          displayName: override.displayName ?? existing?.displayName ?? modelId,
          contextWindow:
            override.contextWindow ?? existing?.contextWindow ?? 200000,
          maxOutputTokens:
            override.maxOutputTokens ?? existing?.maxOutputTokens ?? 4096,
          ...(override.capabilities && {
            capabilities: override.capabilities as ModelCapability[],
          }),
        });
      }
    }
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
    return (
      this.userModels.get(modelId) ??
      this.discoveredModels.get(modelId) ??
      this.builtinModels.get(modelId)
    );
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
    const config =
      this.builtinModels.get(modelKey) ??
      this.userModels.get(modelKey) ??
      this.discoveredModels.get(modelKey);
    if (!config) return '';
    return (config as unknown as Record<string, string>)[provider] || '';
  }

  /** 获取模型定价 — 统一来源：DB → 内存缓存 */
  getModelPricing(
    modelName: string
  ): { inputPer1M: number; outputPer1M: number } | null {
    // 1. DB 定价（唯一来源）
    const db = this.dbPricing.get(modelName);
    if (db) return db;

    // 2. fallback: YAML 内置定价（作为默认值，但用户可修改覆盖）
    const model = this.getModel(modelName);
    if (model?.pricing) return model.pricing;

    return null;
  }

  /** 异步获取模型定价 — 从 DB 实时查询（更精确，例如用于计费） */
  async getModelPricingAsync(
    modelName: string
  ): Promise<{ inputPer1M: number; outputPer1M: number } | null> {
    try {
      const { modelPricingService } = await import(
        '@modules/ai/models/ModelPricingService.js'
      );
      // 确保已初始化
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
    return this.getModelPricing(modelName);
  }

  /** 刷新 DB 定价缓存（API upsert/toggle 后调用） */
  async refreshDbPricing(): Promise<void> {
    await this.loadDbPricing();
  }
}
