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
 */

type BudgetMode = 'normal' | 'report_only' | 'locked';

interface DailyBudgetConfig {
  /** 日预算上限 */
  dailyLimit: number;
  /** 警告阈值（百分比），默认 0.8 */
  warningThreshold: number;
  /** 锁定阈值（百分比），默认 1.0 */
  lockThreshold: number;
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
  dailyLimit: 1_000_000, // 100万 tokens/天
  warningThreshold: 0.8,
  lockThreshold: 1.0,
};

export class DailyBudgetManager {
  private config: DailyBudgetConfig;
  private todayUsed: number = 0;
  private todayDate: string = '';
  private killSwitch: boolean = false;

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
