// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D4：负载感知路由（一期，2026-11-14）。
 *
 * 验收（`.trae/specs/agent-load-routing.md`）：
 * - 排序原语：在跑数升序 → 优先级降序；**全零负载 ⇒ 与入参顺序逐条一致**（稳定）；
 * - 容量：达到在跑上限的候选被排除并如实返回（`atCapacity`）；
 * - 负载聚合：`collectAgentLoads` 按 id 累加；`collectLoadsByType` 适配 `AgentRunView.type`；
 * - 注册表接线：**默认（不传参数）零行为变更**；`routeByLoad: true` 才按负载选人。
 */
import { afterAll, describe, expect, it } from 'bun:test';

import { AgentRegistry } from '../../src/agent/registry/AgentRegistry';
import type { AgentDefinition } from '../../src/agent/registry/AgentRegistry';
import {
  collectAgentLoads,
  collectLoadsByType,
  rankAgentsByLoad,
} from '../../src/agent/routing/loadAwareRouting';

const AGENTS: AgentDefinition[] = [
  {
    agentId: 'market',
    name: '市场分析师',
    role: 'market_analyst',
    expertise: ['market', 'tech'],
    weight: 1,
    priority: 9,
  },
  {
    agentId: 'arch',
    name: '技术架构师',
    role: 'tech_architect',
    expertise: ['tech'],
    weight: 1,
    priority: 7,
  },
  {
    agentId: 'legal',
    name: '法务顾问',
    role: 'legal_advisor',
    expertise: ['market', 'tech'],
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

// AgentRegistry 是全局单例：用完即重置，避免 fixture 泄漏给后续测试文件
afterAll(() => {
  AgentRegistry.resetInstance();
});

describe('rankAgentsByLoad：排序与容量', () => {
  const candidates = [
    { agentId: 'market', priority: 9 },
    { agentId: 'arch', priority: 7 },
    { agentId: 'legal', priority: 5 },
  ];

  it('全零负载 ⇒ 与入参顺序逐条一致（不改变既有优先级顺序）', () => {
    const { ranked, atCapacity } = rankAgentsByLoad(candidates, new Map());
    expect(ranked.map((a) => a.agentId)).toEqual(['market', 'arch', 'legal']);
    expect(atCapacity).toEqual([]);
  });

  it('在跑数升序优先于静态优先级', () => {
    const loads = new Map([
      ['market', 3],
      ['arch', 0],
    ]);
    const { ranked } = rankAgentsByLoad(candidates, loads);
    // arch/legal 均空闲（legal 缺项 = 0）⇒ 先按优先级 arch 7 > legal 5；market 在跑 3 排最后
    expect(ranked.map((a) => a.agentId)).toEqual(['arch', 'legal', 'market']);
  });

  it('同负载 ⇒ 按优先级降序（稳定）', () => {
    const loads = new Map([
      ['legal', 1],
      ['arch', 1],
    ]);
    const { ranked } = rankAgentsByLoad(candidates, loads);
    expect(ranked.map((a) => a.agentId)).toEqual(['market', 'arch', 'legal']);
  });

  it('达到在跑上限 ⇒ 排除并如实返回 atCapacity', () => {
    const loads = new Map([['market', 2]]);
    const { ranked, atCapacity } = rankAgentsByLoad(candidates, loads, {
      maxInFlightPerAgent: 2,
    });
    expect(atCapacity.map((a) => a.agentId)).toEqual(['market']);
    expect(ranked.map((a) => a.agentId)).toEqual(['arch', 'legal']);
  });
});

describe('负载聚合：按 agentId / 按运行类型', () => {
  it('collectAgentLoads 累加重复 id', () => {
    const loads = collectAgentLoads([
      { agentId: 'a' },
      { agentId: 'a' },
      { agentId: 'b' },
    ]);
    expect(loads.get('a')).toBe(2);
    expect(loads.get('b')).toBe(1);
    expect(loads.get('c')).toBeUndefined();
  });

  it('collectLoadsByType 适配 AgentRunView 的 type 字段', () => {
    const loads = collectLoadsByType([
      { type: 'explore' },
      { type: 'explore' },
      { type: 'general' },
    ]);
    expect(loads.get('explore')).toBe(2);
    expect(loads.get('general')).toBe(1);
  });
});

describe('AgentRegistry.assignAgentsByGraph：负载路由为显式 opt-in', () => {
  it('不传 options ⇒ 与改动前一致（纯优先级降序）', () => {
    const reg = registry();
    const { assignments } = reg.assignAgentsByGraph([
      { targetId: 't1', expertise: ['tech'], limit: 2 },
    ]);
    expect(assignments[0].agentIds).toEqual(['market', 'arch']);
    expect(assignments[0].atCapacity).toBeUndefined();
  });

  it('routeByLoad: true ⇒ 低负载优先；容量满者让位', () => {
    const reg = registry();
    const loads = new Map([
      ['market', 3],
      ['arch', 0],
      ['legal', 1],
    ]);
    const { assignments } = reg.assignAgentsByGraph(
      [{ targetId: 't1', expertise: ['tech'], limit: 2 }],
      undefined,
      { routeByLoad: true, loads, maxInFlightPerAgent: 3 }
    );
    // market 达上限(3) ⇒ 排除；arch(0) 先于 legal(1)
    expect(assignments[0].atCapacity).toEqual(['market']);
    expect(assignments[0].agentIds).toEqual(['arch', 'legal']);
    // 候选池仍是 discoverAgents 的原始顺序（可复核"为什么选它"）
    expect(assignments[0].candidates.map((a) => a.agentId)).toEqual([
      'market',
      'arch',
      'legal',
    ]);
  });

  it('routeByLoad: true 但未注入负载 ⇒ 等价于原顺序', () => {
    const reg = registry();
    const { assignments } = reg.assignAgentsByGraph(
      [{ targetId: 't1', expertise: ['tech'], limit: 2 }],
      undefined,
      { routeByLoad: true }
    );
    expect(assignments[0].agentIds).toEqual(['market', 'arch']);
  });
});
