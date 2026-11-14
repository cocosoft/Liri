// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D3：持久 DAG 的重启续跑。
 *
 * 验收（`.trae/specs/planner-resumable-dag.md` §6）：
 * - 只选**被重启打断**的计划（心跳已过期 + 24h 内 + 仍有未终态步骤）；
 * - 复位只作用于心跳过期的 running 步骤（新鲜心跳一律不动）；
 * - 唤醒幂等（每进程每计划一次 / 已有 pending 跳过 / 单次上限）；
 * - 陈旧唤醒作废（心跳已变）；
 * - 指令可复现且只写计划事实；开关关闭 ⇒ 全链路零行为。
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  buildPlanResumeInstruction,
  buildPlanResumeTaskId,
  enqueueStartupPlanResumes,
  isPlanResumable,
  parsePlanResumeTaskId,
  PLAN_RESUME_MAX_PLANS,
  PLAN_STARTUP_RESUME_TASK_PREFIX,
  planHeartbeatMs,
  resetStartupPlanResumesForTest,
  resolveStartupPlanResume,
  selectResumablePlans,
  type PlanResumeScheduler,
  type PlanResumeSource,
} from '../../../src/tasks/plan/planStartupResume';
import type { Plan, PlanStep } from '../../../src/tasks/TaskOrchestrator';

const NOW = Date.parse('2026-11-14T10:00:00.000Z');
const MINUTE = 60_000;

function step(over: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step_1',
    description: '做第一步',
    status: 'completed',
    taskId: 'task_1',
    retryCount: 0,
    maxRetries: 3,
    ...over,
  };
}

/** 计划默认：running、心跳 30 分钟前（已过期且在 24h 内）、有 1 个未完成步骤 */
function plan(over: Partial<Plan> = {}): Plan {
  const heartbeat = new Date(NOW - 30 * MINUTE).toISOString();
  return {
    id: 'plan_a',
    description: '给登录页加深色主题',
    status: 'running',
    createdAt: heartbeat,
    sessionId: 'sess_1',
    lastHeartbeatAt: heartbeat,
    steps: [
      step(),
      step({ id: 'step_2', description: '替换主题变量', status: 'pending' }),
    ],
    ...over,
  };
}

function fakeSource(plans: Plan[]): PlanResumeSource & {
  resetCalls: string[];
} {
  const map = new Map(plans.map((p) => [p.id, p]));
  const resetCalls: string[] = [];
  return {
    resetCalls,
    initialize: async () => {},
    getAllPlans: () => [...map.values()],
    getPlan: (id) => map.get(id),
    resetStaleRunningSteps: (planId) => {
      const target = map.get(planId);
      if (!target) return 0;
      resetCalls.push(planId);
      let n = 0;
      for (const s of target.steps) {
        if (s.status !== 'running') continue;
        s.status = 'pending';
        n += 1;
      }
      return n;
    },
  };
}

function fakeScheduler(): PlanResumeScheduler & {
  calls: Array<{ sessionId: string; taskId: string; seconds: number }>;
} {
  const calls: Array<{
    sessionId: string;
    taskId: string;
    seconds: number;
  }> = [];
  return {
    calls,
    sleepFor: async (sessionId, taskId, seconds) => {
      calls.push({ sessionId, taskId, seconds });
      return { ok: true };
    },
    getPendingBySession: async () => [],
  };
}

const prevFlag = process.env['FEATURE_PLAN_STARTUP_RESUME'];

// 该能力默认关 ⇒ 用例内显式开启（与 D2+ 同一手法）
beforeEach(() => {
  process.env['FEATURE_PLAN_STARTUP_RESUME'] = 'true';
  resetStartupPlanResumesForTest();
});

afterAll(() => {
  if (prevFlag === undefined) delete process.env['FEATURE_PLAN_STARTUP_RESUME'];
  else process.env['FEATURE_PLAN_STARTUP_RESUME'] = prevFlag;
});

describe('isPlanResumable / selectResumablePlans', () => {
  it('running + 心跳过期 + 24h 内 + 有未终态步骤 ⇒ 可续跑', () => {
    expect(isPlanResumable(plan(), NOW)).toBe(true);
  });

  it('心跳新鲜（可能正在跑）⇒ 不选', () => {
    const fresh = plan({
      lastHeartbeatAt: new Date(NOW - 1 * MINUTE).toISOString(),
    });
    expect(isPlanResumable(fresh, NOW)).toBe(false);
  });

  it('超出 24h 新鲜窗口（已放弃）⇒ 不选', () => {
    const old = plan({
      lastHeartbeatAt: new Date(NOW - 30 * 60 * MINUTE).toISOString(),
    });
    expect(isPlanResumable(old, NOW)).toBe(false);
  });

  it('非 running / 无会话归属 / 步骤全终态 ⇒ 不选', () => {
    expect(isPlanResumable(plan({ status: 'completed' }), NOW)).toBe(false);
    expect(isPlanResumable(plan({ sessionId: '' }), NOW)).toBe(false);
    expect(
      isPlanResumable(plan({ steps: [step(), step({ id: 'step_2' })] }), NOW)
    ).toBe(false);
  });

  it('按心跳倒序并按上限截断', () => {
    const plans = [1, 2, 3].map((i) =>
      plan({
        id: `plan_${i}`,
        lastHeartbeatAt: new Date(NOW - i * 30 * MINUTE).toISOString(),
      })
    );
    const picked = selectResumablePlans(plans, { now: NOW });
    expect(picked.map((p) => p.id)).toEqual(['plan_1', 'plan_2', 'plan_3']);

    const limited = selectResumablePlans(plans, { now: NOW, maxPlans: 2 });
    expect(limited).toHaveLength(2);
    expect(PLAN_RESUME_MAX_PLANS).toBe(5);
  });
});

describe('taskId 编解码', () => {
  it('往返一致（planId 可含冒号）', () => {
    const taskId = buildPlanResumeTaskId('plan:a:b', 123456);
    expect(taskId.startsWith(PLAN_STARTUP_RESUME_TASK_PREFIX)).toBe(true);
    expect(parsePlanResumeTaskId(taskId)).toEqual({
      planId: 'plan:a:b',
      heartbeatMs: 123456,
    });
  });

  it('非本前缀 / 缺心跳 / 心跳非正 ⇒ null', () => {
    expect(parsePlanResumeTaskId('goal-startup:g:1')).toBeNull();
    expect(parsePlanResumeTaskId('plan-startup:plan_a')).toBeNull();
    expect(parsePlanResumeTaskId('plan-startup:plan_a:0')).toBeNull();
  });
});

describe('buildPlanResumeInstruction：只写计划事实且可复现', () => {
  it('同一计划 ⇒ 逐字相同；含进度 / 剩余步骤 / 依赖 / 禁止新建', () => {
    const p = plan({
      steps: [
        step(),
        step({
          id: 'step_2',
          description: '替换主题变量',
          status: 'running',
          dependsOn: ['step_1'],
        }),
        step({ id: 'step_3', description: '回归测试', status: 'pending' }),
      ],
    });
    const text = buildPlanResumeInstruction(p);
    expect(text).toBe(buildPlanResumeInstruction(p));
    expect(text).toContain('不要新建计划');
    expect(text).toContain('planId：plan_a');
    expect(text).toContain('进度：1/3 步已完成');
    expect(text).toContain('1. 替换主题变量（依赖：步骤 1）');
    expect(text).toContain('2. 回归测试');
    // 已完成步骤不再列入"未完成步骤"
    expect(text).not.toContain('1. 做第一步');
  });
});

describe('enqueueStartupPlanResumes：登记幂等 + 上限', () => {
  it('开关关闭 ⇒ 零行为（不扫描、不登记）', async () => {
    process.env['FEATURE_PLAN_STARTUP_RESUME'] = 'false';
    const scheduler = fakeScheduler();
    const report = await enqueueStartupPlanResumes({
      scheduler,
      source: fakeSource([plan()]),
      now: NOW,
    });
    expect(report).toEqual({
      scanned: 0,
      enqueued: 0,
      skipped: 0,
      deferred: 0,
    });
    expect(scheduler.calls).toHaveLength(0);
  });

  it('开启后登记一次；重复扫描不重复登记', async () => {
    const scheduler = fakeScheduler();
    const source = fakeSource([plan()]);
    const first = await enqueueStartupPlanResumes({
      scheduler,
      source,
      now: NOW,
    });
    expect(first).toMatchObject({ scanned: 1, enqueued: 1, skipped: 0 });
    expect(scheduler.calls).toHaveLength(1);
    expect(scheduler.calls[0].taskId).toBe(
      buildPlanResumeTaskId('plan_a', planHeartbeatMs(plan()))
    );
    expect(scheduler.calls[0].seconds).toBeGreaterThan(0);

    const second = await enqueueStartupPlanResumes({
      scheduler,
      source,
      now: NOW,
    });
    expect(second.enqueued).toBe(0);
    expect(scheduler.calls).toHaveLength(1);
  });

  it('已有同计划 pending 唤醒 ⇒ 跳过', async () => {
    const scheduler = fakeScheduler();
    scheduler.getPendingBySession = async () => [
      { taskId: buildPlanResumeTaskId('plan_a', 1), status: 'pending' },
    ];
    const report = await enqueueStartupPlanResumes({
      scheduler,
      source: fakeSource([plan()]),
      now: NOW,
    });
    expect(report.enqueued).toBe(0);
    expect(scheduler.calls).toHaveLength(0);
  });
});

describe('resolveStartupPlanResume：二次校验', () => {
  it('仍可续 ⇒ 返回目标并复位崩溃残留的 running 步骤', async () => {
    const source = fakeSource([
      plan({
        steps: [
          step({ status: 'running' }),
          step({
            id: 'step_2',
            description: '替换主题变量',
            status: 'pending',
          }),
        ],
      }),
    ]);
    const taskId = buildPlanResumeTaskId('plan_a', planHeartbeatMs(plan()));
    const target = await resolveStartupPlanResume({
      taskId,
      source,
      now: NOW,
    });
    expect(target?.planId).toBe('plan_a');
    expect(target?.sessionId).toBe('sess_1');
    expect(target?.resetSteps).toBe(1);
    expect(source.resetCalls).toEqual(['plan_a']);
  });

  it('期间已推进（心跳变化）⇒ 陈旧唤醒作废', async () => {
    const source = fakeSource([plan()]);
    const staleTaskId = buildPlanResumeTaskId(
      'plan_a',
      planHeartbeatMs(plan()) - 1
    );
    expect(
      await resolveStartupPlanResume({ taskId: staleTaskId, source, now: NOW })
    ).toBeNull();
  });

  it('计划已不存在 / 已不可续 ⇒ null', async () => {
    const source = fakeSource([plan({ status: 'completed' })]);
    const taskId = buildPlanResumeTaskId('plan_a', planHeartbeatMs(plan()));
    expect(
      await resolveStartupPlanResume({ taskId, source, now: NOW })
    ).toBeNull();
    expect(
      await resolveStartupPlanResume({
        taskId: buildPlanResumeTaskId('plan_missing', 1),
        source,
        now: NOW,
      })
    ).toBeNull();
  });

  it('开关关闭 ⇒ 即使历史唤醒也不再续跑（kill switch）', async () => {
    process.env['FEATURE_PLAN_STARTUP_RESUME'] = 'false';
    const source = fakeSource([plan()]);
    const taskId = buildPlanResumeTaskId('plan_a', planHeartbeatMs(plan()));
    expect(
      await resolveStartupPlanResume({ taskId, source, now: NOW })
    ).toBeNull();
  });
});
