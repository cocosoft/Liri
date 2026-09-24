/**
 * 接线期③ ③-A（2026-09-24）：子代理 run 的分配落图 + 失败归因 + 台账落盘
 *
 * 覆盖：图结构与边方向 / 归因起点选择 / 无对象不产空结论 / limit /
 * `agent_runs.attribution_json` 落盘与回读 / 未给出归因时保留既有值。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  attributeAgentRun,
  type AgentRunStepFact,
} from '../../../src/tools/AgentTool/runAttribution';
import { AgentRunStore } from '../../../src/tools/AgentTool/AgentRunStore';

const STEPS: AgentRunStepFact[] = [
  { stepId: 'tu_1', tool: 'file_read', ok: true },
  { stepId: 'tu_2', tool: 'bash', ok: false },
  { stepId: 'tu_3', tool: 'file_write', ok: true },
];

const tmpDbPath = join(
  tmpdir(),
  `agent-runs-attribution-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);

afterAll(() => {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${tmpDbPath}${suffix}`;
    if (existsSync(file)) rmSync(file, { force: true });
  }
});

describe('attributeAgentRun（纯函数：图结构 + 归因）', () => {
  it('落图：agent --assignedTo--> run --dependsOn--> 步骤链（方向符合全局约定）', () => {
    const attribution = attributeAgentRun({
      runId: 'run-1',
      agentId: 'architect',
      steps: STEPS,
    });

    expect(attribution).toBeDefined();
    const { nodes, edges } = attribution!.graph;
    // listNodes 按 id 升序（内核保证确定性）
    expect(nodes.map((n) => [n.id, n.kind])).toEqual([
      ['architect', 'agent'],
      ['run:run-1', 'task'],
      ['step:tu_1', 'task'],
      ['step:tu_2', 'task'],
      ['step:tu_3', 'task'],
    ]);
    // from = 因 → to = 果：执行者 → 任务；前一步 → 后一步
    // evidenceRef 指向**前提方**（与 workflow 侧 failureAttribution 约定一致）
    expect(
      edges.map((e) => [e.from, e.kind, e.to, e.evidenceRef])
    ).toEqual([
      ['architect', 'assignedTo', 'run:run-1', 'agent_run:run-1'],
      ['run:run-1', 'dependsOn', 'step:tu_1', 'agent_run:run-1'],
      ['step:tu_1', 'dependsOn', 'step:tu_2', 'tool_use:tu_1'],
      ['step:tu_2', 'dependsOn', 'step:tu_3', 'tool_use:tu_2'],
    ]);
    // 步骤节点保留工具名与结果（仅供审计，不参与内核算法）
    expect(nodes.find((n) => n.id === 'step:tu_2')?.attrs).toEqual({
      tool: 'bash',
      ok: false,
    });
  });

  it('归因起点 = 指定失败步骤 ⇒ 候选含上游步骤链与执行者', () => {
    const attribution = attributeAgentRun({
      runId: 'run-1',
      agentId: 'architect',
      steps: STEPS,
      failedStepId: 'tu_3',
    });

    const candidates = attribution!.candidates;
    expect(attribution!.failedNodeId).toBe('step:tu_3');
    // 直接上游（step:tu_2）得分最高：dependsOn 权重 1.0 / 距离 1
    expect(candidates[0]).toMatchObject({
      nodeId: 'step:tu_2',
      distance: 1,
      score: 1,
      pathEvidenceRefs: ['tool_use:tu_2'],
    });
    // 更远的 run 节点与执行者也在候选内（沿链回溯，不越界）
    expect(candidates.map((c) => c.nodeId)).toEqual([
      'step:tu_2',
      'step:tu_1',
      'run:run-1',
      'architect',
    ]);
  });

  it('未指定失败步骤 ⇒ 起点为本 run 节点，仅执行者（弱因果 0.2）可归因', () => {
    const attribution = attributeAgentRun({
      runId: 'run-1',
      agentId: 'architect',
      steps: STEPS,
    });

    expect(attribution!.failedNodeId).toBe('run:run-1');
    expect(attribution!.candidates).toHaveLength(1);
    expect(attribution!.candidates[0]).toMatchObject({
      nodeId: 'architect',
      kind: 'agent',
      score: 0.2,
      pathEvidenceRefs: ['agent_run:run-1'],
    });
  });

  it('指定的失败步骤不在计划内 ⇒ 回退到 run 节点（不抛、不猜）', () => {
    const attribution = attributeAgentRun({
      runId: 'run-1',
      agentId: 'architect',
      steps: STEPS,
      failedStepId: 'ghost',
    });

    expect(attribution!.failedNodeId).toBe('run:run-1');
  });

  it('既无执行者又无步骤 ⇒ undefined（不产空结论，CS06）', () => {
    expect(attributeAgentRun({ runId: 'run-1', steps: [] })).toBeUndefined();
  });

  it('limit 生效（候选截断）', () => {
    const attribution = attributeAgentRun({
      runId: 'run-1',
      agentId: 'architect',
      steps: STEPS,
      failedStepId: 'tu_3',
      limit: 2,
    });

    expect(attribution!.candidates).toHaveLength(2);
  });

  it('不修改入参（纯函数）', () => {
    const steps: AgentRunStepFact[] = [{ stepId: 'tu_1', tool: 'x', ok: true }];
    attributeAgentRun({ runId: 'r', agentId: 'a', steps });
    expect(steps).toEqual([{ stepId: 'tu_1', tool: 'x', ok: true }]);
  });
});

describe('AgentRunStore：失败归因落盘与回读（schema v3）', () => {
  it('settleRun 带归因 ⇒ 落 attribution_json，getRun 回读同形', async () => {
    const store = new AgentRunStore(tmpDbPath);
    const attribution = attributeAgentRun({
      runId: 'run-db',
      agentId: 'architect',
      steps: STEPS,
      failedStepId: 'tu_2',
    })!;

    await store.startRun({
      toolCallId: 'run-db',
      agentId: 'run-db',
      name: '测试任务',
      agentType: 'architect',
      status: 'running',
      startedAt: Date.now(),
    });
    await store.settleRun('run-db', 'failed', { attribution });

    const row = await store.getRun('run-db');
    expect(row?.status).toBe('failed');
    expect(row?.attribution).toEqual(attribution);

    // 未提供归因的结算不得抹掉既有值（COALESCE 语义）；且终态幂等 ⇒ 本次写被丢弃
    const reSettled = await store.settleRun('run-db', 'failed');
    expect(reSettled).toBe(false);
    expect((await store.getRun('run-db'))?.attribution).toEqual(attribution);

    store.close();
  });

  it('完成态无归因 ⇒ attribution 为 undefined（不写空结论）', async () => {
    const store = new AgentRunStore(tmpDbPath);
    await store.startRun({
      toolCallId: 'run-ok',
      agentId: 'run-ok',
      name: '成功任务',
      agentType: 'general',
      status: 'running',
      startedAt: Date.now(),
    });
    await store.settleRun('run-ok', 'completed');

    expect((await store.getRun('run-ok'))?.attribution).toBeUndefined();
    store.close();
  });
});
