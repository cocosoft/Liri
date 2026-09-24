/**
 * 按图分配（P0-1 接线期③，2026-09-24）
 *
 * 覆盖：筛选复用 `discoverAgents` 语义（逐条一致）/ 优先级降序与 limit / minPriority /
 * 无候选不虚构 / **`assignedTo` 边方向与根因回溯**（agent → task）/ agent 节点幂等 /
 * 空目标集。
 */

import { afterAll, describe, expect, it } from 'bun:test';

import { AgentRegistry } from '../../src/agent/registry/AgentRegistry';
import type { AgentDefinition } from '../../src/agent/registry/AgentRegistry';

const AGENTS: AgentDefinition[] = [
  {
    agentId: 'market',
    name: '市场分析师',
    role: 'market_analyst',
    expertise: ['market'],
    weight: 1,
    priority: 9,
    capabilities: ['research'],
  },
  {
    agentId: 'arch',
    name: '技术架构师',
    role: 'tech_architect',
    expertise: ['tech'],
    weight: 1,
    priority: 7,
    capabilities: ['code_review'],
  },
  {
    agentId: 'legal',
    name: '法务顾问',
    role: 'legal_advisor',
    expertise: ['legal'],
    weight: 1,
    priority: 5,
  },
];

function registry(): AgentRegistry {
  AgentRegistry.resetInstance();
  const reg = AgentRegistry.getInstance();
  reg.registerAgents(AGENTS);
  return reg;
}

/**
 * **必须清理**：`AgentRegistry` 是全局单例，本文件注册的 fixture agent（`market`/`arch`/
 * `legal`）会泄漏给同进程后续测试文件 —— 实测泄漏会让 `tools/AgentTool/subagentTypeSchema.test.ts`
 * 的"描述不含 architect"断言失败（该断言读共享注册表快照）。故用完即重置。
 */
afterAll(() => {
  AgentRegistry.resetInstance();
});

describe('AgentRegistry.assignAgentsByGraph', () => {
  it('候选池与直接调用 discoverAgents 逐条一致（复用同一筛选语义）', () => {
    const reg = registry();

    const { assignments } = reg.assignAgentsByGraph([
      { targetId: 't1', expertise: ['tech'] },
    ]);

    expect(assignments[0].candidates).toEqual(
      reg.discoverAgents({ expertise: ['tech'] })
    );
    expect(assignments[0].agentIds).toEqual(['arch']);
  });

  it('按优先级降序分配，limit 控制数量', () => {
    const reg = registry();

    const { assignments } = reg.assignAgentsByGraph([
      { targetId: 't1', expertise: ['market', 'tech'], limit: 2 },
      { targetId: 't2', expertise: ['market', 'tech'] },
    ]);

    // priority: market 9 > arch 7
    expect(assignments[0].agentIds).toEqual(['market', 'arch']);
    // 默认 limit=1
    expect(assignments[1].agentIds).toEqual(['market']);
    // 候选池未截断
    expect(assignments[1].candidates.map((a) => a.agentId)).toEqual([
      'market',
      'arch',
    ]);
  });

  it('minPriority 与 capability 生效（与 discoverAgents 同口径）', () => {
    const reg = registry();

    const { assignments } = reg.assignAgentsByGraph([
      { targetId: 't1', minPriority: 8 },
      { targetId: 't2', capability: 'code_review' },
    ]);

    expect(assignments[0].agentIds).toEqual(['market']);
    expect(assignments[1].agentIds).toEqual(['arch']);
  });

  it('无满足条件者 ⇒ 空分配，且图中无 agent 节点/边（不虚构）', () => {
    const reg = registry();

    const { assignments, graph } = reg.assignAgentsByGraph([
      { targetId: 't1', expertise: ['quantum_physics'] },
    ]);

    expect(assignments[0].agentIds).toEqual([]);
    expect(assignments[0].candidates).toEqual([]);
    expect(graph.listNodes()).toEqual([{ id: 't1', kind: 'task' }]);
    expect(graph.listEdges()).toEqual([]);
  });

  it('assignedTo 边方向为 agent → task，可回溯出该 agent 作根因候选', () => {
    const reg = registry();

    const { graph } = reg.assignAgentsByGraph([
      { targetId: 't1', expertise: ['tech'] },
    ]);

    // 方向：from = 执行者(agent)，to = 被指派的任务
    expect(graph.inEdges('t1').map((e) => [e.from, e.kind, e.to])).toEqual([
      ['arch', 'assignedTo', 't1'],
    ]);
    expect(graph.outEdges('arch').map((e) => e.to)).toEqual(['t1']);

    const candidates = graph.findRootCauseCandidates('t1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].nodeId).toBe('arch');
    expect(candidates[0].kind).toBe('agent');
    expect(candidates[0].distance).toBe(1);
    // 弱因果权重 0.2（EDGE_CAUSAL_WEIGHT.assignedTo）
    expect(candidates[0].score).toBe(0.2);
    // 证据引用指回注册表记录，可独立复核
    expect(candidates[0].pathEvidenceRefs).toEqual(['agent_registry:arch']);
  });

  it('同一 agent 服务多个目标 ⇒ agent 节点唯一，每个目标各有一条边', () => {
    const reg = registry();

    const { graph } = reg.assignAgentsByGraph([
      { targetId: 't1', expertise: ['market'] },
      { targetId: 't2', expertise: ['market'] },
    ]);

    expect(graph.listNodes('agent').map((n) => n.id)).toEqual(['market']);
    expect(graph.listEdges()).toHaveLength(2);
    expect(graph.listNodes('task').map((n) => n.id)).toEqual(['t1', 't2']);
  });

  it('空目标集 ⇒ 空分配与空图；无条件的多个目标不被互相影响', () => {
    const reg = registry();

    const empty = reg.assignAgentsByGraph([]);
    expect(empty.assignments).toEqual([]);
    expect(empty.graph.listNodes()).toEqual([]);

    // 无筛选条件 ⇒ 全部候选（默认 limit=1 取优先级最高者）
    const all = reg.assignAgentsByGraph([{ targetId: 't1' }]);
    expect(all.assignments[0].agentIds).toEqual(['market']);
    expect(all.assignments[0].candidates).toHaveLength(3);
  });
});
