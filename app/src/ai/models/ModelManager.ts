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
    return (
      process.env.ANTHROPIC_SMALL_FAST_MODEL || this.getDefaultHaikuModel()
    );
  }

  /**
   * 获取默认主循环模型
   */
  getDefaultMainLoopModel(): string {
    if (this.config.modelOverride) {
      return this.parseModel(this.config.modelOverride);
    }

    if (
      this.config.subscriptionType === 'max' ||
      this.config.subscriptionType === 'team_premium'
    ) {
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
  getModelPricing(
    modelName: string
  ): { inputPer1M: number; outputPer1M: number } | null {
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
   */
  getAvailableModels(): string[] {
    return Object.values(this.modelStrings).filter((s) => s.length > 0);
  }

  /**
   * 检查模型是否可用
   */
  isModelAvailable(modelName: string): boolean {
    return this.getAvailableModels().includes(modelName);
  }

  /**
   * 获取模型信息列表（供命令层展示）
   */
  getModelInfoList(): Array<{ id: string; name: string; description: string }> {
    const modelKeys = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[];
    return modelKeys
      .filter((key) => ALL_MODEL_CONFIGS[key].firstParty.length > 0)
      .map((key) => {
        const config = ALL_MODEL_CONFIGS[key];
        const id = config.firstParty;
        const pricing = config.pricing
          ? `(输入: $${config.pricing.inputPer1M}/1M, 输出: $${config.pricing.outputPer1M}/1M)`
          : '';
        return {
          id,
          name: config.displayName,
          description: `${config.contextWindow.toLocaleString()} tokens 上下文, 最大输出 ${config.maxOutputTokens.toLocaleString()} tokens ${pricing}`,
        };
      });
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
   * 检查模型是否有效（在配置中存在或为有效别名）
   */
  isValidModel(modelName: string): boolean {
    if (getModelKeyByName(modelName)) {
      return true;
    }
    const lower = modelName.toLowerCase();
    if (isModelAlias(lower)) {
      return true;
    }
    return false;
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
