/**
 * 模型管理服务
 *
 * 模型选择统一委托 modelRouter（DB 驱动），不再硬编码模型名或供应商。
 * 保留 Anthropic 命名的方法作为 @deprecated 兼容层。
 */

import {
  isModelAlias,
  parseModelAlias,
  has1MSuffix,
  remove1MSuffix,
  supports1MContext,
  type ModelAlias,
} from './ModelAliases.js';
import {
  ALL_MODEL_CONFIGS,
  getModelKeyByName,
  getModelNameForProvider,
  type APIProvider,
  type ModelKey,
} from './ModelConfigs.js';
import { ModelRegistry } from './ModelRegistry.js';
import { configManager } from '@modules/config';
// eslint-disable-next-line module-registry/no-direct-module-import
import { calculateTotalCost } from '@modules/cost/calculateCost.js';
import type { ModelPricing } from '@modules/cost/ModelPricing.js';

export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'max'
  | 'team_standard'
  | 'team_premium'
  | 'enterprise';

export interface ModelManagerConfig {
  provider: APIProvider;
  subscriptionType: SubscriptionType;
  modelOverride?: string;
  enable1MContext?: boolean;
}

/** 从 modelRouter 获取当前默认模型 */
async function _resolveDefaultModel(): Promise<string> {
  try {
    const { modelRouter } = await import('../modelRouter.js');
    return (await modelRouter.resolve('default')) || '';
  } catch {
    return '';
  }
}

export class ModelManager {
  private static instance: ModelManager;
  private config: ModelManagerConfig;
  private modelStrings: Record<ModelKey, string>;
  private _dbDefaultModel: string = '';

  private constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = {
      provider: config.provider || ('firstParty' as APIProvider),
      subscriptionType: config.subscriptionType || 'free',
      enable1MContext: config.enable1MContext || false,
    };
    this.modelStrings = this.initializeModelStrings();
  }

  static getInstance(config?: Partial<ModelManagerConfig>): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager(config);
    }
    return ModelManager.instance;
  }

  private initializeModelStrings(): Record<ModelKey, string> {
    const strings: Record<ModelKey, string> = {} as Record<ModelKey, string>;
    for (const key of Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]) {
      strings[key] = getModelNameForProvider(key, this.config.provider);
    }
    return strings;
  }

  updateConfig(config: Partial<ModelManagerConfig>): void {
    this.config = { ...this.config, ...config };
    this.modelStrings = this.initializeModelStrings();
  }

  // ─── 通用模型选择（DB 驱动）────────────────────────

  /** 获取默认模型（DB 驱动，推荐使用） */
  async getDefaultModel(): Promise<string> {
    if (!this._dbDefaultModel) {
      this._dbDefaultModel = await _resolveDefaultModel();
    }
    return this._dbDefaultModel || this._legacyDefault();
  }

  /** 刷新默认模型缓存 */
  async refreshDefaultModel(): Promise<string> {
    this._dbDefaultModel = await _resolveDefaultModel();
    return this._dbDefaultModel || this._legacyDefault();
  }

  /** 获取模型信息列表（供命令层展示） */
  getModelInfoList(): Array<{ id: string; name: string; description: string }> {
    const registry = ModelRegistry.getInstance();
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string; description: string }> = [];

    for (const model of registry.getAllModels()) {
      const id = model.firstParty;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const pricing = model.pricing
        ? `(输入: $${model.pricing.inputPer1M}/1M, 输出: $${model.pricing.outputPer1M}/1M)`
        : '';
      result.push({
        id,
        name: model.displayName,
        description: `${(model.contextWindow ?? 200000).toLocaleString()} tokens 上下文, 最大输出 ${(model.maxOutputTokens ?? 4096).toLocaleString()} tokens ${pricing}`,
      });
    }

    for (const key of Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]) {
      const config = ALL_MODEL_CONFIGS[key];
      const id = config.firstParty;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const pricing = config.pricing
        ? `(输入: $${config.pricing.inputPer1M}/1M, 输出: $${config.pricing.outputPer1M}/1M)`
        : '';
      result.push({
        id,
        name: config.displayName,
        description: `${config.contextWindow.toLocaleString()} tokens 上下文, 最大输出 ${config.maxOutputTokens.toLocaleString()} tokens ${pricing}`,
      });
    }

    return result;
  }

  // ─── 模型查询（不涉及模型选择）────────────────────

  getModelDisplayName(modelName: string): string {
    const registry = ModelRegistry.getInstance();
    const model = registry.getModel(modelName);
    if (model) return model.displayName;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) return ALL_MODEL_CONFIGS[modelKey].displayName;
    return modelName;
  }

  getModelContextWindow(modelName: string): number {
    const registry = ModelRegistry.getInstance();
    const model = registry.getModel(modelName);
    if (model) return model.contextWindow;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) return ALL_MODEL_CONFIGS[modelKey].contextWindow;
    return 200000;
  }

  getModelMaxOutputTokens(modelName: string): number {
    const modelKey = getModelKeyByName(modelName);
    if (modelKey) return ALL_MODEL_CONFIGS[modelKey].maxOutputTokens;
    return 4096;
  }

  getModelPricing(
    modelName: string
  ): { inputPer1M: number; outputPer1M: number } | null {
    const registry = ModelRegistry.getInstance();
    const userPricing = registry.getModelPricing(modelName);
    if (userPricing) return userPricing;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) return ALL_MODEL_CONFIGS[modelKey].pricing || null;
    return null;
  }

  calculateCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number
  ): number | null {
    const pricing = this.getModelPricing(modelName);
    if (!pricing) return null;
    const modelPricing: ModelPricing = {
      inputPricePerMillion: pricing.inputPer1M,
      outputPricePerMillion: pricing.outputPer1M,
      cacheReadPricePerMillion: 0,
      cacheCreationPricePerMillion: 0,
      webSearchPricePerRequest: 0.01,
    };
    return calculateTotalCost(modelPricing, inputTokens, outputTokens);
  }

  getAvailableModels(): string[] {
    const registry = ModelRegistry.getInstance();
    const registryModels = registry
      .getAllModels()
      .map((m) => m.firstParty)
      .filter(Boolean);
    const builtinModels = Object.values(this.modelStrings).filter(
      (s) => s.length > 0
    );
    return Array.from(new Set([...builtinModels, ...registryModels]));
  }

  isModelAvailable(modelName: string): boolean {
    return this.getAvailableModels().includes(modelName);
  }

  parseModel(modelInput: string): string {
    if (isModelAlias(modelInput)) return parseModelAlias(modelInput);
    if (has1MSuffix(modelInput)) {
      const baseModel = remove1MSuffix(modelInput);
      if (supports1MContext(baseModel)) return baseModel;
    }
    return modelInput;
  }

  isValidModel(modelName: string): boolean {
    const registry = ModelRegistry.getInstance();
    if (registry.getModel(modelName)) return true;
    if (getModelKeyByName(modelName)) return true;
    return isModelAlias(modelName.toLowerCase());
  }

  resolveModel(modelInput: string): string | null {
    const lower = modelInput.toLowerCase();
    if (isModelAlias(lower)) return parseModelAlias(lower);
    const modelKey = getModelKeyByName(modelInput);
    if (modelKey) return ALL_MODEL_CONFIGS[modelKey].firstParty;
    return null;
  }

  getModelRegistry(): ModelRegistry {
    return ModelRegistry.getInstance();
  }

  getConfig(): ModelManagerConfig {
    return { ...this.config };
  }

  // ─── @deprecated — 以模型层级为区分的方法（继承自旧 Cluade 时代）────

  /** @deprecated 用 getDefaultModel() 替代 */
  private _legacyDefault(): string {
    return (
      configManager.env('DEFAULT_MODEL') ||
      configManager.env('ANTHROPIC_DEFAULT_SONNET_MODEL') ||
      this.modelStrings.sonnet46 ||
      ''
    );
  }

  /** @deprecated 用 getDefaultModel() 替代 */
  getBestModel(): string {
    return this._legacyDefault();
  }

  /** @deprecated 用 getDefaultModel() 替代 */
  getSmallFastModel(): string {
    return (
      configManager.env('DEFAULT_FAST_MODEL') ||
      configManager.env('ANTHROPIC_DEFAULT_HAIKU_MODEL') ||
      this.modelStrings.haiku45 ||
      ''
    );
  }

  /** @deprecated 用 getDefaultModel() 替代 */
  getDefaultMainLoopModel(): string {
    if (this.config.modelOverride)
      return this.parseModel(this.config.modelOverride);
    return (
      configManager.env('DEFAULT_MODEL') ||
      configManager.env('ANTHROPIC_DEFAULT_SONNET_MODEL') ||
      this.modelStrings.sonnet46 ||
      ''
    );
  }

  /** @deprecated */
  getDefaultOpusModel(): string {
    return (
      configManager.env('ANTHROPIC_DEFAULT_OPUS_MODEL') ||
      this.modelStrings.opus46 ||
      ''
    );
  }

  /** @deprecated */
  getDefaultSonnetModel(): string {
    return (
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
      this.modelStrings.sonnet46 ||
      ''
    );
  }

  /** @deprecated */
  getDefaultHaikuModel(): string {
    return (
      configManager.env('ANTHROPIC_DEFAULT_HAIKU_MODEL') ||
      this.modelStrings.haiku45 ||
      ''
    );
  }

  /** @deprecated 用 getDefaultModel() 替代 */
  getCurrentModel(): string {
    const envModel = configManager.env('Liri_MODEL');
    if (envModel && getModelKeyByName(envModel)) return envModel;
    const def = this._legacyDefault();
    if (def) process.env.Liri_MODEL = def;
    return def;
  }

  /** @deprecated */
  setCurrentModel(modelId: string): boolean {
    const resolved = this.resolveModel(modelId);
    if (resolved) {
      process.env.Liri_MODEL = resolved;
      this.config.modelOverride = resolved;
      return true;
    }
    return false;
  }

  /** @deprecated */
  getFallbackModel(): string {
    const fallback = configManager.env('Liri_FALLBACK_MODEL');
    if (fallback) return fallback;
    return this.getSmallFastModel();
  }

  /** @deprecated */
  getModelWithFallback(primary?: string): {
    primary: string;
    fallback: string;
  } {
    const main = primary || this.getDefaultMainLoopModel();
    return { primary: main, fallback: this.getFallbackModel() };
  }
}

export const modelManager = ModelManager.getInstance();
