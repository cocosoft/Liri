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

  private constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = {
      provider: config.provider || 'firstParty',
      subscriptionType: config.subscriptionType || 'free',
      enable1MContext: config.enable1MContext || false,
    };
    this.modelStrings = this.initializeModelStrings();
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<ModelManagerConfig>): ModelManager {
    if (!ModelManager.instance) {
      ModelManager.instance = new ModelManager(config);
    }
    return ModelManager.instance;
  }

  /**
   * 初始化模型字符串
   */
  private initializeModelStrings(): Record<ModelKey, string> {
    const strings: Record<ModelKey, string> = {} as Record<ModelKey, string>;
    for (const key of Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]) {
      strings[key] = getModelNameForProvider(key, this.config.provider);
    }
    return strings;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ModelManagerConfig>): void {
    this.config = { ...this.config, ...config };
    this.modelStrings = this.initializeModelStrings();
  }

  /**
   * 获取默认Opus模型
   */
  getDefaultOpusModel(): string {
    if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
      return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    }
    return this.modelStrings.opus46;
  }

  /**
   * 获取默认Sonnet模型
   */
  getDefaultSonnetModel(): string {
    if (process.env.ANTHROPIC_DEFAULT_SONNET_MODEL) {
      return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    }
    return this.modelStrings.sonnet46;
  }

  /**
   * 获取默认Haiku模型
   */
  getDefaultHaikuModel(): string {
    if (process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
      return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    }
    return this.modelStrings.haiku45;
  }

  /**
   * 获取最佳模型
   */
  getBestModel(): string {
    return this.getDefaultOpusModel();
  }

  /**
   * 获取小型快速模型
   */
  getSmallFastModel(): string {
    return process.env.ANTHROPIC_SMALL_FAST_MODEL || this.getDefaultHaikuModel();
  }

  /**
   * 获取默认主循环模型
   */
  getDefaultMainLoopModel(): string {
    if (this.config.modelOverride) {
      return this.parseModel(this.config.modelOverride);
    }

    if (this.config.subscriptionType === 'max' || 
        this.config.subscriptionType === 'team_premium') {
      const opusModel = this.getDefaultOpusModel();
      return this.config.enable1MContext && supports1MContext(opusModel)
        ? `${opusModel}[1m]`
        : opusModel;
    }

    return this.getDefaultSonnetModel();
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
   */
  getModelDisplayName(modelName: string): string {
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
   */
  getModelPricing(modelName: string): { inputPer1K: number; outputPer1K: number } | null {
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

    const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
    return inputCost + outputCost;
  }

  /**
   * 获取所有可用模型
   */
  getAvailableModels(): string[] {
    return Object.values(this.modelStrings).filter(s => s.length > 0);
  }

  /**
   * 检查模型是否可用
   */
  isModelAvailable(modelName: string): boolean {
    return this.getAvailableModels().includes(modelName);
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
