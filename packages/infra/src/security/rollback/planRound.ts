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
 * 计划执行轮（`PlanFileRound`）—— 非聊天执行路径的文件回滚录制单元（2026-11-28）
 *
 * 背景（真机取证）：PDCA / 计划步骤写文件时，`RollbackIntegration` 打
 * `onToolBeforeExecute 在 onRoundStart 之前调用，跳过追踪`（路径 `output/image_explanation.md`、
 * `output/pelican_bicycle.svg`）⇒ 这些写入**没有 pre-image、没有轮快照、`/rewind` 不可恢复**。
 * 根因是轮生命周期只挂在**聊天工具轮**（`streamMessageRollbackRound.ts`），
 * 而 PDCA 快路径（`PlanDrivenLoop`）与长程任务（`LongRunningTaskOrchestrator`）各有自己的执行循环。
 *
 * 本模块提供**与聊天轮隔离**的一轮录制：
 * - 聊天轮用会话级集成（`ChatManager.rollbackIntegrations`），本模块每轮**新建**集成
 *   （`RollbackIntegration` 内部只有一个 tracker，复用会互相 `reset`）；
 * - 轮号由调用方从 `toolResultRegistry.nextRound()` 取 ⇒ 与聊天轮共享同一计数器，不撞号；
 * - 同会话同一时刻只登记一轮（步骤批次可并行，但共用一份 tracker 必然串扰 ⇒
 *   调用方以**整个 run 一轮**为粒度，见 `app/src/chat/launchers/PdcaLauncher.ts`）。
 *
 * 写入追踪的接线：`trackFileOpBeforeExecute`（chat 层）与 `stepExecution`（LRO）都先查
 * `getPlanRoundIntegration(sessionId)`，命中则记到计划轮，未命中才回落聊天集成。
 *
 * 失败语义：`begin` / `end` 失败**只 warn 不抛**（CS03-002：录制失败不得阻断任务执行）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { RollbackIntegration } from './RollbackIntegration';
import type { RoundSnapshot } from './types';

const logger = getLogger('security:rollback:plan-round');

/** 会话 ID → 当前活动的计划轮集成（进程级；同会话至多一份） */
const planRounds = new Map<string, RollbackIntegration>();

/**
 * 取该会话当前活动的**计划轮**集成（无 ⇒ `undefined`）。
 *
 * 调用方（工具执行层）据此把文件操作记到计划轮，而不是聊天轮。
 */
export function getPlanRoundIntegration(
  sessionId: string
): RollbackIntegration | undefined {
  return planRounds.get(sessionId);
}

/** 仅供测试：清空进程级登记（避免用例间串状态）。 */
export function clearPlanRounds(): void {
  planRounds.clear();
}

/**
 * 一轮计划执行的文件回滚录制。
 *
 * 用法（调用方保证 begin/end 成对，`finally` 中 end）：
 * ```ts
 * const round = new PlanFileRound(sessionId, roundId);
 * await round.begin([workspace]);
 * try { ...执行步骤（工具写入被记到本轮）... }
 * finally { await round.end(messageSummary); }
 * ```
 */
export class PlanFileRound {
  private readonly integration: RollbackIntegration;

  private started = false;

  constructor(
    private readonly sessionId: string,
    readonly roundId: number
  ) {
    this.integration = new RollbackIntegration(sessionId);
  }

  /**
   * 开始录制：登记为会话的活动计划轮 + 记录基线快照。
   *
   * @param scanPaths 基线扫描根（**收窄到工作区**；整项目根扫描曾致 18s 卡顿）
   * @returns 是否成功开始（失败只 warn，调用方照常执行任务）
   */
  async begin(scanPaths: string[]): Promise<boolean> {
    if (this.started) return true;
    const previous = planRounds.get(this.sessionId);
    if (previous && previous !== this.integration) {
      // 正常不会发生（同一 run 内 build 一次）；发生即说明调用方没 end 上一轮
      logger.warn('上一轮计划录制未结束即开始新轮，后者接管', {
        sessionId: this.sessionId,
        roundId: this.roundId,
      });
    }
    try {
      planRounds.set(this.sessionId, this.integration);
      await this.integration.onRoundStart(
        this.sessionId,
        this.roundId,
        scanPaths
      );
      this.started = true;
      logger.info('计划轮：开始录制', {
        sessionId: this.sessionId,
        roundId: this.roundId,
        scanPaths,
      });
      return true;
    } catch (error) {
      // 录制失败不阻断执行；同时撤销登记，避免后续写入记到半初始化的轮里
      this._release();
      logger.warn('计划轮：开始录制失败（任务继续执行，本轮不录制）', {
        sessionId: this.sessionId,
        roundId: this.roundId,
        error: String(error),
      });
      return false;
    }
  }

  /**
   * 结束录制：检测 Shell 副作用 + 落轮快照 + 撤销登记。
   *
   * 无文件变更 ⇒ `onRoundEnd` 返回 null（不写 manifest，读侧按"本轮无快照"处理）。
   */
  async end(messageSummary: string): Promise<RoundSnapshot | null> {
    if (!this.started) {
      this._release();
      return null;
    }
    try {
      const snapshot = await this.integration.onRoundEnd(messageSummary);
      logger.info('计划轮：录制结束', {
        sessionId: this.sessionId,
        roundId: this.roundId,
        changedFiles: snapshot?.changedFiles.length ?? 0,
      });
      return snapshot;
    } catch (error) {
      logger.warn('计划轮：结束录制失败（快照可能缺失）', {
        sessionId: this.sessionId,
        roundId: this.roundId,
        error: String(error),
      });
      return null;
    } finally {
      this._release();
    }
  }

  private _release(): void {
    this.started = false;
    if (planRounds.get(this.sessionId) === this.integration) {
      planRounds.delete(this.sessionId);
    }
  }
}
