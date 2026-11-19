// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G5-D1（2026-11-18）：验收子态 `Plan.acceptance` 的写入与往返。
 *
 * 覆盖（设计 `specs/pending-acceptance-state-machine.md` §7-D1）：
 *   ① 目标门四结论映射：`true ⇒ accepted` / `false ⇒ rejected` /
 *      `undefined（超时·降级）⇒ 缺省` / 评估关闭 ⇒ 不调用、不写值；
 *   ② 旧数据缺省不误判：无该字段的计划不因评估结论被"补写"成非 accepted；
 *   ③ 检查点往返：载荷带 `acceptance` 时读回保留，缺省时不写该字段；
 *   ④ 续跑回填：快照带 `acceptance` ⇒ 重建计划保留；缺省 ⇒ 保持 undefined。
 *
 * 说明：`PDCA_PENDING_ACCEPTANCE`（未决 ⇒ pending）属 D3；**2026-11-19 已翻默认开**，
 * 故本文件同时锁定：默认开走 pending、显式 `false` 回退旧口径、既有 `rejected` 不被未决降级。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plan } from '../../src/tasks/TaskOrchestrator';
import type {
  GoalConvergenceDeps,
  GoalConvergenceOutcome,
} from '../../src/tasks/lro/goalConvergence';
import type { GoalEvaluateGate } from '../../src/tasks/review/GoalEvaluateGate';
import type { PdcaStatus } from '../../src/tasks/lro/contracts';

// checkpoint 落 app.db ⇒ 隔离临时库；计划落临时目录（避免污染 ~/.pyapp/data）
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-acceptance-'));
const plansDir = mkdtempSync(join(tmpdir(), 'plans-acceptance-'));
process.env.LIRI_DATA_DIR = dataDir;

const { taskOrchestrator, PLAN_ACCEPTANCE_PENDING } =
  await import('../../src/tasks/TaskOrchestrator');
const { runGoalConvergenceGate } =
  await import('../../src/tasks/lro/goalConvergence');
const { persistPdcaCheckpoint } =
  await import('../../src/tasks/lro/checkpointPersist');
const { resumeFromCheckpoint } =
  await import('../../src/tasks/lro/resumeFromCheckpoint');
const { readPdcaCheckpoint, closePdcaCheckpointStore } =
  await import('../../src/tasks/PdcaWorkItemBridge');
const { isPendingAcceptanceEnabled } =
  await import('../../src/tasks/lro/portResolvers');

taskOrchestrator.setPlansDir(plansDir);

afterAll(() => {
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
    rmSync(plansDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

let seq = 0;
function makePlan(): Plan {
  seq++;
  const plan = taskOrchestrator.createPlan(
    `目标：交付报告 ${seq}`,
    [`写报告 ${seq}`],
    `session-acceptance-${seq}`
  );
  plan.status = 'running';
  for (const step of plan.steps) step.status = 'completed';
  return plan;
}

interface Harness {
  deps: GoalConvergenceDeps;
  gateCalls: () => number;
}

/** 构造目标门依赖（副模型调用以桩替代，不触碰网络/模型） */
function makeHarness(plan: Plan, converged: boolean | undefined): Harness {
  let calls = 0;
  const gate = {
    evaluate: async () => {
      calls++;
      return {
        converged,
        confidence: 0.9,
        reason: '测试结论',
        evaluated: converged !== undefined,
      };
    },
  } as unknown as GoalEvaluateGate;

  const deps = {
    taskId: `task_acceptance_${seq}`,
    planId: plan.id,
    sessionId: `session-acceptance-${seq}`,
    plan,
    gate,
    ctx: {} as never,
    totalTokens: 0,
    turnsExtensions: 0,
    startedAt: 0,
    setGoalEvaluation: () => {},
    // false 分支（未开自动 replan）不会调用；留着只为满足依赖形状
    resumeFromCheckpoint: async () => ({}) as PdcaStatus,
  } as unknown as GoalConvergenceDeps;

  return { deps, gateCalls: () => calls };
}

async function runGate(
  converged: boolean | undefined
): Promise<{ plan: Plan; outcome: GoalConvergenceOutcome; calls: number }> {
  const plan = makePlan();
  const { deps, gateCalls } = makeHarness(plan, converged);
  const outcome = await runGoalConvergenceGate(deps);
  return { plan, outcome, calls: gateCalls() };
}

describe('G5-D1：目标门结论 → Plan.acceptance', () => {
  it('converged === true ⇒ acceptance=accepted，计划保持 running（走原终态路径）', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    const { plan, outcome, calls } = await runGate(true);
    expect(calls).toBe(1);
    expect(outcome.kind).toBe('continue');
    expect(plan.acceptance).toBe('accepted');
    expect(plan.status).toBe('running');
  });

  it('converged === false ⇒ acceptance=rejected，计划落 failed 且不自动 replan', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    const { plan, outcome } = await runGate(false);
    expect(outcome.kind).toBe('unconverged');
    expect(plan.acceptance).toBe('rejected');
    expect(plan.status).toBe('failed');
  });

  // 2026-11-19：开关已翻默认开 ⇒ 本用例锁定**回退口径**（显式 false 才回到旧行为）。
  it('converged === undefined + 显式关开关 ⇒ 不写 acceptance，行为沿用放行', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    process.env.PDCA_PENDING_ACCEPTANCE = 'false';
    try {
      const { plan, outcome } = await runGate(undefined);
      expect(outcome.kind).toBe('continue');
      // 旧数据缺省 = 视作 accepted：不得被误写成 rejected/pending
      expect(plan.acceptance).toBeUndefined();
      expect(plan.status).toBe('running');
    } finally {
      delete process.env.PDCA_PENDING_ACCEPTANCE;
    }
  });

  it('评估关闭（PDCA_GOAL_EVALUATE=false）⇒ 不调用目标门、不写 acceptance', async () => {
    process.env.PDCA_GOAL_EVALUATE = 'false';
    try {
      const { plan, outcome, calls } = await runGate(true);
      expect(calls).toBe(0);
      expect(outcome.kind).toBe('continue');
      expect(plan.acceptance).toBeUndefined();
    } finally {
      delete process.env.PDCA_GOAL_EVALUATE;
    }
  });

  it('旧数据缺省不误判：已有 rejected 不被 undefined 结论覆盖', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    const plan = makePlan();
    plan.acceptance = 'rejected';
    const { deps } = makeHarness(plan, undefined);
    await runGoalConvergenceGate(deps);
    expect(plan.acceptance).toBe('rejected');
  });

  // 2026-11-19（翻默认开）：开关解析口径 —— 未设置/其它值 ⇒ 开；仅显式 `false` 关闭。
  it('isPendingAcceptanceEnabled：默认开，显式 false 才关', () => {
    delete process.env.PDCA_PENDING_ACCEPTANCE;
    expect(isPendingAcceptanceEnabled()).toBe(true);
    try {
      process.env.PDCA_PENDING_ACCEPTANCE = 'false';
      expect(isPendingAcceptanceEnabled()).toBe(false);
      process.env.PDCA_PENDING_ACCEPTANCE = 'true';
      expect(isPendingAcceptanceEnabled()).toBe(true);
    } finally {
      delete process.env.PDCA_PENDING_ACCEPTANCE;
    }
  });

  // 2026-11-19（翻默认开）：**未设置**开关 + 未决 ⇒ 走待验收（不再落到 completed）。
  it('默认开（未设置开关）+ converged === undefined ⇒ pendingAcceptance，计划保持 running', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    delete process.env.PDCA_PENDING_ACCEPTANCE;
    const { plan, outcome } = await runGate(undefined);
    expect(outcome.kind).toBe('pendingAcceptance');
    expect(plan.acceptance).toBe('pending');
    expect(plan.status).toBe('running');
    expect(plan.completedAt).toBeUndefined();
  });

  // G5-D3（2026-11-18）：开关化 —— 未决 ⇒ 待验收（显式开时与默认开同口径）。
  it('开关开 + converged === undefined ⇒ pendingAcceptance，计划保持 running', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    process.env.PDCA_PENDING_ACCEPTANCE = 'true';
    try {
      const { plan, outcome } = await runGate(undefined);
      expect(outcome.kind).toBe('pendingAcceptance');
      expect(plan.acceptance).toBe('pending');
      // 不置 completed、不判失败：留给 /resume 重跑目标门收口
      expect(plan.status).toBe('running');
    } finally {
      delete process.env.PDCA_PENDING_ACCEPTANCE;
    }
  });

  it('开关开 + converged === true ⇒ 仍 accepted 并走原终态（不被未决逻辑影响）', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    process.env.PDCA_PENDING_ACCEPTANCE = 'true';
    try {
      const { plan, outcome } = await runGate(true);
      expect(outcome.kind).toBe('continue');
      expect(plan.acceptance).toBe('accepted');
    } finally {
      delete process.env.PDCA_PENDING_ACCEPTANCE;
    }
  });

  it('开关开但评估关闭 ⇒ 走原路径（不落 pending，避免「永远待验收」）', async () => {
    process.env.PDCA_AUTO_REPLAN = 'false';
    process.env.PDCA_PENDING_ACCEPTANCE = 'true';
    process.env.PDCA_GOAL_EVALUATE = 'false';
    try {
      const { plan, outcome, calls } = await runGate(undefined);
      expect(calls).toBe(0);
      expect(outcome.kind).toBe('continue');
      expect(plan.acceptance).toBeUndefined();
    } finally {
      delete process.env.PDCA_PENDING_ACCEPTANCE;
      delete process.env.PDCA_GOAL_EVALUATE;
    }
  });
});

describe('G5-D1：检查点载荷与续跑回填', () => {
  it('persistPdcaCheckpoint 带 acceptance ⇒ 读回保留；缺省 ⇒ 不写该字段', async () => {
    const withValue = makePlan();
    withValue.acceptance = PLAN_ACCEPTANCE_PENDING;
    const taskIdA = `task_ck_acceptance_${Date.now()}`;
    await persistPdcaCheckpoint({
      taskId: taskIdA,
      phase: 'decide',
      planId: withValue.id,
      sessionId: withValue.sessionId,
      plan: withValue,
      lastEscalations: [],
      blockedCommands: [],
      totalTokens: 0,
      startedAt: 0,
      turnsExtensions: 0,
    });
    const ckA = await readPdcaCheckpoint(taskIdA);
    expect(ckA?.acceptance).toBe('pending');

    const legacy = makePlan();
    const taskIdB = `task_ck_legacy_${Date.now()}`;
    await persistPdcaCheckpoint({
      taskId: taskIdB,
      phase: 'decide',
      planId: legacy.id,
      sessionId: legacy.sessionId,
      plan: legacy,
      lastEscalations: [],
      blockedCommands: [],
      totalTokens: 0,
      startedAt: 0,
      turnsExtensions: 0,
    });
    const ckB = await readPdcaCheckpoint(taskIdB);
    expect(ckB?.acceptance).toBeUndefined();
  });

  it('resume 回填：快照带 acceptance ⇒ 重建计划保留；缺省 ⇒ undefined', async () => {
    const makeResumeDeps = () => {
      const state: { plan?: Plan } = {};
      const deps = {
        taskId: `task_resume_acceptance_${Date.now()}`,
        executePlanPhase: async () => {
          throw new Error('unused');
        },
        runExecuteDecideLoop: async () => 'loop',
        getStatus: () => ({ phase: 'execute' }),
        setPhase: async () => {},
        recordLifecycle: () => {},
        persistCheckpoint: async () => {},
        resolveWorkspaceId: async () => undefined,
        createPlan: (
          description: string,
          steps: string[],
          sessionId: string
        ) => {
          const plan = taskOrchestrator.createPlan(
            description,
            steps,
            sessionId
          );
          state.plan = plan;
          return plan;
        },
        getLastEscalations: () => [],
        setLastEscalations: () => {},
        getTurnsExtensions: () => 0,
        setTurnsExtensions: () => {},
        getStepTurnsMultiplier: () => 1,
        setStepTurnsMultiplier: () => {},
        setPlanId: () => {},
        setSessionId: () => {},
        setTotalTokensTracked: () => {},
        setStartedAt: () => {},
        setBlockedCommands: () => {},
        replayPolicySnapshot: () => {},
      };
      return { deps, restored: (): Plan | undefined => state.plan };
    };

    const baseCk = {
      sessionId: 'session-resume-acceptance',
      phase: 'execute',
      status: 'running',
      description: '恢复的验收任务',
      steps: [{ id: 'step_old_1', description: '写报告', status: 'pending' }],
    };

    const withValue = makeResumeDeps();
    await resumeFromCheckpoint(
      { ...baseCk, acceptance: 'pending' },
      withValue.deps as never
    );
    expect(withValue.restored()?.acceptance).toBe('pending');

    const legacy = makeResumeDeps();
    await resumeFromCheckpoint({ ...baseCk }, legacy.deps as never);
    expect(legacy.restored()?.acceptance).toBeUndefined();
  });
});
