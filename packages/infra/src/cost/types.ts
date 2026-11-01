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
 * 成本追踪模块类型定义
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

export interface ModelTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CostRecord {
  timestamp: Date;
  model: string;
  usage: TokenUsage;
  costUSD: number;
  durationMs: number;
  requestId?: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  requestCount: number;
}

export interface CostSummary {
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalDurationMs: number;
  requestCount: number;
  usageByModel: Map<string, ModelUsage>;
}

export interface CostData {
  totalCost: number;
  totalTokens: number;
  costByModel: Record<string, number>;
  tokenByModel: Record<string, { input: number; output: number }>;
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  category: string;
  timestamp: number;
}

export enum CostCategory {
  API_CALL = 'api_call',
  EMBEDDING = 'embedding',
  CACHE = 'cache',
  STORAGE = 'storage',
  COMPUTE = 'compute',
  NETWORK = 'network',
  AI = 'ai',
  OTHER = 'other',
}

export enum CostPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  CUSTOM = 'custom',
}

export interface CostAnalysis {
  totalCost: number;
  averageCost: number;
  minCost: number;
  maxCost: number;
  modelCosts: Record<string, number>;
  dailyCosts: Record<string, number>;
  startDate: string;
  endDate: string;
  projectedCost?: number;
  topModels: Array<{ model: string; cost: number }>;

  /** 按类别成本（EnhancedCostManager使用） */
  costByCategory?: Record<string, number>;
}
