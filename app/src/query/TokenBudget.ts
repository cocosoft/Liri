/**
 * Token预算管理（参考CC源码 cc_code/query/tokenBudget.ts）
 * 管理会话Token使用，实现预算控制和警告机制
 *
 * 使用Rust原生库进行精确的token估算（编译时零依赖C FFI）
 * 当原生库不可用时自动降级为模型特定的启发式估算
 */

import {
  ALL_MODEL_CONFIGS,
  getModelKeyByName,
} from '@modules/ai';
import type { ModelKey } from '@modules/ai';
import { modelContextCache } from '../core/tokenBudget/ModelContextCache';

let nativeEstimateTokens: ((text: string, model?: string) => number) | null =
  null;

function lazyInitNative() {
  if (nativeEstimateTokens === undefined) {
    try {
      const native = require('../../native');
      if (native && typeof native.estimateTokens === 'function') {
        nativeEstimateTokens = (text, model) =>
          native.estimateTokens(text, model);
      } else {
        nativeEstimateTokens = null;
      }
    } catch {
      nativeEstimateTokens = null;
    }
  }
  return nativeEstimateTokens;
}

export enum TokenBudgetStatus {
  NORMAL = 'normal',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EXCEEDED = 'exceeded',
}

export interface TokenBudgetConfig {
  maxTokens: number;
  maxOutputTokens: number;
  warningThreshold: number;
  criticalThreshold: number;
  budgetRefreshIntervalMs: number;
  enableCompression: boolean;
  modelName: string;
}

export interface TokenBudgetState {
  status: TokenBudgetStatus;
  currentTokens: number;
  maxTokens: number;
  maxOutputTokens: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
  remainingTokens: number;
  remainingOutputTokens: number;
  resetAt: number;
  totalTokensUsed: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalOutputTokensUsed: number;
  messagesProcessed: number;
  shouldCompact: boolean;
  modelName: string;
  warningMessage?: string;
}

export interface TokenBudgetManager {
  getCurrentBudgetState(): TokenBudgetState;
  consumeTokens(tokens: number): void;
  consumeOutputTokens(tokens: number): void;
  resetBudget(): void;
  checkBudget(): TokenBudgetStatus;
  estimateMessageTokens(content: string): number;
  canSendMessage(content: string): boolean;
  canSendOutput(tokens: number): boolean;
  getCompressionLevel(): 0 | 1 | 2 | 3;
  setModel(modelName: string): void;
  getModelName(): string;
}

const MODEL_FAMILY_HEURISTICS: Record<string, number> = {
  claude: 4,
  deepseek: 3,
  gpt: 3.5,
};

export class TokenBudgetManagerImpl implements TokenBudgetManager {
  private config: TokenBudgetConfig;
  private currentUsage: number;
  private currentOutputUsage: number;
  private totalTokensUsed: number;
  private totalCacheReadTokens: number;
  private totalCacheCreationTokens: number;
  private totalOutputTokensUsed: number;
  private messagesProcessed: number;
  private resetAt: number;

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens || 200_000,
      maxOutputTokens: config.maxOutputTokens || 16384,
      warningThreshold: config.warningThreshold || 0.7,
      criticalThreshold: config.criticalThreshold || 0.9,
      budgetRefreshIntervalMs: config.budgetRefreshIntervalMs || 3600_000, // 1小时
      enableCompression:
        config.enableCompression !== undefined
          ? config.enableCompression
          : true,
      modelName: config.modelName || '',
    };
    this.currentUsage = 0;
    this.currentOutputUsage = 0;
    this.totalTokensUsed = 0;
    this.totalCacheReadTokens = 0;
    this.totalCacheCreationTokens = 0;
    this.totalOutputTokensUsed = 0;
    this.messagesProcessed = 0;
    this.resetAt = Date.now() + this.config.budgetRefreshIntervalMs;
  }

  getCurrentBudgetState(): TokenBudgetState {
    const now = Date.now();
    if (now >= this.resetAt) {
      this.resetBudget();
    }

    const status = this.checkBudget();
    const percentUsed = this.currentUsage / this.config.maxTokens;

    return {
      status,
      currentTokens: this.currentUsage,
      maxTokens: this.config.maxTokens,
      maxOutputTokens: this.config.maxOutputTokens,
      percentUsed: Math.round(percentUsed * 100),
      isWarning: status === TokenBudgetStatus.WARNING,
      isCritical:
        status === TokenBudgetStatus.CRITICAL ||
        status === TokenBudgetStatus.EXCEEDED,
      remainingTokens: this.config.maxTokens - this.currentUsage,
      remainingOutputTokens:
        this.config.maxOutputTokens - this.currentOutputUsage,
      resetAt: this.resetAt,
      totalTokensUsed: this.totalTokensUsed,
      totalCacheReadTokens: this.totalCacheReadTokens,
      totalCacheCreationTokens: this.totalCacheCreationTokens,
      totalOutputTokensUsed: this.totalOutputTokensUsed,
      messagesProcessed: this.messagesProcessed,
      shouldCompact: percentUsed >= this.config.warningThreshold,
      modelName: this.config.modelName,
      warningMessage: this.getWarningMessage(status),
    };
  }

  private getWarningMessage(status: TokenBudgetStatus): string | undefined {
    switch (status) {
      case TokenBudgetStatus.WARNING:
        return `Token budget warning: ${Math.round((this.currentUsage / this.config.maxTokens) * 100)}% used`;
      case TokenBudgetStatus.CRITICAL:
        return `Token budget critical: ${Math.round((this.currentUsage / this.config.maxTokens) * 100)}% used`;
      case TokenBudgetStatus.EXCEEDED:
        return 'Token budget exceeded';
      default:
        return undefined;
    }
  }

  recordUsage(usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }): void {
    const tokens = usage.totalTokens || usage.inputTokens + usage.outputTokens;
    this.consumeTokens(tokens);
    this.consumeOutputTokens(usage.outputTokens);

    if (usage.cacheReadInputTokens) {
      this.totalCacheReadTokens += usage.cacheReadInputTokens;
    }
    if (usage.cacheCreationInputTokens) {
      this.totalCacheCreationTokens += usage.cacheCreationInputTokens;
    }
  }

  setModel(modelName: string): void {
    this.config.modelName = modelName;

    const modelKey = getModelKeyByName(modelName);
    if (modelKey) {
      const config = ALL_MODEL_CONFIGS[modelKey];
      this.config.maxTokens = config.contextWindow;
      this.config.maxOutputTokens = config.maxOutputTokens;
    } else {
      const cached = modelContextCache.get(modelName);
      if (cached) {
        this.config.maxTokens = cached.contextWindow;
        this.config.maxOutputTokens = cached.maxOutputTokens;
      }
    }
  }

  getModelName(): string {
    return this.config.modelName;
  }

  consumeTokens(tokens: number): void {
    this.currentUsage += tokens;
    this.totalTokensUsed += tokens;
    this.messagesProcessed++;

    if (this.config.enableCompression) {
      this.maybeTriggerCompression();
    }
  }

  consumeOutputTokens(tokens: number): void {
    this.currentOutputUsage += tokens;
    this.totalOutputTokensUsed += tokens;
  }

  resetBudget(): void {
    this.currentUsage = 0;
    this.currentOutputUsage = 0;
    this.resetAt = Date.now() + this.config.budgetRefreshIntervalMs;
  }

  checkBudget(): TokenBudgetStatus {
    const percentUsed = this.currentUsage / this.config.maxTokens;
    const outputPercentUsed =
      this.currentOutputUsage / this.config.maxOutputTokens;
    const maxPercent = Math.max(percentUsed, outputPercentUsed);

    if (maxPercent >= 1.0) {
      return TokenBudgetStatus.EXCEEDED;
    }
    if (maxPercent >= this.config.criticalThreshold) {
      return TokenBudgetStatus.CRITICAL;
    }
    if (maxPercent >= this.config.warningThreshold) {
      return TokenBudgetStatus.WARNING;
    }
    return TokenBudgetStatus.NORMAL;
  }

  estimateMessageTokens(content: string): number {
    const native = lazyInitNative();
    if (native) {
      return native(content, this.config.modelName);
    }
    return this.heuristicEstimate(content);
  }

  private heuristicEstimate(content: string): number {
    const model = this.config.modelName;

    let charsPerToken = 4;

    for (const [prefix, ratio] of Object.entries(MODEL_FAMILY_HEURISTICS)) {
      if (model.includes(prefix)) {
        charsPerToken = ratio;
        break;
      }
    }

    const cjkChars = (
      content.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []
    ).length;
    const otherChars = content.length - cjkChars;

    const cjkTokens = Math.ceil(cjkChars * 1.5);
    const otherTokens = Math.ceil(otherChars / charsPerToken);

    return cjkTokens + otherTokens + 3;
  }

  canSendMessage(content: string): boolean {
    const estimatedTokens = this.estimateMessageTokens(content);
    return this.currentUsage + estimatedTokens <= this.config.maxTokens;
  }

  canSendOutput(tokens: number): boolean {
    return this.currentOutputUsage + tokens <= this.config.maxOutputTokens;
  }

  getCompressionLevel(): 0 | 1 | 2 | 3 {
    const inputPercent = this.currentUsage / this.config.maxTokens;
    const outputPercent = this.currentOutputUsage / this.config.maxOutputTokens;
    const percentUsed = Math.max(inputPercent, outputPercent);

    if (percentUsed < this.config.warningThreshold) {
      return 0;
    }
    if (percentUsed < 0.8) {
      return 1;
    }
    if (percentUsed < this.config.criticalThreshold) {
      return 2;
    }
    return 3;
  }

  private maybeTriggerCompression(): void {
    // 压缩逻辑由QueryEngine调用
  }
}

export function createTokenBudgetManager(
  config?: Partial<TokenBudgetConfig>
): TokenBudgetManager {
  return new TokenBudgetManagerImpl(config);
}
