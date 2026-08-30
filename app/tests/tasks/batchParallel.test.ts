// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D2（M3，2026-08-13）：无依赖步骤批次并行测试
 * 验证 executeAllSteps 在注入每步独立 TAORLoop 工厂后并行执行独立步骤；
 * 未注入工厂时回退串行（现状零回归）。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';

// 隔离计划持久化目录：测试计划写入临时目录，避免污染用户数据（~/.pyapp/data/plans/）
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-test-')));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 构造带并发计数的假 TAORLoop（记录活跃执行数峰值） */
function makeFakeLoop(tracker: { active: number; maxActive: number }) {
  return {
    config: { sessionId: '' },
    runCollect: async () => {
      tracker.active++;
      tracker.maxActive = Math.max(tracker.maxActive, tracker.active);
      await sleep(30);
      tracker.active--;
      return { turnCount: 1, totalTokens: 10 };
    },
  } as never;
}

// 注：不能写成 LongRunningTaskOrchestrator & {...} 交集——其 planId 为 private 成员，
// 交集会因 private 标识符冲突被化简为 never。此处用独立接口，配合构造处的
// `as unknown as` 双重断言访问私有字段（仅测试私有细节用）。
type OrchestratorWithPrivates = {
  planId: string | null;
  setTAORLoopFactory: (f: (sessionId: string) => never) => void;
  executeAllSteps: () => Promise<unknown>;
};

function makeOrchestrator(): OrchestratorWithPrivates {
  const o = new LongRunningTaskOrchestrator(
    `d2-test-${Date.now()}`,
    async () => 'mock-result'
  ) as unknown as OrchestratorWithPrivates;
  return o;
}

describe('executeAllSteps — 无依赖步骤批次并行（D2）', () => {
  it('注入工厂后独立步骤并行执行（maxActive ≥ 2）', async () => {
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      'D2 并行测试',
      ['步骤A', '步骤B', '步骤C'],
      'session-d2'
    );
    o.planId = plan.id;

    const tracker = { active: 0, maxActive: 0 };
    o.setTAORLoopFactory(() => makeFakeLoop(tracker) as never);

    await o.executeAllSteps();

    expect(tracker.maxActive).toBeGreaterThan(1);
  });

  it('未注入工厂时串行执行（maxActive = 1，现状回归）', async () => {
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      'D2 串行测试',
      ['步骤X', '步骤Y', '步骤Z'],
      'session-d2-seq'
    );
    o.planId = plan.id;

    const tracker = { active: 0, maxActive: 0 };
    // 注入共享实例（setTAORLoop）但不注入工厂 → 串行
    const sharedLoop = makeFakeLoop(tracker) as never;
    (o as unknown as { setTAORLoop: (l: never) => void }).setTAORLoop(
      sharedLoop
    );

    await o.executeAllSteps();

    expect(tracker.maxActive).toBe(1);
  });
});
