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
import { configManager } from '@modules/config';
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
  /** **实际**已用（不含在途预留） */
  todayUsed: number;
  /** **含在途预留**的预计用量（R16 原子预留；无预留时 === `todayUsed`） */
  projectedUsed: number;
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
  /** R16 原子预留：会话级**在途预留**（发送前预扣估算，响应后结算为真实用量） */
  private outstandingBySession = new Map<string, number>();

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

  /** 在途预留合计（R16） */
  private outstandingTotal(): number {
    let sum = 0;
    for (const v of this.outstandingBySession.values()) sum += v;
    return sum;
  }

  /** 预计用量 = **实际** + **在途预留**（R16；在途为 0 时 === `todayUsed`） */
  private effectiveUsed(): number {
    return this.todayUsed + this.outstandingTotal();
  }

  /**
   * **预留（预扣）**（R16 原子预留）：把本会话本轮**估算**计入"在途"，使**并发**的
   * `getMode()` 立刻看到该预留（闭合 check→record 之间的 TOCTOU 窗口）。
   *
   * `ok` 仅表示"含在途仍在限额内"；本层预算当前仍为**建议式**（非硬阻断）⇒ 调用方按需使用。
   */
  reserveFor(
    sessionId: string,
    tokens: number
  ): { ok: boolean; projected: number } {
    if (tokens > 0) {
      this.outstandingBySession.set(
        sessionId,
        (this.outstandingBySession.get(sessionId) ?? 0) + tokens
      );
    }
    const projected = this.effectiveUsed();
    return {
      ok: this.config.dailyLimit <= 0 || projected <= this.config.dailyLimit,
      projected,
    };
  }

  /**
   * **结算（多退少补）**（R16）：清本会话在途预留，并把**真实用量**入账。
   * 无预留时等同 `recordUsage`（例如未经预检的路径）。
   */
  settleFor(sessionId: string, actualTokens: number): void {
    this.outstandingBySession.delete(sessionId);
    if (actualTokens > 0) this.recordUsage(actualTokens);
  }

  /**
   * 获取当前预算模式。
   *
   * R16：`percentUsed` / `mode` / `remaining` 基于**含在途预留**的 `projectedUsed`（在途为 0 时
   * 与 `todayUsed` 相同 ⇒ **无预留则行为逐一不变**）；`todayUsed` 仍为**实际**用量。
   */
  getMode(): DailyBudgetState {
    const projectedUsed = this.effectiveUsed();
    const percentUsed =
      this.config.dailyLimit > 0 ? projectedUsed / this.config.dailyLimit : 0;

    let mode: BudgetMode = 'normal';

    if (this.killSwitch || percentUsed >= this.config.lockThreshold) {
      mode = 'locked';
    } else if (percentUsed >= this.config.warningThreshold) {
      mode = 'report_only';
    }

    return {
      mode,
      todayUsed: this.todayUsed,
      projectedUsed,
      dailyLimit: this.config.dailyLimit,
      percentUsed,
      remaining: Math.max(0, this.config.dailyLimit - projectedUsed),
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
    this.outstandingBySession.clear();
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
    this.outstandingBySession.clear();
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

/** 进程级每日 Token 预算默认上限（对齐历史 `preSendContextProtection` 常量）。 */
export const DEFAULT_DAILY_BUDGET_TOKENS = 500_000;

/**
 * 进程级**共享**每日 Token 预算单例（R16 / 台账 L-14）。
 *
 * - **(a) 单一闸门实例**：主对话预检（`preSendContextProtection`）与 `TAORLoop` 的**日预算闸门**
 *   共用本实例（原 TAORLoop 自建、从不记账 ⇒ 闸门恒真/惰性）。
 * - **(b) 单一记账点**：由 `ChatManager.recordChatResponseUsage`（每次模型响应）记入 ——
 *   覆盖主路径/快速路径/流式，替代原"仅记**最后一次**调用"的 `recordDailyUsage`。
 * - **(c) 上限来源**：env `LIRI_DAILY_BUDGET_TOKENS` ＞ 常量 `DEFAULT_DAILY_BUDGET_TOKENS`。
 *   （`workspace.costControl.dailyBudgetTokens` 为**按工作空间**配置，与"进程全局单例"语义冲突 ⇒
 *   未接线，见 Spec `daily-budget-unification.md`。）
 *
 * 注：`TAORLoop` 仍保留**自己的**实例用于 **loop-local** 的 `checkDiminishingReturns`/`needsGraceCall`
 * （其状态按循环/轮次计，**不能**跨会话共享）——故"去双实例"仅指**闸门**收敛到本单例。
 */
let dailyBudgetSingleton: DailyBudgetManager | null = null;

export function getDailyBudget(): DailyBudgetManager {
  if (!dailyBudgetSingleton) {
    const raw = configManager.env('LIRI_DAILY_BUDGET_TOKENS');
    const parsed = Number.parseInt(raw ?? '', 10);
    const dailyLimit =
      raw && Number.isInteger(parsed) && parsed > 0
        ? parsed
        : DEFAULT_DAILY_BUDGET_TOKENS;
    dailyBudgetSingleton = createDailyBudgetManager({ dailyLimit });
  }
  return dailyBudgetSingleton;
}

/** 仅供测试：重置单例（生产不使用）。 */
export function resetDailyBudgetForTest(): void {
  dailyBudgetSingleton = null;
}

/**
 * 从 LLM `usage` 记录**统一提取** `input+output` 并计入每日预算（R16 统一口径）。
 *
 * 兼容 `inputTokens/outputTokens`（内部归一化）与 `prompt_tokens/completion_tokens`（OpenAI 形）。
 * 返回实际计入的 tokens（0 表示无有效 usage，未计入）。
 *
 * 用途：**非 chat 管线**的模型调用（如长程任务默认执行器 `LongRunningTaskOrchestrator`
 * 的 `service.generate`）——该路径不经 `ChatManager.recordChatResponseUsage`，故在此单点记账。
 */
export function recordDailyBudgetFromUsage(usage: unknown): number {
  const u = (usage ?? {}) as Record<string, number>;
  const input = u.inputTokens ?? u.prompt_tokens ?? 0;
  const output = u.outputTokens ?? u.completion_tokens ?? 0;
  const total = input + output;
  if (total > 0) getDailyBudget().recordUsage(total);
  return total;
}
