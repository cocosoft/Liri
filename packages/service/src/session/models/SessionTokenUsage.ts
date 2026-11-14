/**
 * 会话令牌使用量模型
 * 与 services/tokenManagement/TokenCounter 和 cost/types 的 TokenUsage 对齐
 */
export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  costStatus: 'unknown' | 'estimated' | 'actual';
  lastPromptTokens: number;
}

export type TokenCostStatus = SessionTokenUsage['costStatus'];

export interface SessionTokenSnapshot {
  sessionId: string;
  usage: SessionTokenUsage;
  model: string;
  turnNumber: number;
  timestamp: number;
}

export function createEmptyTokenUsage(): SessionTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    costStatus: 'unknown',
    lastPromptTokens: 0,
  };
}

export function accumulateTokenUsage(
  base: SessionTokenUsage,
  delta: Partial<SessionTokenUsage>
): SessionTokenUsage {
  return {
    inputTokens: base.inputTokens + (delta.inputTokens ?? 0),
    outputTokens: base.outputTokens + (delta.outputTokens ?? 0),
    cacheReadTokens: base.cacheReadTokens + (delta.cacheReadTokens ?? 0),
    cacheCreationTokens:
      base.cacheCreationTokens + (delta.cacheCreationTokens ?? 0),
    reasoningTokens: base.reasoningTokens + (delta.reasoningTokens ?? 0),
    totalTokens: base.totalTokens + (delta.totalTokens ?? 0),
    estimatedCostUsd: base.estimatedCostUsd + (delta.estimatedCostUsd ?? 0),
    costStatus: delta.costStatus ?? base.costStatus,
    lastPromptTokens: delta.lastPromptTokens ?? base.lastPromptTokens,
  };
}
