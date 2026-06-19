// MIT License
// Copyright (c) 2026 190615273@qq.com
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
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * AdaptiveRouter — 基于历史执行的自适应路由
 *
 * Phase 3 自动编排的优化层。
 * 跟踪每个 (model, tier) 组合的执行成功率、平均延迟，
 * 为 SmartRouter 提供更优的模型选择建议。
 */

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

import type { RouterConfig, RouterTier, RouteDecision } from './types.js';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * (model, tier) 组合的执行统计
 */
export interface ModelTierScore {
  /** 模型 ID */
  model: string;
  /** 路由层级 */
  tier: RouterTier;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 平均延迟（ms） */
  avgLatency: number;
  /** 最后使用时间戳 */
  lastUsed: number;
}

/** 内存统计记录的保留上限 */
const MAX_RECORDS = 500;

/** 连续失败降级阈值 */
const DEGRADE_THRESHOLD = 3;

/**
 * AdaptiveRouter 跟踪模型执行效果，提供自适应路由建议
 */
export class AdaptiveRouter {
  /** (model_tier_key → ModelTierScore) */
  private scores = new Map<string, ModelTierScore>();

  constructor(private config: RouterConfig) {}

  /**
   * 记录一次执行结果
   *
   * @param model - 使用的模型
   * @param tier - 路由层级
   * @param success - 是否成功
   * @param latencyMs - 执行延迟（ms）
   */
  recordExecution(
    model: string,
    tier: RouterTier,
    success: boolean,
    latencyMs: number
  ): void {
    const key = `${model}_${tier}`;
    const existing = this.scores.get(key);

    if (existing) {
      const newSuccessCount = existing.successCount + (success ? 1 : 0);
      const newFailureCount = existing.failureCount + (success ? 0 : 1);
      const totalCount = newSuccessCount + newFailureCount;

      // 滚动平均
      const newAvgLatency =
        totalCount > 1
          ? (existing.avgLatency * (totalCount - 1) + latencyMs) / totalCount
          : latencyMs;

      existing.successCount = newSuccessCount;
      existing.failureCount = newFailureCount;
      existing.avgLatency = newAvgLatency;
      existing.lastUsed = Date.now();
    } else {
      // 控制 map 大小
      if (this.scores.size >= MAX_RECORDS) {
        const oldest = [...this.scores.entries()].sort(
          (a, b) => a[1].lastUsed - b[1].lastUsed
        )[0];
        if (oldest) this.scores.delete(oldest[0]);
      }

      this.scores.set(key, {
        model,
        tier,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        avgLatency: latencyMs,
        lastUsed: Date.now(),
      });
    }

    logger.debug('AdaptiveRouter: 记录执行', {
      model,
      tier,
      success,
      latency: latencyMs,
      successRate: this.getSuccessRate(model, tier),
    });
  }

  /**
   * 获取指定 (model, tier) 的成功率
   */
  getSuccessRate(model: string, tier: RouterTier): number {
    const key = `${model}_${tier}`;
    const score = this.scores.get(key);
    if (!score) return 1; // 无数据默认成功

    const total = score.successCount + score.failureCount;
    if (total === 0) return 1;

    return score.successCount / total;
  }

  /**
   * 获取指定 tier 的推荐模型（成功率最高、延迟最低的模型）
   *
   * @param tier - 路由层级
   * @param candidates - 候选模型 ID 列表
   * @returns 推荐模型 ID，无数据则返回 candidates[0]
   */
  getRecommendedModel(tier: RouterTier, candidates: string[]): string {
    if (candidates.length === 0) return '';
    if (candidates.length === 1) return candidates[0];

    // 筛选该 tier 下有数据的模型
    const scored = candidates
      .map((model) => ({
        model,
        score: this.scores.get(`${model}_${tier}`),
      }))
      .filter((s) => s.score !== undefined);

    if (scored.length === 0) {
      // 无历史数据：返回第一个候选
      return candidates[0];
    }

    // 综合评分：成功率 × 0.7 + 延迟归一化 × 0.3
    const maxLatency = Math.max(...scored.map((s) => s.score!.avgLatency));
    const minLatency = Math.min(...scored.map((s) => s.score!.avgLatency));
    const latencyRange = maxLatency - minLatency || 1;

    scored.sort((a, b) => {
      const aScore =
        (a.score!.successCount /
          (a.score!.successCount + a.score!.failureCount)) *
          0.7 +
        (1 - (a.score!.avgLatency - minLatency) / latencyRange) * 0.3;
      const bScore =
        (b.score!.successCount /
          (b.score!.successCount + b.score!.failureCount)) *
          0.7 +
        (1 - (b.score!.avgLatency - minLatency) / latencyRange) * 0.3;
      return bScore - aScore;
    });

    return scored[0].model;
  }

  /**
   * 检查模型是否需要降级（连续失败超过阈值）
   *
   * @param model - 模型 ID
   * @param tier - 当前层级
   * @returns 是否需要降级到更低 tier
   */
  shouldDegrade(model: string, tier: RouterTier): boolean {
    const key = `${model}_${tier}`;
    const score = this.scores.get(key);
    if (!score) return false;

    // 检查最近连续失败（最后 N 次都是失败）
    return score.failureCount >= DEGRADE_THRESHOLD;
  }

  /**
   * 检查模型是否需要升级（持续高成功率，可尝试更高 tier）
   *
   * @param model - 模型 ID
   * @param tier - 当前层级
   * @returns 是否可升级到更高 tier
   */
  shouldUpgrade(model: string, tier: RouterTier): boolean {
    const key = `${model}_${tier}`;
    const score = this.scores.get(key);
    if (!score) return false;

    const total = score.successCount + score.failureCount;
    if (total < 5) return false; // 样本不足

    const rate = score.successCount / total;
    return rate >= 0.95; // 95% 以上成功率考虑升级
  }

  /**
   * 获取所有统计数据的快照
   */
  getAllScores(): ModelTierScore[] {
    return [...this.scores.values()];
  }

  /**
   * 更新配置
   */
  updateConfig(config: RouterConfig): void {
    this.config = config;
  }

  /**
   * 清空统计数据
   */
  clear(): void {
    this.scores.clear();
  }
}
