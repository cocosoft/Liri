// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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

export interface ModelPriceTable {
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

/**
 * 压缩记录端口（core 侧自持）
 *
 * G1 收口（台账 D-59）：`UnifiedTokenTracker` 只需写入压缩记录，原先以 `@modules/query` 的
 * `ContextTracker`（app 层类）作类型 ⇒ core → app 倒挂。改由 core 声明最小端口，
 * `ContextTracker` 结构满足，运行时零依赖。
 */
export interface CompressionRecordPort {
  timestamp: number;
  turnCount: number;
  engineName: string;
  beforeTokens: number;
  afterTokens: number;
  compressionRatio: number;
  messageCountBefore: number;
  messageCountAfter: number;
  hasFocusTopic: boolean;
}

/** 压缩记录写入端口（由上层 ContextTracker 实现） */
export interface CompressionRecorderPort {
  record(record: CompressionRecordPort): void;
}
