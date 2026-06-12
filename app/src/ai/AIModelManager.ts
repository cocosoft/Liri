/**
 * AI模型管理服务
 * 实现模型别名、上下文窗口管理和模型显示优化
 * 模型数据统一委托给 ModelManager（ModelConfigs 为唯一数据源）
 */

import type { AIProvider } from './providers/AIProvider';
import { providerRegistry } from './providers/ProviderRegistry';
import type { ThinkingConfig, ThinkingEffort } from './clients/thinking';
import {
  buildThinkingConfig,
  getThinkingBudgetForModel,
  DEFAULT_THINKING_EFFORT,
} from './clients/thinking';
import {
  MODEL_FAMILY_ALIASES,
  parseModelAlias,
  getModelFamily as getAliasFamily,
  supports1MContext as aliasSupports1MContext,
} from './models/ModelAliases.js';
import { modelManager } from './models/ModelManager.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { configManager } from '@modules/config';

export const MODEL_ALIASES = ['best', 'pro', 'flash', 'fast'] as const;

export type ModelAlias = (typeof MODEL_ALIASES)[number];

export class AIModelManager {
  private static instance: AIModelManager;
  private defaultThinkingEffort: ThinkingEffort;
  private thinkingEnabled: boolean;

  private constructor() {
    this.defaultThinkingEffort = DEFAULT_THINKING_EFFORT;
    this.thinkingEnabled =
      configManager.env('DISABLE_THINKING') !== 'true' &&
      configManager.env('DISABLE_THINKING') !== '1';
    // 构造函数中验证 modelManager 可用性，避免运行时委托调用失败
    this.ensureModelManager();
  }

  /**
   * 验证 modelManager 实例可用性
   * 防止因模块加载时序或初始化顺序导致 modelManager 不可用
   */
  private ensureModelManager(): void {
    if (!modelManager) {
      throw new AppError(
        'AIModelManager: modelManager is not available. ' +
          'Ensure ModelManager is initialized before using AIModelManager.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (typeof modelManager.getModelContextWindow !== 'function') {
      throw new AppError(
        'AIModelManager: modelManager instance is invalid. ' +
          'Expected ModelManager with getModelContextWindow method.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
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
   * 检查是否为模型别名
   */
  isModelAlias(model: string): model is ModelAlias {
    return (MODEL_ALIASES as readonly string[]).includes(model);
  }

  /**
   * 检查是否为模型族别名
   */
  isModelFamilyAlias(model: string): boolean {
    return (MODEL_FAMILY_ALIASES as readonly string[]).includes(model);
  }

  /**
   * 解析用户指定的模型 — 委托给 ModelAliases
   */
  parseUserSpecifiedModel(modelInput: string): string {
    const trimmed = modelInput.trim();
    const lower = trimmed.toLowerCase();

    if (lower === 'opusplan') {
      return 'opusplan';
    }

    if (this.isModelAlias(lower)) {
      return parseModelAlias(lower as any);
    }

    const baseInput = lower.replace(/\[1m]$/i, '').trim();

    if (this.isModelFamilyAlias(baseInput)) {
      return parseModelAlias(baseInput as any);
    }

    return trimmed;
  }

  /**
   * 检查模型是否支持1M上下文 — 委托给 ModelAliases
   */
  supports1MContext(model: string): boolean {
    const resolved = this.parseUserSpecifiedModel(model);
    return aliasSupports1MContext(resolved);
  }

  /**
   * 获取模型上下文窗口大小 — 委托给 ModelManager
   */
  getContextWindow(model: string): number {
    this.ensureModelManager();
    const resolved = this.parseUserSpecifiedModel(model);
    return modelManager.getModelContextWindow(resolved);
  }

  /**
   * 获取模型显示名称 — 委托给 ModelManager
   */
  getModelDisplayName(model: string): string {
    this.ensureModelManager();
    const resolved = this.parseUserSpecifiedModel(model);
    return modelManager.getModelDisplayName(resolved);
  }

  /**
   * 获取模型价格字符串 — 委托给 ModelManager
   */
  getModelPricingString(model: string): string {
    this.ensureModelManager();
    const resolved = this.parseUserSpecifiedModel(model);
    const pricing = modelManager.getModelPricing(resolved);
    if (pricing) {
      return `$${pricing.inputPer1M}/$${pricing.outputPer1M} per 1M tokens`;
    }
    return '';
  }

  /**
   * 获取模型族 — 委托给 ModelAliases
   */
  getModelFamily(model: string): string {
    const resolved = this.parseUserSpecifiedModel(model);
    const family = getAliasFamily(resolved);
    return family || 'other';
  }

  /**
   * 标准化模型字符串用于API
   */
  normalizeModelStringForAPI(model: string): string {
    return model.replace(/\[(1|2)m\]/gi, '');
  }

  /**
   * 检查模型是否存在 — 委托给 ModelManager
   */
  hasModel(model: string): boolean {
    this.ensureModelManager();
    const resolved = this.parseUserSpecifiedModel(model);
    return modelManager.isValidModel(resolved);
  }

  /**
   * 获取所有可用模型 — 委托给 ModelManager
   */
  getAvailableModels(): string[] {
    this.ensureModelManager();
    return modelManager.getAvailableModels();
  }

  /**
   * 获取所有模型别名
   */
  getModelAliases(): string[] {
    return [...MODEL_ALIASES];
  }

  setDefaultThinkingEffort(effort: ThinkingEffort): void {
    this.defaultThinkingEffort = effort;
  }

  getDefaultThinkingEffort(): ThinkingEffort {
    const envEffort = configManager.env('THINKING_EFFORT') as ThinkingEffort | undefined;
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
    const budgetTokens = model
      ? getThinkingBudgetForModel(model, effectiveEffort)
      : undefined;

    return buildThinkingConfig(
      {
        effort: effectiveEffort,
        budgetTokens,
      },
      model
    );
  }

  getThinkingBudgetForModel(model: string, effort?: ThinkingEffort): number {
    const effectiveEffort = effort ?? this.getDefaultThinkingEffort();
    return getThinkingBudgetForModel(model, effectiveEffort);
  }

  getProvider(providerId?: string): AIProvider {
    if (providerId) {
      return providerRegistry.get(providerId);
    }
    return providerRegistry.getDefaultProvider();
  }

  getProviderForModel(model: string): AIProvider | undefined {
    const resolved = this.parseUserSpecifiedModel(model);

    // 统一委托给 ProviderRegistry 的集中式映射表
    // modelToProvider 是模型→Provider 的唯一事实来源
    return providerRegistry.getByModel(resolved);
  }

  listProviders(): string[] {
    return providerRegistry.listIds();
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

export function getThinkingConfig(
  model?: string,
  effort?: ThinkingEffort
): ThinkingConfig {
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
