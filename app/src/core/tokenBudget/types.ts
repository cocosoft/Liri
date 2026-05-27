/**
 * Token 预算系统类型定义
 * 支持多供应商多模型
 */

export type APIProviderType =
  | 'anthropic'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'openai'
  | 'deepseek';

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheWritePer1M: number;
  cacheReadPer1M: number;
}

export interface ModelCapabilities {
  model: string;
  provider: APIProviderType;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextWindow: number;
  supportsPromptCache: boolean;
  cacheHitRate?: number;
}

export interface TokenUsageDetail {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ContextCategory {
  name: string;
  tokens: number;
  percentage: number;
  color: string;
  isDeferred?: boolean;
}

export interface ContextStats {
  categories: ContextCategory[];
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model: string;
  provider: APIProviderType;
}

export interface TokenBudgetParams {
  maxTokens: number;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  budgetRemaining: number;
  budgetPercentage: number;
}
