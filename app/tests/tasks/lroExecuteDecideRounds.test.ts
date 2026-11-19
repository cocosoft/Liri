// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`_runExecuteDecideLoop` 的轮级守卫（P3-2 拆分前置）。
 *
 * 目的：在把「准入校验」「轮尾 review/decide + 停止闸门」「轮次上限强制退出」
 * 三段原样外移之前，先锁住可观测结果（计划终态、phase、autoDecide 的调用范围）。
 */
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { Plan } from '../../src/tasks/TaskOrchestrator';

taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-roundguards-')));

const dataDir = mkdtempSync(join(tmpdir(), 'pdca-roundguards-'));
process.env.LIRI_DATA_DIR = dataDir;

// G5 端到端用例需要读回检查点与捕获回执（在 env 就绪后再解析模块）
const { readPdcaCheckpoint, closePdcaCheckpointStore } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { setPdcaReceiptSink } =
  await import('../../src/tasks/lro/terminalReceipt');

const ENV_KEYS = [
  'TASK_GOAL_MAX_STEPS',
  'TASK_GOAL_MAX_TURNS',
  'TASK_GOAL_STALL_ROUNDS',
  'PDCA_GOAL_EVALUATE',
  'PDCA_AUTO_REPLAN',
  'PDCA_PENDING_ACCEPTANCE',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  setPdcaReceiptSink(undefined);
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

interface OrchestratorUnderTest {
  planId: string | null;
  goalEvaluateGate: { evaluate: (...args: unknown[]) => Promise<unknown> };
  getTaskId: () => string;
  executeAllSteps: () => Promise<Plan>;
  autoDecideStep: (stepId: string) => Promise<unknown>;
  _runExecuteDecideLoop: () => Promise<{ phase: string }>;
  resumeFromCheckpoint: (
    ck: Record<string, unknown>
  ) => Promise<{ phase: string }>;
}

function makeOrchestrator(): OrchestratorUnderTest {
  const taskId = `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new LongRunningTaskOrchestrator(
    taskId,
    async () => 'noop'
  ) as unknown as OrchestratorUnderTest;
}

/** 关闭目标收敛门，避免测试触达模型 */
function disableGoalGate(): void {
  process.env.PDCA_GOAL_EVALUATE = 'false';
}

describe('_runExecuteDecideLoop 轮级守卫既有行为', () => {
  it('计划超出步骤上限 ⇒ 准入拒绝，计划落 failed 且不进入执行', async () => {
    disableGoalGate();
    process.env.TASK_GOAL_MAX_STEPS = '1';
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      '准入拒绝',
      ['步骤A', '步骤B'],
      'session-admission'
    );
    o.planId = plan.id;
    let executed = false;
    o.executeAllSteps = async () => {
      executed = true;
      return plan;
    };

    const status = await o._runExecuteDecideLoop();

    expect(executed).toBe(false);
    expect(plan.status).toBe('failed');
    expect(plan.completedAt).toBeDefined();
    expect(status.phase).toBe('failed');
  });

  it('某步因日预算停止 ⇒ 本轮即收尾为失败', async () => {
    disableGoalGate();
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      '预算耗尽',
      ['步骤A'],
      'session-budget'
    );
    o.planId = plan.id;
    plan.steps[0].status = 'completed';
    plan.steps[0].terminationReason = 'daily_budget_exhausted';
    o.executeAllSteps = async () => plan;
    o.autoDecideStep = async (stepId) => {
      const s = plan.steps.find((x) => x.id === stepId);
      if (s) s.decision = 'approved';
      return 'approved';
    };

    const status = await o._runExecuteDecideLoop();

    expect(plan.status).toBe('failed');
    expect(status.phase).toBe('failed');
  });

  it('无可重试步骤且达轮次上限 ⇒ 强制退出为失败', async () => {
    disableGoalGate();
    process.env.TASK_GOAL_MAX_TURNS = '1';
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      '轮次上限-强制',
      ['步骤A'],
      'session-max-forced'
    );
    o.planId = plan.id;
    // 非终态但也不属"可重试"（running）⇒ 命中强制退出分支
    plan.steps[0].status = 'running';
    o.executeAllSteps = async () => plan;

    const status = await o._runExecuteDecideLoop();

    expect(plan.status).toBe('failed');
    expect(status.phase).toBe('failed');
  });

  it('有可重试步骤、轮次自然耗尽 ⇒ 同样收尾为失败', async () => {
    disableGoalGate();
    process.env.TASK_GOAL_MAX_TURNS = '1';
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      '轮次上限-自然',
      ['步骤A'],
      'session-max-natural'
    );
    o.planId = plan.id;
    o.executeAllSteps = async () => plan; // 保持 pending

    const status = await o._runExecuteDecideLoop();

    expect(plan.status).toBe('failed');
    expect(status.phase).toBe('failed');
  });

  it('轮尾 review 只处理 completed 且无 decision 的步骤；全部终态 ⇒ 成功收尾', async () => {
    disableGoalGate();
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      'review 范围',
      ['已完成步骤', '已取消步骤'],
      'session-review-scope'
    );
    o.planId = plan.id;
    const [done, cancelled] = plan.steps;
    done.status = 'completed';
    cancelled.status = 'cancelled';
    o.executeAllSteps = async () => plan;

    const decided: string[] = [];
    o.autoDecideStep = async (stepId) => {
      decided.push(stepId);
      const s = plan.steps.find((x) => x.id === stepId);
      if (s) s.decision = 'approved';
      return 'approved';
    };

    const status = await o._runExecuteDecideLoop();

    expect(decided).toEqual([done.id]);
    expect(plan.status).toBe('completed');
    expect(status.phase).toBe('completed');
  });

  /**
   * G5 端到端（设计 §9）：目标门**未决**（超时/降级）+ 开关开 ⇒
   * 计划保持 `running + acceptance=pending`（不置 completed）、回执为「⏸ 待验收」、
   * 检查点可读回该子态，且 `/resume` 不被终态判据拒绝、可再次进入待验收。
   */
  it('目标门未决 + PDCA_PENDING_ACCEPTANCE=true ⇒ 待验收（端到端）', async () => {
    process.env.PDCA_PENDING_ACCEPTANCE = 'true';
    delete process.env.PDCA_GOAL_EVALUATE; // 目标门开启（默认）
    const receipts: string[] = [];
    setPdcaReceiptSink(({ text }) => receipts.push(text));
    try {
      const o = makeOrchestrator();
      const plan = taskOrchestrator.createPlan(
        '待验收端到端',
        ['步骤A'],
        'session-pending-acceptance'
      );
      o.planId = plan.id;
      // 真实入口（runFullPdca / resume）在进循环前把计划置 running
      plan.status = 'running';
      plan.steps[0].status = 'completed';
      plan.steps[0].decision = 'approved';
      o.executeAllSteps = async () => plan;
      o.goalEvaluateGate = {
        evaluate: async () => ({
          converged: undefined,
          confidence: 0,
          reason: '评估超时',
          evaluated: false,
        }),
      };

      const status = await o._runExecuteDecideLoop();

      expect(status.phase).toBe('decide');
      expect(plan.status).toBe('running');
      expect(plan.acceptance).toBe('pending');
      expect(plan.completedAt).toBeUndefined();

      const taskId = o.getTaskId();
      const ck = await readPdcaCheckpoint(taskId);
      expect(ck?.acceptance).toBe('pending');
      expect(ck?.status).toBe('running');
      expect(ck?.phase).toBe('decide');

      expect(receipts.some((t) => t.includes('待验收'))).toBe(true);
      expect(receipts.some((t) => t.includes('长程任务完成'))).toBe(false);

      // /resume 可续：同检查点恢复不被终态判据拒绝；仍未决 ⇒ 再次待验收
      const resumed = await o.resumeFromCheckpoint(
        ck as Record<string, unknown>
      );
      expect(resumed.phase).toBe('decide');
      const resumedPlan = taskOrchestrator.getPlan(o.planId as string);
      expect(resumedPlan?.status).toBe('running');
      expect(resumedPlan?.acceptance).toBe('pending');
    } finally {
      setPdcaReceiptSink(undefined);
    }
  });

  /**
   * 2026-11-19（真机 `pdca_mwna1g2b`）：「计划保持 running」必须**显式**落实 ——
   * 步骤全落终态时 `TaskOrchestrator._settlePlanFinalStatus` 已把计划置 `completed`，
   * 若不回退，pending 会与 completed 并存（前端"待验收"徽标条件 `running && pending` 永不命中）。
   */
  it('步骤结算已把计划置 completed ⇒ 待验收时回退为 running 并清 completedAt', async () => {
    process.env.PDCA_PENDING_ACCEPTANCE = 'true';
    delete process.env.PDCA_GOAL_EVALUATE;
    const o = makeOrchestrator();
    const plan = taskOrchestrator.createPlan(
      '待验收-已完成残留',
      ['步骤A'],
      'session-pending-from-completed'
    );
    o.planId = plan.id;
    plan.steps[0].status = 'completed';
    plan.steps[0].decision = 'approved';
    // 模拟既有行为：步骤结算后计划已被终态化
    plan.status = 'completed';
    plan.completedAt = new Date().toISOString();
    o.executeAllSteps = async () => plan;
    o.goalEvaluateGate = {
      evaluate: async () => ({
        converged: undefined,
        confidence: 0,
        reason: '评估超时',
        evaluated: false,
      }),
    };

    const status = await o._runExecuteDecideLoop();

    expect(status.phase).toBe('decide');
    expect(plan.acceptance).toBe('pending');
    expect(plan.status).toBe('running');
    expect(plan.completedAt).toBeUndefined();
  });
});
