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
 * 失败归因（P0-2 接线期②）：把 run 事实投影为**任务子图**，沿反向依赖回溯出根因候选集。
 *
 * 范围（故意收窄，避免造"没有消费方也不可回溯"的装饰性结构）：
 * - **只投影 `dependsOn` 上游边** —— 根因检索的方向恰是"谁在因果上先于失败点"；
 * - `state` 节点、`producedBy`、`blockedBy` 需要**运行期事实**（步骤产出物 id、被阻塞下游）
 *   与**持久化投影**一并落地，属接线期②b（见 `.trae/specs/graph-engineering-p0.md`）。
 *
 * `evidenceRef` 形态：`run:<runId>#step:<stepId>` —— 指向该 run 内该步骤的记录（tool 名、耗时
 * 由 `step_end` 事件携带），是当前层能给出的**可定位**引用。跨 agent 的 tool-call id 贯通
 * 属 RunLogger 接线范围（spec §一 E5）。
 */

import { projectTaskGraph } from '@modules/core/systemgraph';
import type {
  RootCauseCandidate,
  TaskStepLike,
} from '@modules/core/systemgraph';

/** 归因结果 */
export interface FailureAttribution {
  /** 失败步骤 id（与 `WorkflowRunEndInfo.failedStep` 同源） */
  failedStep: string;
  /** 上游根因候选（按因果强度降序；可能为空 —— 失败步骤没有已声明的上游） */
  candidates: RootCauseCandidate[];
}

/** 步骤级证据引用（指向该 run 内该步骤的记录） */
export function stepEvidenceRef(runId: string, stepId: string): string {
  return `run:${runId}#step:${stepId}`;
}

/**
 * 归因：给出失败步骤的上游因果候选链。
 *
 * @returns 失败步骤不在计划内 ⇒ `undefined`（不编造结论；调用方据此不下发该字段）
 */
export function attributeFailure(params: {
  runId: string;
  steps: readonly TaskStepLike[];
  failedStep: string;
  limit?: number;
}): FailureAttribution | undefined {
  const { runId, steps, failedStep, limit } = params;
  if (!steps.some((step) => step.id === failedStep)) return undefined;

  const graph = projectTaskGraph(steps, {
    // 边的证据 = 指向"前提步骤"在本 run 内的记录（根因要落到可追溯的具体步骤）
    evidence: (fromStepId) => stepEvidenceRef(runId, fromStepId),
  });
  const candidates = graph.findRootCauseCandidates(
    failedStep,
    limit === undefined ? {} : { limit }
  );
  return { failedStep, candidates };
}
