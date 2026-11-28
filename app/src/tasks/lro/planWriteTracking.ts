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
 * 计划执行期间「写类工具**执行前**」的 pre-image 追踪（2026-11-28）
 *
 * 为什么单独做：LRO/PDCA 步骤**直调** `tool.execute`（`stepExecution.runAuthorizedToolCall`），
 * 不经过 chat 的 `ToolExecutionService` —— 而后者是 `onToolBeforeExecute` 的唯一调用点。
 * 于是即便计划轮（`PlanFileRound`）已开，pre-image 备份（`undo` 恢复内容的唯一来源）仍缺失。
 *
 * 只对**已开的活动计划轮**生效：未开轮（普通任务 / 测试替身）⇒ no-op。
 * **不在这里懒启动轮**——基线扫描塞进工具写入热路径会重演 18s 卡顿
 * （见 `app/src/chat/orchestrator/streamMessageRollbackRound.ts` 头注）。
 *
 * 失败语义：只 `warn`，不阻断工具执行（与 chat 链同口径）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { getPlanRoundIntegration } from '@openliri/infra/security';

const logger = getLogger('tasks:planRound');

export interface PlanWriteProbe {
  /** 会话 ID（无 ⇒ 无快照归属，直接跳过） */
  sessionId: string | null;
  /** 写目标**绝对路径**（相对路径已按任务工作区解析） */
  path: string;
  toolName: string;
  /** 本次写入归属的计划（无 ⇒ 不标注） */
  planId: string | null;
  stepId: string;
}

/** 写类工具执行前登记 pre-image（无活动计划轮 ⇒ no-op）。 */
export async function trackPlanWriteBeforeExecute(
  probe: PlanWriteProbe
): Promise<void> {
  if (!probe.sessionId) return;
  const integration = getPlanRoundIntegration(probe.sessionId);
  if (!integration) return;
  try {
    await integration.onToolBeforeExecute({
      path: probe.path,
      type: 'modified',
      toolName: probe.toolName,
      ...(probe.planId ? { planId: probe.planId } : {}),
      stepId: probe.stepId,
    });
  } catch (error) {
    logger.warn('计划轮：写前 pre-image 失败（工具继续执行）', {
      sessionId: probe.sessionId,
      stepId: probe.stepId,
      toolName: probe.toolName,
      path: probe.path,
      error: String(error),
    });
  }
}
