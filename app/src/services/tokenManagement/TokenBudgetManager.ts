import type { TokenUsage } from './TokenCounter';
import { getTokenCountFromUsage, TOKEN_THRESHOLD_200K } from './TokenCounter';

export interface TokenBudgetConfig {
  maxContextTokens: number;
  warningThresholdPercent: number;
  criticalThresholdPercent: number;
  enable200kWarning: boolean;
}

export const DEFAULT_TOKEN_BUDGET_CONFIG: TokenBudgetConfig = {
  maxContextTokens: 200_000,
  warningThresholdPercent: 0.7,
  criticalThresholdPercent: 0.85,
  enable200kWarning: true,
};

export enum TokenBudgetStatus {
  NORMAL = 'normal',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EXCEEDED = 'exceeded',
}

export interface TokenBudgetState {
  currentTokens: number;
  maxTokens: number;
  status: TokenBudgetStatus;
  percentUsed: number;
  shouldCompact: boolean;
  warningMessage: string | null;
}

export class TokenBudgetManager {
  private config: TokenBudgetConfig;
  private accumulatedInputTokens: number = 0;
  private accumulatedOutputTokens: number = 0;
  private turnCount: number = 0;
  private tokenHistory: Array<{
    turn: number;
    tokens: number;
    timestamp: number;
  }> = [];

  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = { ...DEFAULT_TOKEN_BUDGET_CONFIG, ...config };
  }

  reset(): void {
    this.accumulatedInputTokens = 0;
    this.accumulatedOutputTokens = 0;
    this.turnCount = 0;
    this.tokenHistory = [];
  }

  recordUsage(usage: TokenUsage): void {
    this.accumulatedInputTokens += usage.inputTokens;
    this.accumulatedOutputTokens += usage.outputTokens;
    this.turnCount++;

    this.tokenHistory.push({
      turn: this.turnCount,
      tokens: getTokenCountFromUsage(usage),
      timestamp: Date.now(),
    });
  }

  getAccumulatedTokens(): number {
    return this.accumulatedInputTokens + this.accumulatedOutputTokens;
  }

  getCurrentBudgetState(additionalTokens: number = 0): TokenBudgetState {
    const currentTokens = this.getAccumulatedTokens() + additionalTokens;
    const maxTokens = this.config.maxContextTokens;
    const percentUsed = maxTokens > 0 ? currentTokens / maxTokens : 0;

    let status: TokenBudgetStatus;
    let shouldCompact = false;
    let warningMessage: string | null = null;

    if (percentUsed >= 1) {
      status = TokenBudgetStatus.EXCEEDED;
      shouldCompact = true;
      warningMessage = `Token budget exceeded: ${currentTokens}/${maxTokens} tokens (${Math.round(percentUsed * 100)}%)`;
    } else if (percentUsed >= this.config.criticalThresholdPercent) {
      status = TokenBudgetStatus.CRITICAL;
      shouldCompact = true;
      warningMessage = `Token budget critical: ${currentTokens}/${maxTokens} tokens (${Math.round(percentUsed * 100)}%)`;
    } else if (percentUsed >= this.config.warningThresholdPercent) {
      status = TokenBudgetStatus.WARNING;
      shouldCompact = true;
      warningMessage = `Token budget warning: ${currentTokens}/${maxTokens} tokens (${Math.round(percentUsed * 100)}%)`;
    } else {
      status = TokenBudgetStatus.NORMAL;
    }

    if (
      this.config.enable200kWarning &&
      currentTokens > TOKEN_THRESHOLD_200K &&
      status === TokenBudgetStatus.NORMAL
    ) {
      status = TokenBudgetStatus.WARNING;
      warningMessage = `Context exceeds 200k tokens (${currentTokens}). Performance may degrade.`;
    }

    return {
      currentTokens,
      maxTokens,
      status,
      percentUsed,
      shouldCompact,
      warningMessage,
    };
  }

  estimateTokensForNextTurn(turnData: string): number {
    return Math.ceil(turnData.length / 4) + 50;
  }

  shouldTriggerCompact(): boolean {
    const state = this.getCurrentBudgetState();
    return state.shouldCompact;
  }

  getTokenHistory(): ReadonlyArray<{
    turn: number;
    tokens: number;
    timestamp: number;
  }> {
    return this.tokenHistory;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  setMaxContextTokens(maxTokens: number): void {
    this.config.maxContextTokens = maxTokens;
  }

  getMaxContextTokens(): number {
    return this.config.maxContextTokens;
  }

  updateConfig(partial: Partial<TokenBudgetConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}
