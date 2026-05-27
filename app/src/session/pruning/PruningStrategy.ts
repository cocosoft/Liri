import type { Session } from '../models/Session';

export interface PruningResult {
  prunedMessageCount: number;
  prunedTokenEstimate: number;
  messagesRemaining: number;
  reason: string;
}

export interface PruningConfig {
  enabled: boolean;
  maxContextTokens: number;
  maxContextMessages: number;
  messageTtlMs: number;
  ttlEnabled: boolean;
  trimThresholdPercent: number;
  preserveFirstMessages: number;
  preserveLastMessages: number;
}

export interface PruningContext {
  session: Session;
  tokenUsage: number;
  modelContextWindow: number;
}

export interface PruningStrategy {
  readonly name: string;
  shouldPrune(context: PruningContext): boolean;
  prune(session: Session, config: PruningConfig): PruningResult;
}

export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  enabled: true,
  maxContextTokens: 100_000,
  maxContextMessages: 200,
  messageTtlMs: 3_600_000,
  ttlEnabled: true,
  trimThresholdPercent: 0.8,
  preserveFirstMessages: 2,
  preserveLastMessages: 5,
};
