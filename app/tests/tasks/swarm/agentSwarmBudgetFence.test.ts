/**
 * G-02（2026-10-19）：AgentSwarm 批次级 in-flight 熔断。
 *
 * 契约：
 *  ① 开局即越界 ⇒ 不投递任何 worker 批次；
 *  ② 中途越界 ⇒ 后续批次不再投递（已投递批次的结果保留），verifier / synthesizer 不再启动。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { AgentSwarm } from '../../../src/tasks/swarm/AgentSwarm';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../../src/query/DailyBudgetManager';

const SID = 'sess-swarm-fence';

function lockBudget(): void {
  const budget = getDailyBudget();
  budget.setLimitUsd(1);
  budget.recordUsdUsage(2);
}

const tasks = [
  { id: 't1', description: 'task 1' },
  { id: 't2', description: 'task 2' },
];

describe('G-02：AgentSwarm 批次级预算熔断', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('开局即越界 ⇒ 一个 worker 都不投递', async () => {
    lockBudget();
    let calls = 0;

    const result = await new AgentSwarm().run({
      tasks,
      goal: 'g',
      sessionId: SID,
      executor: async () => {
        calls++;
        return { output: 'ok', ok: true };
      },
      enableVerify: false,
      enableSynthesize: false,
    });

    expect(calls).toBe(0);
    expect(result.workers).toHaveLength(0);
    expect(result.allPassed).toBe(false);
  });

  it('中途越界 ⇒ 后续批次不再投递', async () => {
    let calls = 0;

    const result = await new AgentSwarm().run({
      tasks,
      goal: 'g',
      sessionId: SID,
      maxConcurrency: 1,
      executor: async () => {
        calls++;
        // 第一个 worker 完成后把额度用尽 ⇒ 第二个批次必须被拦截
        lockBudget();
        return { output: 'ok', ok: true };
      },
      enableVerify: false,
      enableSynthesize: false,
    });

    expect(calls).toBe(1);
    expect(result.workers).toHaveLength(1);
  });
});
