// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Q-18（2026-10-23）：`agents_list` 由影子工具 `rewrite` 后接线的回归锁。
 *
 * 锁定三点：
 * ① 过滤 / 分页 / 计数口径（纯函数 `shapeAgentsList`，不依赖全局单例）；
 * ② `spawn` 暂停态**同源**于 `getSpawnPauseState()`（与 `POST /v1/agents/pause` 一致）；
 * ③ 工具声明：只读、风险 `read`、**不再**保留控制面投影里不存在的 `parentSessionId` 过滤
 *    （修复前该参数是假能力）。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  AgentsListTool,
  shapeAgentsList,
  type AgentEntry,
} from '../../src/tools/AgentsListTool/AgentsListTool';
import {
  resetSpawnPause,
  setSpawnPaused,
} from '../../src/tools/AgentTool/spawnPause';
import { deriveToolRiskClass } from '../../src/tools/toolRiskClass';

const RAW: AgentEntry[] = [
  {
    id: 'a1',
    name: 'runner',
    type: 'general',
    startTime: 100,
    status: 'running',
  },
  {
    id: 'a2',
    name: 'explorer',
    type: 'explore',
    startTime: 200,
    status: 'running',
  },
  {
    id: 'a3',
    name: 'verifier',
    type: 'verification',
    startTime: 300,
    status: 'cancel_requested',
  },
];

afterEach(() => {
  resetSpawnPause();
});

describe('agents_list：活跃代理投影（shapeAgentsList）', () => {
  it('无过滤 ⇒ 全量；计数区分 running / cancel_requested', () => {
    const r = shapeAgentsList(RAW, {});

    expect(r.total).toBe(3);
    expect(r.filtered).toBe(3);
    expect(r.returned).toBe(3);
    expect(r.running).toBe(2);
    expect(r.cancelRequested).toBe(1);
    expect(r.agents.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('按 type / status 过滤，且 total 仍为过滤前全量', () => {
    expect(
      shapeAgentsList(RAW, { type: 'explore' }).agents.map((a) => a.id)
    ).toEqual(['a2']);

    const cancelled = shapeAgentsList(RAW, { status: 'cancel_requested' });
    expect(cancelled.total).toBe(3);
    expect(cancelled.filtered).toBe(1);
    expect(cancelled.agents.map((a) => a.id)).toEqual(['a3']);
  });

  it('分页：offset/limit 生效，returned 与 filtered 分离', () => {
    const page = shapeAgentsList(RAW, { offset: 1, limit: 1 });

    expect(page.filtered).toBe(3);
    expect(page.returned).toBe(1);
    expect(page.agents.map((a) => a.id)).toEqual(['a2']);
  });

  it('limit / offset 归一：非法值回默认、超上限截断', () => {
    expect(shapeAgentsList(RAW, { limit: 0 }).returned).toBe(3);
    expect(shapeAgentsList(RAW, { limit: Number.NaN }).returned).toBe(3);
    expect(shapeAgentsList(RAW, { offset: -5, limit: 999 }).returned).toBe(3);
  });

  it('spawn 暂停态与 getSpawnPauseState() 同源', () => {
    setSpawnPaused(true, '成本失控');
    const paused = shapeAgentsList(RAW, {});
    expect(paused.spawn.paused).toBe(true);
    expect(paused.spawn.reason).toBe('成本失控');

    resetSpawnPause();
    expect(shapeAgentsList(RAW, {}).spawn.paused).toBe(false);
  });
});

describe('agents_list：工具声明（接线口径）', () => {
  it('只读 + 风险判 read（TOOL_EFFECTS: none）', () => {
    const tool = new AgentsListTool();

    expect(tool.isReadOnly({})).toBe(true);
    expect(deriveToolRiskClass(tool, {})).toBe('read');
    expect(tool.getInfo().riskClass).toBe('read');
  });

  it('出参声明含 spawn / 计数 / agents，且不再有 parentSessionId 假参数', () => {
    const tool = new AgentsListTool();

    expect(
      Object.keys(tool.outputJsonSchema.properties as object).sort()
    ).toEqual([
      'agents',
      'cancelRequested',
      'filtered',
      'returned',
      'running',
      'spawn',
      'total',
    ]);
    expect(tool.params.map((p) => p.name)).toEqual([
      'type',
      'status',
      'limit',
      'offset',
    ]);
  });
});
