//
/**
 * Token预算管理（参考CC源码 cc_code/query/tokenBudget.ts）
 * 管理会话Token使用，实现预算控制和警告机制
 *
 * 使用Rust原生库进行精确的token估算（编译时零依赖C FFI）
 * 当原生库不可用时自动降级为启发式估算
 */

let nativeEstimateTokens: ((text: string, model?: string) => number) | null = null;

function lazyInitNative() {
  if (nativeEstimateTokens === undefined) {
    try {
      const native = require('../../native');
      if (native && typeof native.estimateTokens === 'function') {
        nativeEstimateTokens = (text, model) => native.estimateTokens(text, model);
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
  warningThreshold: number;
  criticalThreshold: number;
  budgetRefreshIntervalMs: number;
  enableCompression: boolean;
}

export interface TokenBudgetState {
  status: TokenBudgetStatus;
  currentTokens: number;
  maxTokens: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
  remainingTokens: number;
  resetAt: number;
  totalTokensUsed: number;
  messagesProcessed: number;
  shouldCompact: boolean;
  warningMessage?: string;
}

export interface TokenBudgetManager {
  getCurrentBudgetState(): TokenBudgetState;
  consumeTokens(tokens: number): void;
  resetBudget(): void;
  checkBudget(): 'normal' | 'warning' | 'critical';
  estimateMessageTokens(content: string): number;
  canSendMessage(content: string): boolean;
  getCompressionLevel(): 0 | 1 | 2 | 3;
}

export class TokenBudgetManagerImpl implements TokenBudgetManager {
  private config: TokenBudgetConfig;
  private currentUsage: number;
  private totalTokensUsed: number;
  private messagesProcessed: number;
  private resetAt: number;

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens || 200_000,
      warningThreshold: config.warningThreshold || 0.7,
      criticalThreshold: config.criticalThreshold || 0.9,
      budgetRefreshIntervalMs: config.budgetRefreshIntervalMs || 3600_000, // 1小时
      enableCompression: config.enableCompression !== undefined ? config.enableCompression : true,
    };
    this.currentUsage = 0;
    this.totalTokensUsed = 0;
    this.messagesProcessed = 0;
    this.resetAt = Date.now() + this.config.budgetRefreshIntervalMs;
  }

  getCurrentBudgetState(): TokenBudgetState {
    const percentUsed = this.currentUsage / this.config.maxTokens;
    const now = Date.now();
    
    if (now >= this.resetAt) {
      this.resetBudget();
    }

    const status = this.checkBudget();

    return {
      status,
      currentTokens: this.currentUsage,
      maxTokens: this.config.maxTokens,
      percentUsed: Math.round(percentUsed * 100),
      isWarning: status === TokenBudgetStatus.WARNING,
      isCritical: status === TokenBudgetStatus.CRITICAL || status === TokenBudgetStatus.EXCEEDED,
      remainingTokens: this.config.maxTokens - this.currentUsage,
      resetAt: this.resetAt,
      totalTokensUsed: this.totalTokensUsed,
      messagesProcessed: this.messagesProcessed,
      shouldCompact: percentUsed >= this.config.warningThreshold,
      warningMessage: this.getWarningMessage(status),
    };
  }

  private getWarningMessage(status: TokenBudgetStatus): string | undefined {
    switch (status) {
      case TokenBudgetStatus.WARNING:
        return `Token budget warning: ${Math.round(this.currentUsage / this.config.maxTokens * 100)}% used`;
      case TokenBudgetStatus.CRITICAL:
        return `Token budget critical: ${Math.round(this.currentUsage / this.config.maxTokens * 100)}% used`;
      case TokenBudgetStatus.EXCEEDED:
        return 'Token budget exceeded';
      default:
        return undefined;
    }
  }

  recordUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }): void {
    const tokens = usage.totalTokens || (usage.inputTokens + usage.outputTokens);
    this.consumeTokens(tokens);
  }

  consumeTokens(tokens: number): void {
    this.currentUsage += tokens;
    this.totalTokensUsed += tokens;
    this.messagesProcessed++;

    // 检查是否需要压缩
    if (this.config.enableCompression) {
      this.maybeTriggerCompression();
    }
  }

  resetBudget(): void {
    this.currentUsage = 0;
    this.resetAt = Date.now() + this.config.budgetRefreshIntervalMs;
  }

  checkBudget(): 'normal' | 'warning' | 'critical' {
    const percentUsed = this.currentUsage / this.config.maxTokens;
    
    if (percentUsed >= this.config.criticalThreshold) {
      return 'critical';
    }
    if (percentUsed >= this.config.warningThreshold) {
      return 'warning';
    }
    return 'normal';
  }

  estimateMessageTokens(content: string): number {
    const native = lazyInitNative();
    if (native) {
      return native(content);
    }
    return Math.ceil(content.length / 4);
  }

  canSendMessage(content: string): boolean {
    const estimatedTokens = this.estimateMessageTokens(content);
    return this.currentUsage + estimatedTokens <= this.config.maxTokens;
  }

  getCompressionLevel(): 0 | 1 | 2 | 3 {
    const percentUsed = this.currentUsage / this.config.maxTokens;
    
    if (percentUsed < this.config.warningThreshold) {
      return 0; // 无需压缩
    }
    if (percentUsed < 0.8) {
      return 1; // 轻度压缩
    }
    if (percentUsed < this.config.criticalThreshold) {
      return 2; // 中度压缩
    }
    return 3; // 重度压缩
  }

  private maybeTriggerCompression(): void {
    // 压缩逻辑由QueryEngine调用
  }
}

export function createTokenBudgetManager(config?: Partial<TokenBudgetConfig>): TokenBudgetManager {
  return new TokenBudgetManagerImpl(config);
}