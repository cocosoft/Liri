/**
 * 自动Compact系统（基于CC源码 autoCompact.ts 核心模式）
 * 智能阈值 + 连续失败熔断 + 压缩策略
 */
import type { Message } from '@modules/chat/types/message';

export interface CompactConfig {
  model: string;
  contextWindow: number;
  effectiveWindow: number;
  autoCompactThreshold: number;
  warningThreshold: number;
  errorThreshold: number;
  maxConsecutiveFailures: number;
  compactMaxOutputTokens: number;
}

export interface CompactResult {
  compacted: boolean;
  messagesAfterCompact: Message[];
  turnCounter: number;
  consecutiveFailures: number;
  totalCompactCount: number;
}

const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000;
const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000;
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const COMPACT_MAX_OUTPUT_TOKENS = 20_000;
const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000;

export function getCompactConfig(model: string): CompactConfig {
  const contextWindow = model.includes('[1m]')
    ? 1_000_000
    : MODEL_CONTEXT_WINDOW_DEFAULT;
  const effectiveWindow = contextWindow - COMPACT_MAX_OUTPUT_TOKENS;

  return {
    model,
    contextWindow,
    effectiveWindow,
    autoCompactThreshold: effectiveWindow - AUTOCOMPACT_BUFFER_TOKENS,
    warningThreshold: effectiveWindow - WARNING_THRESHOLD_BUFFER_TOKENS,
    errorThreshold: effectiveWindow - ERROR_THRESHOLD_BUFFER_TOKENS,
    maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    compactMaxOutputTokens: COMPACT_MAX_OUTPUT_TOKENS,
  };
}

export function getManualCompactThreshold(model: string): number {
  const config = getCompactConfig(model);
  return config.effectiveWindow - MANUAL_COMPACT_BUFFER_TOKENS;
}

export function shouldAutoCompact(
  estimatedTokens: number,
  model: string
): { shouldCompact: boolean; warning: boolean; error: boolean } {
  const config = getCompactConfig(model);

  return {
    shouldCompact: estimatedTokens > config.autoCompactThreshold,
    warning: estimatedTokens > config.warningThreshold,
    error: estimatedTokens > config.errorThreshold,
  };
}

export class CompactCircuitBreaker {
  private consecutiveFailures: number = 0;
  private maxFailures: number;
  private totalCompactCount: number = 0;

  constructor(maxFailures: number = MAX_CONSECUTIVE_FAILURES) {
    this.maxFailures = maxFailures;
  }

  canCompact(): boolean {
    return this.consecutiveFailures < this.maxFailures;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.totalCompactCount++;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
  }

  reset(): void {
    this.consecutiveFailures = 0;
  }

  getStatus(): {
    consecutiveFailures: number;
    totalCompactCount: number;
    maxFailures: number;
  } {
    return {
      consecutiveFailures: this.consecutiveFailures,
      totalCompactCount: this.totalCompactCount,
      maxFailures: this.maxFailures,
    };
  }
}
