/**
 * AI模型管理服务
 * 实现模型别名、上下文窗口管理和模型显示优化
 */

import type { ThinkingConfig, ThinkingEffort } from './clients/thinking';
import {
  buildThinkingConfig,
  EFFORT_TO_BUDGET,
  DEFAULT_THINKING_EFFORT,
  DEFAULT_THINKING_BUDGET_TOKENS,
} from './clients/thinking';

export const MODEL_ALIASES = [
  'sonnet',
  'opus',
  'haiku',
  'best',
  'sonnet[1m]',
  'opus[1m]',
  'opusplan',
] as const;

export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const MODEL_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

export interface ModelContextWindow {
  model: string;
  contextWindow: number;
  supports1M: boolean;
}

export interface ModelDisplayConfig {
  model: string;
  displayName: string;
  pricing?: {
    input: number;
    output: number;
  };
  family: 'opus' | 'sonnet' | 'haiku' | 'other';
}

export class AIModelManager {
  private static instance: AIModelManager;
  private modelContextWindows: Map<string, ModelContextWindow>;
  private modelDisplayConfigs: Map<string, ModelDisplayConfig>;
  private modelAliases: Map<string, string>;
  private defaultThinkingEffort: ThinkingEffort;
  private thinkingEnabled: boolean;

  private constructor() {
    this.modelContextWindows = new Map();
    this.modelDisplayConfigs = new Map();
    this.modelAliases = new Map();
    this.defaultThinkingEffort = DEFAULT_THINKING_EFFORT;
    this.thinkingEnabled = process.env.DISABLE_THINKING !== 'true' && process.env.DISABLE_THINKING !== '1';
    this.initializeDefaults();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AIModelManager {
    if (!AIModelManager.instance) {
      AIModelManager.instance = new AIModelManager();
    }
    return AIModelManager.instance;
  }

  /**
   * 初始化默认配置
   */
  private initializeDefaults(): void {
    // 初始化模型上下文窗口
    this.addModelContextWindow({
      model: 'claude-3-opus-20240229',
      contextWindow: 200000,
      supports1M: false,
    });
    
    this.addModelContextWindow({
      model: 'claude-3-sonnet-20240229',
      contextWindow: 200000,
      supports1M: false,
    });
    
    this.addModelContextWindow({
      model: 'claude-3-haiku-20240307',
      contextWindow: 200000,
      supports1M: false,
    });
    
    this.addModelContextWindow({
      model: 'claude-3-5-sonnet-20240620',
      contextWindow: 200000,
      supports1M: false,
    });
    
    this.addModelContextWindow({
      model: 'claude-3-5-sonnet-20240620[1m]',
      contextWindow: 1000000,
      supports1M: true,
    });
    
    this.addModelContextWindow({
      model: 'claude-3-5-haiku-20240620',
      contextWindow: 200000,
      supports1M: false,
    });
    
    // 初始化模型显示配置
    this.addModelDisplayConfig({
      model: 'claude-3-opus-20240229',
      displayName: 'Opus 3',
      family: 'opus',
    });
    
    this.addModelDisplayConfig({
      model: 'claude-3-sonnet-20240229',
      displayName: 'Sonnet 3',
      family: 'sonnet',
    });
    
    this.addModelDisplayConfig({
      model: 'claude-3-haiku-20240307',
      displayName: 'Haiku 3',
      family: 'haiku',
    });
    
    this.addModelDisplayConfig({
      model: 'claude-3-5-sonnet-20240620',
      displayName: 'Sonnet 3.5',
      family: 'sonnet',
    });
    
    this.addModelDisplayConfig({
      model: 'claude-3-5-sonnet-20240620[1m]',
      displayName: 'Sonnet 3.5 (1M context)',
      family: 'sonnet',
    });
    
    this.addModelDisplayConfig({
      model: 'claude-3-5-haiku-20240620',
      displayName: 'Haiku 3.5',
      family: 'haiku',
    });
    
    // 初始化模型别名
    this.modelAliases.set('opus', 'claude-3-opus-20240229');
    this.modelAliases.set('sonnet', 'claude-3-5-sonnet-20240620');
    this.modelAliases.set('haiku', 'claude-3-5-haiku-20240620');
    this.modelAliases.set('best', 'claude-3-opus-20240229');
    this.modelAliases.set('sonnet[1m]', 'claude-3-5-sonnet-20240620[1m]');
    this.modelAliases.set('opus[1m]', 'claude-3-opus-20240229'); // Opus 3 不支持1M
  }

  /**
   * 添加模型上下文窗口配置
   */
  addModelContextWindow(window: ModelContextWindow): void {
    this.modelContextWindows.set(window.model, window);
  }

  /**
   * 添加模型显示配置
   */
  addModelDisplayConfig(config: ModelDisplayConfig): void {
    this.modelDisplayConfigs.set(config.model, config);
  }

  /**
   * 检查是否为模型别名
   */
  isModelAlias(model: string): model is ModelAlias {
    return MODEL_ALIASES.includes(model as ModelAlias);
  }

  /**
   * 检查是否为模型族别名
   */
  isModelFamilyAlias(model: string): boolean {
    return (MODEL_FAMILY_ALIASES as readonly string[]).includes(model);
  }

  /**
   * 解析用户指定的模型
   */
  parseUserSpecifiedModel(modelInput: string): string {
    const modelInputTrimmed = modelInput.trim();
    const normalizedModel = modelInputTrimmed.toLowerCase();

    // 检查是否为别名
    if (this.isModelAlias(normalizedModel)) {
      const resolved = this.modelAliases.get(normalizedModel);
      if (resolved) {
        return resolved;
      }
    }

    // 检查是否带有[1m]后缀
    const has1mTag = normalizedModel.includes('[1m]');
    const modelString = has1mTag
      ? normalizedModel.replace(/\[1m]$/i, '').trim()
      : normalizedModel;

    // 检查基础别名
    if (this.isModelFamilyAlias(modelString)) {
      const baseModel = this.modelAliases.get(modelString);
      if (baseModel) {
        return has1mTag ? baseModel + '[1m]' : baseModel;
      }
    }

    return modelInputTrimmed;
  }

  /**
   * 检查模型是否支持1M上下文
   */
  supports1MContext(model: string): boolean {
    const resolvedModel = this.parseUserSpecifiedModel(model);
    const window = this.modelContextWindows.get(resolvedModel);
    return window?.supports1M || false;
  }

  /**
   * 获取模型上下文窗口大小
   */
  getContextWindow(model: string): number {
    const resolvedModel = this.parseUserSpecifiedModel(model);
    const window = this.modelContextWindows.get(resolvedModel);
    return window?.contextWindow || 200000; // 默认200k
  }

  /**
   * 获取模型显示名称
   */
  getModelDisplayName(model: string): string {
    const resolvedModel = this.parseUserSpecifiedModel(model);
    const config = this.modelDisplayConfigs.get(resolvedModel);
    if (config) {
      return config.displayName;
    }
    
    // 尝试不带[1m]的版本
    const baseModel = resolvedModel.replace(/\[1m]$/i, '');
    const baseConfig = this.modelDisplayConfigs.get(baseModel);
    if (baseConfig) {
      return resolvedModel.includes('[1m]') 
        ? `${baseConfig.displayName} (1M context)`
        : baseConfig.displayName;
    }
    
    return model; //  fallback to original model name
  }

  /**
   * 获取模型价格字符串
   */
  getModelPricingString(model: string): string {
    const resolvedModel = this.parseUserSpecifiedModel(model);
    const config = this.modelDisplayConfigs.get(resolvedModel);
    
    if (config?.pricing) {
      return `$${config.pricing.input.toFixed(4)}/$${config.pricing.output.toFixed(4)} per 1K tokens`;
    }
    
    return '';
  }

  /**
   * 获取模型族
   */
  getModelFamily(model: string): string {
    const resolvedModel = this.parseUserSpecifiedModel(model);
    const config = this.modelDisplayConfigs.get(resolvedModel);
    return config?.family || 'other';
  }

  /**
   * 标准化模型字符串用于API
   */
  normalizeModelStringForAPI(model: string): string {
    return model.replace(/\[(1|2)m\]/gi, '');
  }

  /**
   * 检查模型是否存在
   */
  hasModel(model: string): boolean {
    const resolvedModel = this.parseUserSpecifiedModel(model);
    return this.modelDisplayConfigs.has(resolvedModel) || 
           this.modelContextWindows.has(resolvedModel);
  }

  /**
   * 获取所有可用模型
   */
  getAvailableModels(): string[] {
    return Array.from(this.modelDisplayConfigs.keys());
  }

  setDefaultThinkingEffort(effort: ThinkingEffort): void {
    this.defaultThinkingEffort = effort;
  }

  getDefaultThinkingEffort(): ThinkingEffort {
    const envEffort = process.env.THINKING_EFFORT as ThinkingEffort | undefined;
    if (envEffort && ['low', 'medium', 'high'].includes(envEffort)) {
      return envEffort;
    }
    return this.defaultThinkingEffort;
  }

  setThinkingEnabled(enabled: boolean): void {
    this.thinkingEnabled = enabled;
  }

  isThinkingEnabled(): boolean {
    return this.thinkingEnabled;
  }

  getThinkingConfig(model?: string, effort?: ThinkingEffort): ThinkingConfig {
    if (!this.thinkingEnabled) {
      return { type: 'disabled' };
    }

    const effectiveEffort = effort ?? this.getDefaultThinkingEffort();
    const budgetTokens = EFFORT_TO_BUDGET[effectiveEffort] ?? DEFAULT_THINKING_BUDGET_TOKENS;

    return buildThinkingConfig({
      effort: effectiveEffort,
      budgetTokens,
    });
  }

  getThinkingBudgetForModel(model: string, effort?: ThinkingEffort): number {
    const effectiveEffort = effort ?? this.getDefaultThinkingEffort();
    return EFFORT_TO_BUDGET[effectiveEffort] ?? DEFAULT_THINKING_BUDGET_TOKENS;
  }

  /**
   * 获取所有模型别名
   */
  getModelAliases(): string[] {
    return [...MODEL_ALIASES];
  }
}

/**
 * 获取AI模型管理服务实例
 */
export function getAIModelManager(): AIModelManager {
  return AIModelManager.getInstance();
}

/**
 * 解析用户指定的模型（便捷函数）
 */
export function parseUserSpecifiedModel(model: string): string {
  const manager = getAIModelManager();
  return manager.parseUserSpecifiedModel(model);
}

/**
 * 检查模型是否支持1M上下文（便捷函数）
 */
export function supports1MContext(model: string): boolean {
  const manager = getAIModelManager();
  return manager.supports1MContext(model);
}

/**
 * 获取模型上下文窗口大小（便捷函数）
 */
export function getContextWindow(model: string): number {
  const manager = getAIModelManager();
  return manager.getContextWindow(model);
}

/**
 * 获取模型显示名称（便捷函数）
 */
export function getModelDisplayName(model: string): string {
  const manager = getAIModelManager();
  return manager.getModelDisplayName(model);
}

/**
 * 获取模型价格字符串（便捷函数）
 */
export function getModelPricingString(model: string): string {
  const manager = getAIModelManager();
  return manager.getModelPricingString(model);
}

export function getThinkingConfig(model?: string, effort?: ThinkingEffort): ThinkingConfig {
  const manager = getAIModelManager();
  return manager.getThinkingConfig(model, effort);
}

export function setDefaultThinkingEffort(effort: ThinkingEffort): void {
  const manager = getAIModelManager();
  manager.setDefaultThinkingEffort(effort);
}

export function getDefaultThinkingEffort(): ThinkingEffort {
  const manager = getAIModelManager();
  return manager.getDefaultThinkingEffort();
}

export function setThinkingEnabled(enabled: boolean): void {
  const manager = getAIModelManager();
  manager.setThinkingEnabled(enabled);
}

export function isThinkingEnabled(): boolean {
  const manager = getAIModelManager();
  return manager.isThinkingEnabled();
}
