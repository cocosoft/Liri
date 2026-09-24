/**
 * P0-1 / P0-2 基础期单测：运行时系统图内核 + 只读投影 + 根因候选检索。
 *
 * 依据 `.trae/specs/graph-engineering-p0.md` §三 验收：
 * 拓扑序 / 成环抛错 / 重复节点 / 悬空边 / 自环 / 依赖缺失 / 反向邻接 /
 * 根因候选的距离-权重排序与证据链 / 投影函数与既有结构兼容。
 */

import { describe, it, expect } from 'bun:test';

import {
  SystemGraph,
  EDGE_CAUSAL_WEIGHT,
  projectTaskGraph,
  projectAgentGraph,
} from '../../src/core/systemgraph/index.js';

/** 断言 AppError 的错误码（`AppError.code`；避免按文案判别 —— CS02） */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code);
  }
  return '(no-throw)';
}

describe('SystemGraph 基础：拓扑序与结构校验', () => {
  it('dependsOn 拓扑序：前提在前（确定性，按 id 升序打破并列）', () => {
    const g = projectTaskGraph([
      { id: 'c', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'a' },
    ]);
    expect(g.topologicalOrder().map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('成环 ⇒ 抛 SYSTEM_GRAPH_CYCLE（内核不静默回退）', () => {
    const g = new SystemGraph();
    g.addNode({ id: 'a', kind: 'task' });
    g.addNode({ id: 'b', kind: 'task' });
    g.addEdge({ from: 'a', to: 'b', kind: 'dependsOn' });
    g.addEdge({ from: 'b', to: 'a', kind: 'dependsOn' });
    expect(codeOf(() => g.topologicalOrder())).toBe('SYSTEM_GRAPH_CYCLE');
  });

  it('重复节点 / 悬空边 / 自环 均抛错', () => {
    const g = new SystemGraph();
    g.addNode({ id: 'a', kind: 'task' });
    expect(codeOf(() => g.addNode({ id: 'a', kind: 'task' }))).toBe(
      'SYSTEM_GRAPH_DUPLICATE_NODE'
    );
    expect(codeOf(() => g.addEdge({ from: 'a', to: 'ghost', kind: 'dependsOn' }))).toBe(
      'SYSTEM_GRAPH_DANGLING_EDGE'
    );
    expect(codeOf(() => g.addEdge({ from: 'a', to: 'a', kind: 'dependsOn' }))).toBe(
      'SYSTEM_GRAPH_SELF_LOOP'
    );
  });

  it('投影时依赖未声明 ⇒ 抛 SYSTEM_GRAPH_DEPENDENCY_MISSING（对齐 WorkflowEngine 的静默期）', () => {
    expect(
      codeOf(() => projectTaskGraph([{ id: 'a', dependsOn: ['missing'] }]))
    ).toBe('SYSTEM_GRAPH_DEPENDENCY_MISSING');
  });

  it('inEdges = 上游（回溯方向）、outEdges = 下游；列表按 id 排序保证确定性', () => {
    const g = projectTaskGraph([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
    ]);
    expect(g.inEdges('b').map((e) => e.from)).toEqual(['a']);
    expect(g.outEdges('a').map((e) => e.to)).toEqual(['b', 'c']);
    expect(g.inEdges('a')).toEqual([]);
  });

  it('快照可序列化且稳定（同图两次 snapshot 一致）', () => {
    const g = projectTaskGraph([{ id: 'a' }, { id: 'b', dependsOn: ['a'] }]);
    expect(JSON.stringify(g.snapshot())).toBe(JSON.stringify(g.snapshot()));
  });
});

describe('P0-2 根因候选检索（沿反向边 + 边权重排序 + 证据链）', () => {
  it('同距离下 dependsOn 优先于 producedBy（EDGE_CAUSAL_WEIGHT 生效）', () => {
    const g = new SystemGraph();
    for (const id of ['prereq', 'producer', 'failed']) {
      g.addNode({ id, kind: 'task' });
    }
    g.addEdge({
      from: 'prereq',
      to: 'failed',
      kind: 'dependsOn',
      evidenceRef: 'step:prereq@tool-call-1',
    });
    g.addEdge({ from: 'producer', to: 'failed', kind: 'producedBy' });

    const candidates = g.findRootCauseCandidates('failed');
    expect(candidates.map((c) => c.nodeId)).toEqual(['prereq', 'producer']);
    expect(candidates[0].score).toBe(EDGE_CAUSAL_WEIGHT.dependsOn);
    expect(candidates[1].score).toBe(EDGE_CAUSAL_WEIGHT.producedBy);
  });

  it('距离越远得分越低（同为 dependsOn 时 2 跳 < 1 跳）', () => {
    const g = projectTaskGraph([
      { id: 'root' },
      { id: 'mid', dependsOn: ['root'] },
      { id: 'failed', dependsOn: ['mid'] },
    ]);
    const c = g.findRootCauseCandidates('failed');
    expect(c.map((x) => [x.nodeId, x.distance])).toEqual([
      ['mid', 1],
      ['root', 2],
    ]);
    expect(c[0].score).toBeGreaterThan(c[1].score);
  });

  it('证据链沿路径收集（去重、保序），并把 evidenceRef 原样暴露供复核', () => {
    const g = new SystemGraph();
    g.addNode({ id: 'a', kind: 'task' });
    g.addNode({ id: 'b', kind: 'state' });
    g.addNode({ id: 'failed', kind: 'task' });
    g.addEdge({
      from: 'a',
      to: 'b',
      kind: 'producedBy',
      evidenceRef: 'checkpoint:cp-1',
    });
    g.addEdge({
      from: 'b',
      to: 'failed',
      kind: 'blockedBy',
      evidenceRef: 'checkpoint:cp-1',
    });
    g.addEdge({
      from: 'a',
      to: 'failed',
      kind: 'assignedTo',
      evidenceRef: 'msg-9',
    });

    const candidates = g.findRootCauseCandidates('failed');
    const bCandidate = candidates.find((c) => c.nodeId === 'b')!;
    // 路径上的两条边都指向同一证据 ⇒ 去重后只剩一项
    expect(bCandidate.pathEvidenceRefs).toEqual(['checkpoint:cp-1']);
    const aCandidate = candidates.find((c) => c.nodeId === 'a')!;
    // a 有两条到达路径（经 b 的 2 跳 blockedBy / 直达 1 跳 assignedTo），
    // 保留**更短**的那条（1 跳），不被 2 跳覆盖
    expect(aCandidate.distance).toBe(1);
    expect(aCandidate.pathEvidenceRefs).toContain('msg-9');
  });

  it('为未知起点检索 ⇒ 抛错（不静默返回空集）', () => {
    const g = projectTaskGraph([{ id: 'a' }]);
    expect(codeOf(() => g.findRootCauseCandidates('nope'))).toBe(
      'SYSTEM_GRAPH_UNKNOWN_START'
    );
  });

  it('maxDepth / limit 生效（有界遍历）', () => {
    const g = projectTaskGraph([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'd', dependsOn: ['c'] },
    ]);
    expect(g.findRootCauseCandidates('d', { maxDepth: 1 }).map((x) => x.nodeId)).toEqual([
      'c',
    ]);
    expect(g.findRootCauseCandidates('d', { limit: 2 })).toHaveLength(2);
  });
});

describe('只读投影：与既有结构兼容（core 不 import 业务类型）', () => {
  it('projectTaskGraph 承载 tool/description 到 attrs/label', () => {
    const g = projectTaskGraph([
      { id: 's1', description: '收集材料', tool: 'web_search' },
    ]);
    const node = g.getNode('s1')!;
    expect(node.kind).toBe('task');
    expect(node.label).toBe('收集材料');
    expect(node.attrs).toMatchObject({ tool: 'web_search' });
  });

  it('projectAgentGraph 承载 capabilities/expertise（供后续按图分配）', () => {
    const g = projectAgentGraph([
      { id: 'a1', role: 'reviewer', capabilities: ['code_review'], expertise: ['ts'] },
    ]);
    const node = g.getNode('a1')!;
    expect(node.kind).toBe('agent');
    expect(node.attrs).toMatchObject({
      capabilities: ['code_review'],
      expertise: ['ts'],
    });
    // 智能体子图本期无边（assignedTo 属运行期事实，接线期补）
    expect(g.listEdges()).toEqual([]);
  });
});
