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
 * 成员级步骤观察账本（P1-3 待续）
 *
 * 在 seam 层强制配对不变式：**每个 `onStepStart` 在一次 run 内恰好对应一次 `onStepEnd`**。
 *
 * 为什么由宿主（本账本）而不是各 Provider 保证：
 * - Provider 存在不经过步骤循环的提前返回（未知工作流 / 未注入执行器 / 取消前）
 * - 取消宽限期到期会**放弃**仍在执行的 Provider（其回调随后仍可能到达）
 *   若此时已通知 run_end，晚到的回调会产生"run_end 之后的 step_end"，破坏 run 自包含
 * 故宿主必须能"兜底结算 + 结算后封闭"。
 *
 * 丢弃规则（只丢弃并告警，**不编造**数据）：不在计划内的 stepId / 重复 start /
 * 重复 end / 无配对 start 的 end / 封闭后到达的任何上报。
 */

import { getLogger } from '@modules/monitoring';

import type {
  WorkflowStepEndInfo,
  WorkflowStepEndReport,
  WorkflowStepObserver,
  WorkflowStepOutcome,
  WorkflowStepReporter,
  WorkflowStepStartInfo,
  WorkflowStepStartReport,
  WorkflowStopReason,
} from './types';

const logger = getLogger('workflow:step-ledger');

/** 强制结算步骤时的原因文案（Provider 未上报结束） */
const SYNTHESIZED_ERROR = '步骤未上报结束，由 seam 按运行结果强制结算';

export class WorkflowStepLedger implements WorkflowStepReporter {
  /** 本次 run 计划执行的步骤 id（拓扑序，来源于 run_start） */
  private readonly planned: Set<string>;
  /** 已开始但未结束的步骤（配对账本） */
  private readonly live = new Map<string, WorkflowStepStartInfo>();
  /** 结算标记：置位后不再接受任何上报 */
  private closed = false;

  constructor(
    private readonly runId: string,
    private readonly observer: WorkflowStepObserver | undefined,
    plannedStepIds: readonly string[]
  ) {
    this.planned = new Set(plannedStepIds);
  }

  onStepStart(report: WorkflowStepStartReport): void {
    if (this.closed) {
      logger.warn('账本已结算，丢弃步骤开始上报', {
        runId: this.runId,
        stepId: report.stepId,
      });
      return;
    }
    if (!this.planned.has(report.stepId)) {
      logger.warn('步骤不在本次 run 的计划内，丢弃其开始上报', {
        runId: this.runId,
        stepId: report.stepId,
        planned: [...this.planned],
      });
      return;
    }
    if (this.live.has(report.stepId)) {
      logger.warn('步骤重复开始，丢弃后一次上报', {
        runId: this.runId,
        stepId: report.stepId,
      });
      return;
    }

    const info: WorkflowStepStartInfo = {
      runId: this.runId,
      stepId: report.stepId,
      tool: report.tool,
      description: report.description,
      startedAt: report.startedAt,
    };
    this.live.set(report.stepId, info);
    this.emitStart(info);
  }

  onStepEnd(report: WorkflowStepEndReport): void {
    if (this.closed) {
      logger.warn('账本已结算，丢弃步骤结束上报', {
        runId: this.runId,
        stepId: report.stepId,
      });
      return;
    }
    const start = this.live.get(report.stepId);
    if (!start) {
      logger.warn(
        '步骤结束上报无配对的开始上报，丢弃（避免产生孤儿 step_end）',
        {
          runId: this.runId,
          stepId: report.stepId,
        }
      );
      return;
    }

    this.live.delete(report.stepId);
    this.emitEnd({
      runId: this.runId,
      stepId: report.stepId,
      outcome: report.outcome,
      tool: start.tool,
      description: start.description,
      durationMs: Date.now() - start.startedAt,
      ...(report.error ? { error: report.error } : {}),
    });
  }

  /**
   * 结算并封闭账本：为仍处于"已开始未结束"的步骤合成结束事件（`synthesized: true`），
   * 此后丢弃一切上报。
   *
   * 必须在 run 的**每条出口**调用，且早于 `onRunEnd` 通知——否则事件流中
   * 会出现孤儿 start 或 run_end 之后的 step_end。重复调用无副作用。
   */
  close(stopReason: WorkflowStopReason): void {
    if (this.closed) return;
    this.closed = true;
    if (this.live.size === 0) return;

    const outcome: WorkflowStepOutcome =
      stopReason === 'cancelled'
        ? 'cancelled'
        : stopReason === 'completed'
          ? 'completed'
          : 'failed';
    const now = Date.now();

    for (const start of this.live.values()) {
      logger.warn('步骤未上报结束，由 seam 强制结算', {
        runId: this.runId,
        stepId: start.stepId,
        outcome,
        stopReason,
      });
      this.emitEnd({
        runId: this.runId,
        stepId: start.stepId,
        outcome,
        tool: start.tool,
        description: start.description,
        durationMs: now - start.startedAt,
        synthesized: true,
        error: SYNTHESIZED_ERROR,
      });
    }
    this.live.clear();
  }

  /** 通知观察者步骤开始：观察者异常只记日志（监听器包含语义，与 run 级通知一致） */
  private emitStart(info: WorkflowStepStartInfo): void {
    if (!this.observer?.onStepStart) return;
    try {
      this.observer.onStepStart(info);
    } catch (error) {
      logger.warn('工作流观察者 onStepStart 失败（已忽略）', {
        runId: this.runId,
        stepId: info.stepId,
        error: String(error),
      });
    }
  }

  /** 通知观察者步骤结束：同上，观察者异常不得污染执行结果 */
  private emitEnd(info: WorkflowStepEndInfo): void {
    if (!this.observer?.onStepEnd) return;
    try {
      this.observer.onStepEnd(info);
    } catch (error) {
      logger.warn('工作流观察者 onStepEnd 失败（已忽略）', {
        runId: this.runId,
        stepId: info.stepId,
        error: String(error),
      });
    }
  }
}
