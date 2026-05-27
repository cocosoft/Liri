/**
 * 压缩服务类型定义
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface CompactionResult {
  boundaryMarker: string;
  summaryMessages: string[];
  attachments: string[];
  hookResults: string[];
  messagesToKeep?: string[];
  userDisplayMessage?: string;
  preCompactTokenCount?: number;
  postCompactTokenCount?: number;
  truePostCompactTokenCount?: number;
  compactionUsage?: TokenUsage;
}

export interface CompactThreshold {
  autoCompactThreshold: number;
  warningThreshold: number;
  errorThreshold: number;
  blockingLimit: number;
}

export interface CompactState {
  compacted: boolean;
  turnCounter: number;
  turnId: string;
  consecutiveFailures: number;
}

export interface AutoCompactOptions {
  model: string;
  effectiveContextWindow: number;
  autoCompactThreshold?: number;
  warningThresholdBuffer?: number;
  errorThresholdBuffer?: number;
  manualCompactBuffer?: number;
}

export interface TokenWarningState {
  percentLeft: number;
  isAboveWarningThreshold: boolean;
  isAboveErrorThreshold: boolean;
  isAboveAutoCompactThreshold: boolean;
  isAtBlockingLimit: boolean;
}

export type { CompactConversationOptions } from './CompactService';
