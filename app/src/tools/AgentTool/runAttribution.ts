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
 * 子代理 run 的**分配落图 + 失败归因**（P0-1 接线期③ 方向 ③-A，2026-09-24）
 *
 * 论文 §11.2：runtime evidence 可触发对任务/智能体结构的修订。本模块把一次子代理 run
 * 的**分配关系**与**执行步骤**投影进运行时系统图，并在 run 未完成时沿反向边回溯出
 * **根因候选**（复用 `core/systemgraph` 的 `findRootCauseCandidates`，不另建检索）。
 *
 * 图结构（方向遵循 `core/systemgraph/types.ts` 的全局约定：`from` 因 → `to` 果）：
 *
 * ```
 *   agent(执行者) --assignedTo--> run:runId(本次任务)
 *   run:runId --dependsOn--> step:id₁ --dependsOn--> step:id₂ --> …
 * ```
 *
 * - 步骤链按**执行序**声明：ReAct 循环中后续步骤的上下文包含前序工具结果 ⇒ 语义上是依赖。
 * - 归因起点：有明确失败步骤时用该步骤节点，否则用 run 节点（**不猜**失败步骤）。
 * - `evidenceRef` **指向前提方**（与 `modules/workflow/failureAttribution.ts:68` 的既有约定一致：
 *   "边的证据 = 指向前提步骤在本 run 内的记录，根因要落到可追溯的具体步骤"）——
 *   分配边指向台账行（`agent_run:<runId>`），步骤边指向前一步的 tool use（`tool_use:<前提步骤 id>`）。
 *
 * **仅在失败时调用**（成功路径零开销、零图构建）。
 */

import { SystemGraph } from '@modules/core/systemgraph';
import type {
  RootCauseCandidate,
  SystemGraphSnapshot,
} from '@modules/core/systemgraph';

/** 一次子代理 run 中的单个执行步骤（只记事实，不含解释） */
export interface AgentRunStepFact {
  /** 步骤 id（= tool use id，run 内唯一） */
  stepId: string;
  /** 实际调用的工具名 */
  tool: string;
  /** 该次工具调用是否成功（`false` = 工具返回失败或抛错） */
  ok: boolean;
}

export interface AgentRunAttributionInput {
  /** run 身份（= 台账 `tool_call_id`） */
  runId: string;
  /** 被指派的执行者标识（DB 角色名 / 内置类型名 / agentId）；缺省则不建分配边 */
  agentId?: string;
  /** 执行步骤（按执行序） */
  steps: readonly AgentRunStepFact[];
  /** 明确失败的步骤 id（缺省 ⇒ 以 run 节点为归因起点） */
  failedStepId?: string;
  /** 候选上限（默认 5） */
  limit?: number;
}

export interface AgentRunAttribution {
  /** 归因起点（图中节点 id） */
  failedNodeId: string;
  /** 根因候选（按因果强度降序；含证据引用链） */
  candidates: RootCauseCandidate[];
  /** 本次 run 的图快照（可序列化，供审计与复算） */
  graph: SystemGraphSnapshot;
}

/** run 节点 id 前缀（与步骤节点区分，避免与 agentId 撞 id） */
const RUN_NODE_PREFIX = 'run:';
/** 步骤节点 id 前缀 */
const STEP_NODE_PREFIX = 'step:';

/**
 * 构建 run 图并做一次上游回溯。
 *
 * @returns 无可归因对象（既无执行者又无步骤）时返回 `undefined` —— 不产出空结论（CS06）。
 */
export function attributeAgentRun(
  input: AgentRunAttributionInput
): AgentRunAttribution | undefined {
  const { runId, agentId, steps } = input;
  if (!agentId && steps.length === 0) return undefined;

  const graph = new SystemGraph();
  const runNodeId = `${RUN_NODE_PREFIX}${runId}`;
  graph.addNode({ id: runNodeId, kind: 'task' });

  if (agentId) {
    graph.addNode({ id: agentId, kind: 'agent' });
    graph.addEdge({
      from: agentId,
      to: runNodeId,
      kind: 'assignedTo',
      evidenceRef: `agent_run:${runId}`,
    });
  }

  let previousId = runNodeId;
  // 前提方的证据引用：run 阶段指回台账行；进入步骤后指向前一步的 tool use
  let previousEvidence = `agent_run:${runId}`;
  for (const step of steps) {
    const nodeId = `${STEP_NODE_PREFIX}${step.stepId}`;
    if (!graph.hasNode(nodeId)) {
      graph.addNode({
        id: nodeId,
        kind: 'task',
        label: step.tool,
        attrs: { tool: step.tool, ok: step.ok },
      });
    }
    graph.addEdge({
      from: previousId,
      to: nodeId,
      kind: 'dependsOn',
      evidenceRef: previousEvidence,
    });
    previousId = nodeId;
    previousEvidence = `tool_use:${step.stepId}`;
  }

  const wanted = input.failedStepId
    ? `${STEP_NODE_PREFIX}${input.failedStepId}`
    : undefined;
  const failedNodeId = wanted && graph.hasNode(wanted) ? wanted : runNodeId;

  return {
    failedNodeId,
    candidates: graph.findRootCauseCandidates(failedNodeId, {
      limit: input.limit ?? 5,
    }),
    graph: graph.snapshot(),
  };
}
