/**
 * 模型管理服务
 * 提供模型选择、别名处理、配置管理等功能
 * 参考CC源码: cc_code/backend/utils/model/model.ts
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
import {
  ModelSelectionStrategy,
  getModelSelectionStrategy,
} from './ModelSelectionStrategy.js';

/**
 * 用户订阅类型
 */
export type SubscriptionType =
  | 'free'
  | 'pro'
  | 'max'
  | 'team_standard'
  | 'team_premium'
  | 'enterprise';

/**
 * 模型管理器配置
 */
export interface ModelManagerConfig {
  provider: APIProvider;
  subscriptionType: SubscriptionType;
  modelOverride?: string;
  enable1MContext?: boolean;
}

/**
 * 模型管理器类
 */
export class ModelManager {
  private static instance: ModelManager;
  private config: ModelManagerConfig;
  private modelStrings: Record<ModelKey, string>;
  private strategy: ModelSelectionStrategy;

  private constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = {
      provider: config.provider || 'deepseek',
      subscriptionType: config.subscriptionType || 'free',
      enable1MContext: config.enable1MContext || false,
    };
    this.modelStrings = this.initializeModelStrings();
    this.strategy = getModelSelectionStrategy(this.config.provider);
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
    this.strategy = getModelSelectionStrategy(this.config.provider);
  }

  getBestModel(): string {
    return this.strategy.getBestModel();
  }

  getSmallFastModel(): string {
    return this.strategy.getSmallFastModel();
  }

  getDefaultMainLoopModel(): string {
    if (this.config.modelOverride) {
      return this.parseModel(this.config.modelOverride);
    }
    return this.strategy.getDefaultMainLoopModel(this.config);
  }

  getDefaultModel(): string {
    return this.strategy.getDefaultModel();
  }

  getDefaultOpusModel(): string {
    return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || this.modelStrings.opus46;
  }

  getDefaultSonnetModel(): string {
    return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || this.modelStrings.sonnet46;
  }

  getDefaultHaikuModel(): string {
    return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || this.modelStrings.haiku45;
  }

  /**
   * 解析用户指定的模型
   */
  parseModel(modelInput: string): string {
    if (isModelAlias(modelInput)) {
      return parseModelAlias(modelInput);
    }

    if (has1MSuffix(modelInput)) {
      const baseModel = remove1MSuffix(modelInput);
      if (supports1MContext(baseModel)) {
        return baseModel;
      }
    }

    return modelInput;
  }

  /**
   * 获取模型显示名称
   * 优先从 ModelRegistry（用户配置/运行时发现）查询，回退到内置配置
   */
  getModelDisplayName(modelName: string): string {
    const registry = ModelRegistry.getInstance();
    const model = registry.getModel(modelName);
    if (model) return model.displayName;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) {
      return ALL_MODEL_CONFIGS[modelKey].displayName;
    }
    return modelName;
  }

  /**
   * 获取模型上下文窗口大小
   */
  getModelContextWindow(modelName: string): number {
    const registry = ModelRegistry.getInstance();
    const model = registry.getModel(modelName);
    if (model) return model.contextWindow;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) {
      return ALL_MODEL_CONFIGS[modelKey].contextWindow;
    }
    return 200000;
  }

  /**
   * 获取模型最大输出token数
   */
  getModelMaxOutputTokens(modelName: string): number {
    const modelKey = getModelKeyByName(modelName);
    if (modelKey) {
      return ALL_MODEL_CONFIGS[modelKey].maxOutputTokens;
    }
    return 4096;
  }

  /**
   * 获取模型定价信息
   * 优先从 ModelRegistry（用户覆盖/社区同步）查询，回退到内置配置
   */
  getModelPricing(
    modelName: string
  ): { inputPer1M: number; outputPer1M: number } | null {
    const registry = ModelRegistry.getInstance();
    const userPricing = registry.getModelPricing(modelName);
    if (userPricing) return userPricing;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) {
      return ALL_MODEL_CONFIGS[modelKey].pricing || null;
    }
    return null;
  }

  /**
   * 计算成本
   */
  calculateCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number
  ): number | null {
    const pricing = this.getModelPricing(modelName);
    if (!pricing) {
      return null;
    }

    const inputCost = (inputTokens / 1000000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1000000) * pricing.outputPer1M;
    return inputCost + outputCost;
  }

  /**
   * 获取所有可用模型
   * 合并 ModelRegistry（用户配置/运行时发现）和内置模型
   */
  getAvailableModels(): string[] {
    const registry = ModelRegistry.getInstance();
    const registryModels = registry.getAllModels().map(m => m.firstParty).filter(Boolean);
    const builtinModels = Object.values(this.modelStrings).filter((s) => s.length > 0);
    return Array.from(new Set([...builtinModels, ...registryModels]));
  }

  /**
   * 检查模型是否可用
   */
  isModelAvailable(modelName: string): boolean {
    return this.getAvailableModels().includes(modelName);
  }

  /**
   * 获取模型信息列表（供命令层展示）
   * 合并 ModelRegistry 和内置模型
   */
  getModelInfoList(): Array<{ id: string; name: string; description: string }> {
    const registry = ModelRegistry.getInstance();
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string; description: string }> = [];

    // 先添加 ModelRegistry 中的用户模型/运行时发现模型
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

    // 再添加内置模型中未出现的
    const modelKeys = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[];
    for (const key of modelKeys) {
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

  /**
   * 获取配置中的降级模型
   * 当主力模型不可用时自动回退
   */
  getFallbackModel(): string {
    const fallback = process.env.Liri_FALLBACK_MODEL;
    if (fallback) return fallback;
    return this.getSmallFastModel();
  }

  /**
   * 获取带降级的模型
   * 如果后续检测到主力不可用，可以调用此方法获取备用
   */
  getModelWithFallback(primary?: string): { primary: string; fallback: string } {
    const main = primary || this.getDefaultMainLoopModel();
    return {
      primary: main,
      fallback: this.getFallbackModel(),
    };
  }

  /**
   * 获取当前模型
   */
  getCurrentModel(): string {
    const envModel = process.env.Liri_MODEL;
    if (envModel) {
      const modelKey = getModelKeyByName(envModel);
      if (modelKey) {
        return envModel;
      }
    }
    const defaultModel = this.getDefaultMainLoopModel();
    process.env.Liri_MODEL = defaultModel;
    return defaultModel;
  }

  /**
   * 设置当前模型
   */
  setCurrentModel(modelId: string): boolean {
    const resolved = this.resolveModel(modelId);
    if (resolved) {
      process.env.Liri_MODEL = resolved;
      this.config.modelOverride = resolved;
      return true;
    }
    return false;
  }

  /**
   * 检查模型是否有效（在 ModelRegistry 或内置配置中存在，或为有效别名）
   */
  isValidModel(modelName: string): boolean {
    const registry = ModelRegistry.getInstance();
    if (registry.getModel(modelName)) return true;
    if (getModelKeyByName(modelName)) return true;

    const lower = modelName.toLowerCase();
    if (isModelAlias(lower)) return true;

    return false;
  }

  /**
   * 获取 ModelRegistry 实例（供外部使用）
   */
  getModelRegistry(): ModelRegistry {
    return ModelRegistry.getInstance();
  }

  /**
   * 解析模型输入（别名或完整ID），返回规范模型ID或null
   */
  resolveModel(modelInput: string): string | null {
    const lower = modelInput.toLowerCase();
    if (isModelAlias(lower)) {
      return parseModelAlias(lower);
    }
    const modelKey = getModelKeyByName(modelInput);
    if (modelKey) {
      return ALL_MODEL_CONFIGS[modelKey].firstParty;
    }
    return null;
  }

  /**
   * 获取当前配置
   */
  getConfig(): ModelManagerConfig {
    return { ...this.config };
  }
}

/**
 * 导出单例
 */
export const modelManager = ModelManager.getInstance();
