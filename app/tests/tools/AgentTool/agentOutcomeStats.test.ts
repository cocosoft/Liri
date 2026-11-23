// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 按 agent 的任务结果事实源（`agent-load-routing.md` §7 第 2 项）回归锁。
 *
 * 锁四条：
 * ① 无样本 ⇒ `signal` 返回 `undefined`（调用方不得据此打分）；
 * ② 成功率为**窗口内**滚动值，空归属（agentId / taskKind 为空）不记账；
 * ③ 分桶隔离（同 agent 不同 taskKind 互不影响）+ LRU 上限；
 * ④ 接线：结算唯一入口（`AgentLedgerLifecycle.settleRun`）只在**有注册表归属**时落样本，
 *    且认领闸门幂等 ⇒ 同一次 run 只计一次。
 */
import { afterEach, describe, expect, test } from 'bun:test';

import {
  AgentOutcomeLedger,
  getAgentOutcomeLedger,
  resetAgentOutcomeLedgerForTest,
} from '@openliri/tool-agent/AgentTool/agentOutcomeStats';
import { AgentLedgerLifecycle } from '@openliri/tool-agent/AgentTool/agentLedgerLifecycle';
import { getAgentRunLedger } from '@openliri/tool-agent/AgentTool/AgentRunLedger';

afterEach(() => {
  resetAgentOutcomeLedgerForTest();
});

describe('AgentOutcomeLedger：事实源本体', () => {
  test('无样本 ⇒ undefined（不打分、不造 0）', () => {
    const led = new AgentOutcomeLedger();
    expect(led.signal('agent-1', 'general')).toBeUndefined();
  });

  test('窗口内滚动成功率（两位小数）+ 窗口淘汰旧样本', () => {
    const led = new AgentOutcomeLedger(3);
    led.record('agent-1', 'general', true);
    led.record('agent-1', 'general', false);
    led.record('agent-1', 'general', false);
    expect(led.signal('agent-1', 'general')).toEqual({
      sampleCount: 3,
      successRate: 0.33,
    });

    // 第 4 条把最早的成功挤出窗口 ⇒ 近 3 条全失败
    led.record('agent-1', 'general', false);
    expect(led.signal('agent-1', 'general')).toEqual({
      sampleCount: 3,
      successRate: 0,
    });
  });

  test('空归属不记账；分桶隔离', () => {
    const led = new AgentOutcomeLedger();
    led.record('', 'general', true);
    led.record('agent-1', '', true);
    expect(led.size()).toBe(0);

    led.record('agent-1', 'general', true);
    led.record('agent-1', 'verification', false);
    expect(led.signal('agent-1', 'general')?.successRate).toBe(1);
    expect(led.signal('agent-1', 'verification')?.successRate).toBe(0);
  });

  test('LRU：超出桶上限淘汰最早建立的桶', () => {
    const led = new AgentOutcomeLedger(20, 2);
    led.record('a1', 'general', true);
    led.record('a2', 'general', true);
    led.record('a3', 'general', true);
    expect(led.size()).toBe(2);
    expect(led.signal('a1', 'general')).toBeUndefined();
    expect(led.signal('a3', 'general')?.sampleCount).toBe(1);
  });

  test('全局实例复用 + 测试重置', () => {
    const a = getAgentOutcomeLedger();
    expect(getAgentOutcomeLedger()).toBe(a);
    resetAgentOutcomeLedgerForTest();
    expect(getAgentOutcomeLedger()).not.toBe(a);
  });
});

describe('接线：结算唯一入口按注册表归属记账', () => {
  function makeLifecycle(): AgentLedgerLifecycle {
    return new AgentLedgerLifecycle({
      getName: () => 'agent',
      emitStart: () => undefined,
      notifyYieldSettlement: async () => undefined,
    });
  }

  test('有 registryAgentId ⇒ 落一条样本；无归属 ⇒ 不落', async () => {
    const runLedger = getAgentRunLedger();
    const suffix = Math.random().toString(36).slice(2, 8);
    const withRegistry = `run-reg-${suffix}`;
    const withoutRegistry = `run-plain-${suffix}`;
    runLedger.register({
      id: withRegistry,
      name: 'R',
      type: 'general',
      registryAgentId: `agent-${suffix}`,
    });
    runLedger.register({ id: withoutRegistry, name: 'P', type: 'general' });

    const lifecycle = makeLifecycle();
    await lifecycle.settleRun(withRegistry, 'completed');
    await lifecycle.settleRun(withoutRegistry, 'failed');

    const signal = getAgentOutcomeLedger().signal(`agent-${suffix}`, 'general');
    expect(signal).toEqual({ sampleCount: 1, successRate: 1 });

    // 认领闸门幂等：再次结算同一 run ⇒ 不重复计数
    await lifecycle.settleRun(withRegistry, 'failed');
    expect(
      getAgentOutcomeLedger().signal(`agent-${suffix}`, 'general')
    ).toEqual({ sampleCount: 1, successRate: 1 });
  });
});
