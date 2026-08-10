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
 * DailyBudgetManager — 日预算上限管理
 *
 * Phase 4 新增。对标 loop-engineering-main 的 loop-budget.md。
 * 三级模式：Normal (<80%) → ReportOnly (≥80%) → Locked (≥100% 或 kill switch)
 * Phase 3 增强：收益递减检测、优雅最后一调、持久化恢复。
 */

import { getLogger } from '@modules/monitoring';
import {
  LOOP_MIN_TOKEN_DELTA,
  LOOP_DIMINISH_TURNS_THRESHOLD,
} from './loop-config.js';

const logger = getLogger('query:dailyBudgetManager');

type BudgetMode = 'normal' | 'report_only' | 'locked';

interface DailyBudgetConfig {
  /** 日预算上限 */
  dailyLimit: number;
  /** 警告阈值（百分比），默认 0.8 */
  warningThreshold: number;
  /** 锁定阈值（百分比），默认 1.0 */
  lockThreshold: number;
  /** 收益递减检测的最小 Token 增量，默认 500 */
  minTokenDelta: number;
  /** 连续低增量次数阈值，默认 2 */
  diminishingTurnsThreshold: number;
}

interface DailyBudgetState {
  mode: BudgetMode;
  todayUsed: number;
  dailyLimit: number;
  percentUsed: number;
  remaining: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: DailyBudgetConfig = {
  dailyLimit: 1_000_000,
  warningThreshold: 0.8,
  lockThreshold: 1.0,
  /** 收益递减 minTokenDelta（可通过 LOOP_MIN_TOKEN_DELTA 环境变量覆盖） */
  minTokenDelta: LOOP_MIN_TOKEN_DELTA,
  /** 收益递减连续轮数阈值（可通过 LOOP_DIMINISH_TURNS_THRESHOLD 环境变量覆盖） */
  diminishingTurnsThreshold: LOOP_DIMINISH_TURNS_THRESHOLD,
};

export class DailyBudgetManager {
  private config: DailyBudgetConfig;
  private todayUsed: number = 0;
  private todayDate: string = '';
  private killSwitch: boolean = false;
  // Phase 3: 收益递减检测
  private lastTotalTokens: number = 0;
  private diminishingTurnsCount: number = 0;
  // Phase 3: 优雅最后一调
  private _graceCallActive: boolean = false;

  constructor(config?: Partial<DailyBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录消耗
   */
  recordUsage(tokens: number): void {
    const today = this._getToday();
    if (this.todayDate !== today) {
      this.todayDate = today;
      this.todayUsed = 0;
    }
    this.todayUsed += tokens;
  }

  /**
   * 获取当前预算模式
   */
  getMode(): DailyBudgetState {
    const percentUsed =
      this.config.dailyLimit > 0 ? this.todayUsed / this.config.dailyLimit : 0;

    let mode: BudgetMode = 'normal';

    if (this.killSwitch || percentUsed >= this.config.lockThreshold) {
      mode = 'locked';
    } else if (percentUsed >= this.config.warningThreshold) {
      mode = 'report_only';
    }

    return {
      mode,
      todayUsed: this.todayUsed,
      dailyLimit: this.config.dailyLimit,
      percentUsed,
      remaining: Math.max(0, this.config.dailyLimit - this.todayUsed),
    };
  }

  /**
   * 检查是否可以执行操作
   */
  canExecute(): boolean {
    return this.getMode().mode !== 'locked';
  }

  /**
   * 检查是否允许子 Agent（仅 normal 模式）
   */
  canSpawnSubAgent(): boolean {
    return this.getMode().mode === 'normal';
  }

  /**
   * 检查收益递减（每轮结束后调用）
   * 连续两轮 Token 增量 < minTokenDelta 时触发递减
   * @param currentTotalTokens 当前累计 Token 消耗
   * @param elapsedMs 本轮耗时（可选，用于补充耗时维度检测）
   */
  checkDiminishingReturns(
    currentTotalTokens: number,
    elapsedMs?: number
  ): { diminishing: boolean; reason?: string } {
    const delta = currentTotalTokens - this.lastTotalTokens;
    this.lastTotalTokens = currentTotalTokens;

    // 耗时维度：连续 2 轮耗时 > 30s 但 token 增量 < 1000，跳级加速触发
    if (elapsedMs !== undefined && elapsedMs > 30_000 && delta < 1000) {
      this.diminishingTurnsCount += 2;
    }

    if (delta < this.config.minTokenDelta) {
      this.diminishingTurnsCount++;

      if (this.diminishingTurnsCount >= this.config.diminishingTurnsThreshold) {
        return {
          diminishing: true,
          reason: `连续 ${this.diminishingTurnsCount} 轮 Token 增量低于阈值 (${this.config.minTokenDelta})，可能已陷入低效循环`,
        };
      }

      return { diminishing: false };
    }

    // Token 有进展 → 重置
    this.diminishingTurnsCount = 0;
    return { diminishing: false };
  }

  /**
   * 重置收益递减计数
   */
  resetDiminishingReturns(): void {
    this.lastTotalTokens = this.todayUsed;
    this.diminishingTurnsCount = 0;
  }

  /**
   * 检查是否需要优雅最后一次调用
   * 当预算耗尽但当前正在执行工具调用时，允许完成当前轮
   */
  needsGraceCall(): boolean {
    if (this._graceCallActive) return false;

    const mode = this.getMode();
    if (mode.mode === 'locked' && !this._graceCallActive) {
      this._graceCallActive = true;
      return true;
    }

    return false;
  }

  /**
   * 确认优雅调用已使用
   */
  consumeGraceCall(): void {
    this._graceCallActive = true;
  }

  /**
   * 是否已完成优雅调用
   */
  graceCallConsumed(): boolean {
    return this._graceCallActive;
  }

  /**
   * 从持久化恢复预算状态
   * 修复重启后 lastTotalTokens=0 导致首轮 delta 被误判为"有进展"
   */
  restore(state: { todayUsed: number }): void {
    this.todayUsed = state.todayUsed;
    this.lastTotalTokens = state.todayUsed;
    this.diminishingTurnsCount = 0;
  }

  /**
   * 设置 kill switch
   */
  enableKillSwitch(): void {
    this.killSwitch = true;
  }

  disableKillSwitch(): void {
    this.killSwitch = false;
  }

  /**
   * 重置当日统计
   */
  reset(): void {
    this.todayUsed = 0;
    this.todayDate = '';
    this.killSwitch = false;
    this.lastTotalTokens = 0;
    this.diminishingTurnsCount = 0;
    this._graceCallActive = false;
  }

  private _getToday(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

export function createDailyBudgetManager(
  config?: Partial<DailyBudgetConfig>
): DailyBudgetManager {
  return new DailyBudgetManager(config);
}
