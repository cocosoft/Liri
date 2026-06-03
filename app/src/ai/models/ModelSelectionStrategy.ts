/**
 * 模型选择策略
 * 根据提供商类型提供不同的默认模型选择逻辑
 */

import { ModelManagerConfig } from './ModelManager.js';
import { supports1MContext } from './ModelAliases.js';

/**
 * 模型选择策略接口
 */
export interface ModelSelectionStrategy {
  /** 提供商标识 */
  readonly providerId: string;

  /** 获取最佳（旗舰）模型 */
  getBestModel(): string;

  /** 获取小型快速模型 */
  getSmallFastModel(): string;

  /** 获取默认主循环模型（考虑订阅层级） */
  getDefaultMainLoopModel(config: ModelManagerConfig): string;

  /** 获取默认模型 */
  getDefaultModel(): string;
}

/**
 * Anthropic 模型选择策略
 */
export class AnthropicSelectionStrategy implements ModelSelectionStrategy {
  readonly providerId = 'firstParty';

  private opusModel = 'claude-opus-4-6';
  private sonnetModel = 'claude-sonnet-4-6';
  private haikuModel = 'claude-haiku-4-5-20251001';

  constructor() {
    this.opusModel = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || this.opusModel;
    this.sonnetModel =
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || this.sonnetModel;
    this.haikuModel =
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || this.haikuModel;
  }

  getBestModel(): string {
    return this.opusModel;
  }

  getSmallFastModel(): string {
    return process.env.ANTHROPIC_SMALL_FAST_MODEL || this.haikuModel;
  }

  getDefaultModel(): string {
    return this.sonnetModel;
  }

  getDefaultMainLoopModel(config: ModelManagerConfig): string {
    if (config.modelOverride) return config.modelOverride;

    if (
      config.subscriptionType === 'max' ||
      config.subscriptionType === 'team_premium'
    ) {
      return config.enable1MContext && supports1MContext(this.opusModel)
        ? `${this.opusModel}[1m]`
        : this.opusModel;
    }

    return this.sonnetModel;
  }
}

/**
 * OpenAI 模型选择策略
 */
export class OpenAISelectionStrategy implements ModelSelectionStrategy {
  readonly providerId = 'openai';

  private bestModel = 'gpt-4o';
  private fastModel = 'gpt-4o-mini';
  private defaultModel = 'gpt-4o';

  getBestModel(): string {
    return process.env.OPENAI_DEFAULT_BEST_MODEL || this.bestModel;
  }

  getSmallFastModel(): string {
    return process.env.OPENAI_DEFAULT_FAST_MODEL || this.fastModel;
  }

  getDefaultModel(): string {
    return process.env.OPENAI_DEFAULT_MODEL || this.defaultModel;
  }

  getDefaultMainLoopModel(config: ModelManagerConfig): string {
    return config.modelOverride || this.getDefaultModel();
  }
}

/**
 * DeepSeek 模型选择策略
 */
export class DeepSeekSelectionStrategy implements ModelSelectionStrategy {
  readonly providerId = 'deepseek';

  private bestModel = 'deepseek-chat';
  private fastModel = 'deepseek-chat';
  private defaultModel = 'deepseek-chat';

  getBestModel(): string {
    return process.env.DEEPSEEK_DEFAULT_BEST_MODEL || this.bestModel;
  }

  getSmallFastModel(): string {
    return process.env.DEEPSEEK_DEFAULT_FAST_MODEL || this.fastModel;
  }

  getDefaultModel(): string {
    return process.env.DEEPSEEK_DEFAULT_MODEL || this.defaultModel;
  }

  getDefaultMainLoopModel(config: ModelManagerConfig): string {
    return config.modelOverride || this.getDefaultModel();
  }
}

/**
 * Google 模型选择策略
 */
export class GoogleSelectionStrategy implements ModelSelectionStrategy {
  readonly providerId = 'google';

  private bestModel = 'gemini-2.5-pro';
  private fastModel = 'gemini-2.5-flash';
  private defaultModel = 'gemini-2.5-flash';

  getBestModel(): string {
    return process.env.GOOGLE_DEFAULT_BEST_MODEL || this.bestModel;
  }

  getSmallFastModel(): string {
    return process.env.GOOGLE_DEFAULT_FAST_MODEL || this.fastModel;
  }

  getDefaultModel(): string {
    return process.env.GOOGLE_DEFAULT_MODEL || this.defaultModel;
  }

  getDefaultMainLoopModel(config: ModelManagerConfig): string {
    return config.modelOverride || this.getDefaultModel();
  }
}

/**
 * 通用回退策略（当无具体策略匹配时使用）
 */
export class FallbackSelectionStrategy implements ModelSelectionStrategy {
  readonly providerId = 'fallback';
  private defaultModel = 'gpt-4o';

  getBestModel(): string {
    return this.defaultModel;
  }

  getSmallFastModel(): string {
    return 'gpt-4o-mini';
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  getDefaultMainLoopModel(config: ModelManagerConfig): string {
    return config.modelOverride || this.defaultModel;
  }
}

/**
 * 策略注册表
 */
const strategyRegistry = new Map<string, ModelSelectionStrategy>();

export function registerModelSelectionStrategy(
  strategy: ModelSelectionStrategy
): void {
  strategyRegistry.set(strategy.providerId, strategy);
}

export function getModelSelectionStrategy(
  providerId: string
): ModelSelectionStrategy {
  return strategyRegistry.get(providerId) || new FallbackSelectionStrategy();
}

// 注册内置策略
registerModelSelectionStrategy(new AnthropicSelectionStrategy());
registerModelSelectionStrategy(new OpenAISelectionStrategy());
registerModelSelectionStrategy(new DeepSeekSelectionStrategy());
registerModelSelectionStrategy(new GoogleSelectionStrategy());
