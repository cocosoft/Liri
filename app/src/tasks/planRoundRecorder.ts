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
 * 计划执行轮的**会话级录制入口**（2026-11-28）
 *
 * 真机取证：PDCA / 计划步骤写文件时整轮**没有** `onRoundStart` ⇒
 * `RollbackIntegration` 打「onToolBeforeExecute 在 onRoundStart 之前调用，跳过追踪」，
 * 写下的文件没有 pre-image、没有快照，`/rewind` 不可恢复
 * （`output/image_explanation.md`、`output/pelican_bicycle.svg`）。
 *
 * 本模块把「分配轮号 + 建独立集成 + 开始/结束录制」收成一处，供两条非聊天执行路径共用：
 * - `PdcaLauncher`（PDL 快速路径，`PlanDrivenLoop` 的整 run）；
 * - `LongRunningTaskOrchestrator.executeAllSteps`（经典阶段链 / `/goal start` / `POST /v1/pdca/start`）。
 *
 * 为什么**整 run 一轮**而不是每步一轮：`RollbackIntegration` 内部只有一个
 * `FileOperationTracker`，而独立步骤批次是**并行**执行的（`Promise.allSettled`）⇒
 * 共用一份 tracker 会互相 `reset`；每步各建一轮则轮归属/快照粒度都需另行设计。
 *
 * 失败语义：一律 `warn` 返回，**不抛**（CS03-002：录制失败不得改变任务结论）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { resolveProjectRoot } from '@openliri/infra/environment';
import { PlanFileRound } from '@openliri/infra/security';
import { toolResultRegistry } from '@modules/tool/ToolResultRegistry';

const logger = getLogger('tasks:planRound');

/** 会话 ID → 进行中的计划轮（进程级；同会话同一时刻至多一轮） */
const rounds = new Map<string, PlanFileRound>();

/**
 * 开始计划执行轮的文件录制。
 *
 * @param sessionId 会话 ID（空 ⇒ 不录制：快照按会话目录存放，无会话无法归属）
 * @param scanPaths 基线扫描根；缺省 `[项目根]`（与聊天轮同口径）。长程任务传 `[isolation.workspace]`
 * @returns 轮号；未开始录制时 `null`
 */
export async function beginPlanFileRound(
  sessionId: string | null | undefined,
  scanPaths?: string[]
): Promise<number | null> {
  if (!sessionId) {
    logger.debug('计划轮：无会话 ID，跳过文件录制');
    return null;
  }
  const running = rounds.get(sessionId);
  if (running) {
    // 幂等：同一 run 内重复调用不重开（重开会清空已录制变更）
    return running.roundId;
  }
  let round: PlanFileRound | null = null;
  try {
    round = new PlanFileRound(
      sessionId,
      toolResultRegistry.nextRound(sessionId)
    );
    rounds.set(sessionId, round);
    const started = await round.begin(scanPaths ?? [resolveProjectRoot()]);
    if (!started) {
      rounds.delete(sessionId);
      return null;
    }
    return round.roundId;
  } catch (error) {
    if (round) rounds.delete(sessionId);
    logger.warn('计划轮：启动失败（任务继续执行，本轮不录制）', {
      sessionId,
      error: String(error),
    });
    return null;
  }
}

/**
 * 结束计划执行轮并落轮快照。
 *
 * 无文件变更 ⇒ 不写 manifest（读侧按"本轮无快照"处理，不再刷 `加载快照失败`）。
 *
 * @param summary 写入快照 manifest 的摘要（≤100 字截断由存储侧负责）
 */
export async function endPlanFileRound(
  sessionId: string | null | undefined,
  summary: string
): Promise<void> {
  if (!sessionId) return;
  const round = rounds.get(sessionId);
  if (!round) return;
  try {
    await round.end(summary);
  } finally {
    rounds.delete(sessionId);
  }
}

/**
 * 用计划轮包住一段执行（begin → fn → end，`finally` 保证收尾）。
 *
 * 供无法就地 `try/finally` 的调用点使用（如 `executeAllSteps` 主体在文件规模门禁边界上，
 * 不能整体增加缩进层）。
 */
export async function runWithPlanFileRound<T>(
  sessionId: string | null | undefined,
  scanPaths: string[],
  summary: string,
  fn: () => Promise<T>
): Promise<T> {
  await beginPlanFileRound(sessionId, scanPaths);
  try {
    return await fn();
  } finally {
    await endPlanFileRound(sessionId, summary);
  }
}
