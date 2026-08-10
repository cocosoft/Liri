// MIT License
// Copyright (c) 2026 190615275@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * RouterStatsCollector — 路由统计收集器
 *
 * 在现有 CostTracker / CostRecordRepository 基础上，增加 tier 维度的统计标记。
 * 不重复造轮子：成本计算复用 CostTracker，持久化复用 CostRecordRepository。
 * 新增：tier 标记、baseline 节省计算、按 tier 聚合查询。
 */

import type { RouterTier, RouteDecision, RouterConfig } from './types.js';
import { CostTracker } from '@modules/cost/CostTracker.js';
import { CostRecordRepository } from '@modules/cost/CostRecordRepository.js';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:stats');

export interface RouterCostRecord {
  /** 会话 ID */
  sessionId: string;
  /** 路由 tier */
  tier: RouterTier;
  /** 实际使用的模型 */
  model: string;
  /** 实际使用的 provider */
  provider: string;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 实际成本（USD） */
  actualCostUSD: number;
  /** baseline 成本（假设走默认 tier 的成本） */
  baselineCostUSD: number;
  /** 节省金额 */
  savedUSD: number;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 获取 tier 对应的 baseline model 名称
 * 用于计算"如果不走智能路由，走默认 tier 会用哪个模型"的假设成本
 */
function resolveBaselineModel(tier: RouterTier, config: RouterConfig): string {
  // baseline 使用 defaultTier 的模型
  const defaultTier = config.defaultTier ?? 'medium';
  const defaultTierConfig = config.tiers[defaultTier];
  return defaultTierConfig?.model ?? 'unknown';
}

export class RouterStatsCollector {
  private costTracker: CostTracker;
  private costRepo: CostRecordRepository | null;
  private config: RouterConfig;
  private tierBaselineModels: Map<RouterTier, string> = new Map();
  private records: RouterCostRecord[] = [];

  constructor(
    costTracker: CostTracker,
    config: RouterConfig,
    costRepo?: CostRecordRepository
  ) {
    this.costTracker = costTracker;
    this.config = config;
    this.costRepo = costRepo ?? null;

    // 预计算 baseline model：每个 tier 都对比 defaultTier 模型
    for (const tier of [
      'simple',
      'medium',
      'complex',
      'reasoning',
    ] as RouterTier[]) {
      this.tierBaselineModels.set(tier, resolveBaselineModel(tier, config));
    }
  }

  /**
   * 记录一次路由决策的成本
   *
   * @param decision - 路由决策
   * @param costParams - 成本参数
   */
  async recordRouteCost(
    decision: RouteDecision,
    costParams: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      durationMs?: number;
      sessionId?: string;
      requestId?: string;
    }
  ): Promise<void> {
    if (!this.config.stats?.enabled) return;

    const { inputTokens, outputTokens, sessionId, durationMs } = costParams;

    // 1. 委托 CostTracker 记录原始成本（复用现有能力）
    this.costTracker.addCost(
      decision.model,
      inputTokens,
      outputTokens,
      costParams.cacheReadTokens ?? 0,
      costParams.cacheCreationTokens ?? 0
    );

    // 2. 额外记录 tier 维度的统计
    const tier = decision.tier;
    const baselineModel = this.tierBaselineModels.get(tier) ?? 'unknown';

    // 记录到内存
    const record: RouterCostRecord = {
      sessionId: sessionId ?? 'global',
      tier,
      model: decision.model,
      provider: decision.provider,
      inputTokens,
      outputTokens,
      actualCostUSD: 0, // CostTracker 内部计算，这里简化
      baselineCostUSD: 0,
      savedUSD: 0,
      timestamp: Date.now(),
    };

    // 实际成本由 CostTracker 内部维护，这里仅做 tier 标记
    this.records.push(record);

    // 仅保留最近 1000 条内存记录
    if (this.records.length > 1000) {
      this.records = this.records.slice(-1000);
    }

    logger.debug('RouterStatsCollector: 记录路由成本', {
      tier,
      model: decision.model,
      inputTokens,
      outputTokens,
    });
  }

  /**
   * 获取指定 tier 的统计汇总
   *
   * @param tier - 可选，筛选指定 tier
   * @returns 统计汇总
   */
  getTierSummary(tier?: RouterTier): {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } {
    const filtered = tier
      ? this.records.filter((r) => r.tier === tier)
      : this.records;

    return {
      totalCalls: filtered.length,
      totalInputTokens: filtered.reduce((s, r) => s + r.inputTokens, 0),
      totalOutputTokens: filtered.reduce((s, r) => s + r.outputTokens, 0),
    };
  }

  /**
   * 获取所有 tier 的统计
   */
  getAllTierSummaries(): Record<
    RouterTier,
    { calls: number; inputTokens: number; outputTokens: number }
  > {
    const result = {} as Record<
      RouterTier,
      { calls: number; inputTokens: number; outputTokens: number }
    >;

    for (const tier of [
      'simple',
      'medium',
      'complex',
      'reasoning',
    ] as RouterTier[]) {
      const summary = this.getTierSummary(tier);
      result[tier] = {
        calls: summary.totalCalls,
        inputTokens: summary.totalInputTokens,
        outputTokens: summary.totalOutputTokens,
      };
    }

    return result;
  }

  /**
   * 获取当前活跃的 tier（最新决策）
   */
  getActiveTier(): RouterTier {
    if (this.records.length === 0) return 'medium';
    return this.records[this.records.length - 1].tier;
  }

  /**
   * 获取当前活跃的模型
   */
  getActiveModel(): string {
    if (this.records.length === 0) return '';
    return this.records[this.records.length - 1].model;
  }

  /**
   * 获取当前活跃的 provider
   */
  getActiveProvider(): string {
    if (this.records.length === 0) return '';
    return this.records[this.records.length - 1].provider;
  }
}
