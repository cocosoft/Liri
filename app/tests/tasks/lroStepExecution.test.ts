// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-22/S2b：`executeSingleStep` 外移至 `lro/stepExecution` 后的**收尾分支**守卫
 * （默认 executor 路径，无 TAORLoop —— 不触碰模型，确定性可复现）：
 *   ① 执行异常且仍有重试额度 ⇒ 置回 pending 并递增 retryCount（有界重试）；
 *   ② 重试超限 ⇒ failed + escalate（`PDCA_STEP_EXECUTION_EXHAUSTED`）；
 *   ③ 中止引发 ⇒ cancelled「用户中止」，不重试、不升级。
 *
 * 说明：TAORLoop 分支（正常完成 / 工厂与共享实例两条路）由 `batchParallel.test.ts`
 * 覆盖；三处合起来即交接单 §4 的四分支冒烟。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';

// 隔离计划持久化目录：测试计划写入临时目录，避免污染用户数据（~/.pyapp/data/plans/）
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-s2b-')));

// checkpoint 落 app.db ⇒ 隔离临时库，避免污染真实 ~/.pyapp/data/app.db
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-step-exec-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(async () => {
  const { closePdcaCheckpointStore } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

type OrchestratorUnderTest = {
  planId: string | null;
  isolation: { abort(reason?: string): void };
  executeSingleStep: (step: PlanStep, plan: Plan) => Promise<void>;
};

/** 用抛错执行器构造编排器（默认路径；不注入 TAORLoop） */
function makeOrchestrator(
  executor: () => Promise<never>
): OrchestratorUnderTest {
  return new LongRunningTaskOrchestrator(
    `s2b-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    executor
  ) as unknown as OrchestratorUnderTest;
}

function prepareStep(
  o: OrchestratorUnderTest,
  description: string,
  maxRetries?: number
): { plan: Plan; step: PlanStep } {
  const plan = taskOrchestrator.createPlan(
    description,
    ['步骤A'],
    'session-s2b'
  );
  o.planId = plan.id;
  const step = plan.steps[0];
  if (maxRetries !== undefined) step.maxRetries = maxRetries;
  return { plan, step };
}

describe('executeSingleStep 收尾分支（U-22/S2b 外移守卫）', () => {
  it('执行异常且仍有额度 ⇒ pending + retryCount 递增（有界重试）', async () => {
    const o = makeOrchestrator(async () => {
      throw new Error('transient-tool-error');
    });
    const { plan, step } = prepareStep(o, 'S2b 有界重试', 3);

    await o.executeSingleStep(step, plan);

    expect(step.status).toBe('pending');
    expect(step.retryCount).toBe(1);
    expect(step.error).toContain('transient-tool-error');
  });

  it('重试超限 ⇒ failed + escalate（PDCA_STEP_EXECUTION_EXHAUSTED）', async () => {
    const o = makeOrchestrator(async () => {
      throw new Error('exhausted-error');
    });
    const { plan, step } = prepareStep(o, 'S2b 超限升级', 0);

    await o.executeSingleStep(step, plan);

    expect(step.status).toBe('failed');
    expect(step.decision).toBe('escalate');
    expect(step.error).toContain('Exceeded max retries (0)');
    expect(step.error).toContain('exhausted-error');
  });

  it('中止引发 ⇒ cancelled「用户中止」，不重试不升级', async () => {
    const holder: { o?: OrchestratorUnderTest } = {};
    const o = makeOrchestrator(async () => {
      holder.o?.isolation.abort('test-abort');
      throw new Error('ABORTED: test');
    });
    holder.o = o;
    const { plan, step } = prepareStep(o, 'S2b 用户中止', 3);

    await o.executeSingleStep(step, plan);

    // 2026-10-17：`createPlan` 现在会建 stepId→Plan 索引（此前 no-op），
    // 故可直接读回步骤终态，无需 spy。
    expect(step.status).toBe('cancelled');
    expect(step.error).toBe('用户中止');
    // 不重试、不升级：retryCount 未递增，decision 未被置 escalate
    expect(step.retryCount).toBe(0);
    expect(step.decision).toBeUndefined();
  });
});
