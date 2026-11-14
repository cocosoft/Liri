/**
 * D2+（2026-11-14）：目标**跨会话续接**回归锁。
 *
 * 背景：`goalIdleContinuation` 只在批次结算落到 `blocked` 时登记唤醒 ⇒ 进程在目标
 * `active` 期间被杀时，未达终态的目标再也不会有调度推进它（用户不发消息就永久停住）。
 *
 * 本文件锁四条：
 *   ① `taskId` 编码/解析可往返（`goalId` 含 `:` 也不串味）；
 *   ② 启动扫描只为"有会话归属且未终结"的目标登记，并跳过已有 pending 唤醒；
 *   ③ 单次扫描有上限（不因历史目标堆积而刷屏）；
 *   ④ 触发闸门：终态 / 期间已有推进（`updatedAt` 变化）/ 无会话 ⇒ 返回 null（no-op）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  enqueueStartupGoalResumes,
  parseStartupResumeTaskId,
  resolveStartupGoalResume,
  resetStartupGoalResumesForTest,
  STARTUP_RESUME_DELAY_SEC,
  STARTUP_RESUME_MAX_GOALS,
  STARTUP_RESUME_TASK_PREFIX,
  type StartupGoalSource,
  type StartupResumeScheduler,
} from '@modules/tasks/goal/goalStartupResume';
import type { TaskGoal } from '@modules/tasks/goal/TaskGoalStore';

/** 固定的"当前时刻"（测试注入，避免真实时钟让"新鲜窗口"漂移） */
const NOW = 1_800_000_000_000;

/** 默认算"刚推进过"（落在新鲜窗口内） */
const RECENT = NOW - 60_000;

function goal(partial: Partial<TaskGoal> & { id: string }): TaskGoal {
  return {
    id: partial.id,
    sessionId: partial.sessionId,
    objective: partial.objective ?? `目标 ${partial.id}`,
    status: partial.status ?? 'active',
    tokensUsed: partial.tokensUsed ?? 0,
    noProgressStreak: partial.noProgressStreak ?? 0,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? RECENT,
    ...(partial.updatedReason ? { updatedReason: partial.updatedReason } : {}),
  };
}

/** 记录型调度器（只记录，不做 IO） */
function recorder(pending: Record<string, string[]> = {}): {
  scheduler: StartupResumeScheduler;
  calls: Array<{ sessionId: string; taskId: string; seconds: number }>;
} {
  const calls: Array<{ sessionId: string; taskId: string; seconds: number }> =
    [];
  return {
    calls,
    scheduler: {
      sleepFor: async (sessionId, taskId, seconds) => {
        calls.push({ sessionId, taskId, seconds });
        return { id: taskId };
      },
      getPendingBySession: async (sessionId) =>
        (pending[sessionId] ?? []).map((taskId) => ({
          taskId,
          status: 'pending',
        })),
    },
  };
}

function source(goals: TaskGoal[]): StartupGoalSource {
  return {
    listActive: async () => goals,
    get: async (id) => goals.find((g) => g.id === id) ?? null,
  };
}

beforeEach(() => {
  // 该能力默认关（`FEATURE_GOAL_STARTUP_RESUME=false`）⇒ 用例内显式开启
  process.env['FEATURE_GOAL_STARTUP_RESUME'] = 'true';
  resetStartupGoalResumesForTest();
});

afterEach(() => {
  delete process.env['FEATURE_GOAL_STARTUP_RESUME'];
});

describe('D2+：taskId 编码/解析', () => {
  it('往返一致；goalId 含 ":" 也不串味', () => {
    const parsed = parseStartupResumeTaskId(
      `${STARTUP_RESUME_TASK_PREFIX}goal:a:b:1712345678901`
    );
    expect(parsed).toEqual({ goalId: 'goal:a:b', updatedAt: 1712345678901 });
  });

  it('非法（前缀/时间戳缺失）⇒ null', () => {
    expect(parseStartupResumeTaskId('goal-continue:g1:0')).toBeNull();
    expect(
      parseStartupResumeTaskId(`${STARTUP_RESUME_TASK_PREFIX}g1`)
    ).toBeNull();
    expect(
      parseStartupResumeTaskId(`${STARTUP_RESUME_TASK_PREFIX}g1:abc`)
    ).toBeNull();
    expect(
      parseStartupResumeTaskId(`${STARTUP_RESUME_TASK_PREFIX}g1:0`)
    ).toBeNull();
  });
});

describe('D2+：启动扫描登记', () => {
  it('只登记"有会话归属且未终结"的目标，等待 30s', async () => {
    const { scheduler, calls } = recorder();
    const report = await enqueueStartupGoalResumes({
      scheduler,
      now: NOW,
      store: source([
        goal({ id: 'g-active', sessionId: 's1', status: 'active' }),
        goal({ id: 'g-blocked', sessionId: 's2', status: 'blocked' }),
        goal({ id: 'g-no-session', status: 'active' }),
        // 防御：即使事实源误把终态带进来，也不得登记
        goal({ id: 'g-done', sessionId: 's3', status: 'completed' }),
      ]),
    });

    expect(report.scanned).toBe(3);
    expect(report.enqueued).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.deferred).toBe(0);
    expect(calls.map((c) => c.sessionId)).toEqual(['s1', 's2']);
    expect(calls[0]!.taskId).toBe(
      `${STARTUP_RESUME_TASK_PREFIX}g-active:${RECENT}`
    );
    expect(calls[0]!.seconds).toBe(STARTUP_RESUME_DELAY_SEC);
  });

  it('会话已有该目标的 pending 唤醒（idle 续接 / 上次启动）⇒ 跳过', async () => {
    const { scheduler, calls } = recorder({
      s1: ['goal-continue:g-idle:2'],
      s2: [`${STARTUP_RESUME_TASK_PREFIX}g-startup:999`],
    });
    const report = await enqueueStartupGoalResumes({
      scheduler,
      now: NOW,
      store: source([
        goal({ id: 'g-idle', sessionId: 's1', status: 'blocked' }),
        goal({ id: 'g-startup', sessionId: 's2', status: 'active' }),
        goal({ id: 'g-free', sessionId: 's3', status: 'active' }),
      ]),
    });

    expect(report.enqueued).toBe(1);
    expect(report.skipped).toBe(2);
    expect(calls.map((c) => c.taskId)).toEqual([
      `${STARTUP_RESUME_TASK_PREFIX}g-free:${RECENT}`,
    ]);
  });

  it('只续"新鲜窗口内"的目标，且按最近更新倒序（避免旧目标饿死新目标）', async () => {
    const { scheduler, calls } = recorder();
    const stale = NOW - 48 * 60 * 60 * 1000; // 48h 前 ⇒ 过窗
    const report = await enqueueStartupGoalResumes({
      scheduler,
      now: NOW,
      store: source([
        goal({ id: 'g-old', sessionId: 's-old', updatedAt: stale }),
        goal({ id: 'g-newer', sessionId: 's2', updatedAt: NOW - 1_000 }),
        goal({ id: 'g-newest', sessionId: 's3', updatedAt: NOW - 500 }),
      ]),
    });

    expect(report.scanned).toBe(3);
    expect(report.enqueued).toBe(2);
    expect(report.skipped).toBe(1); // g-old 过窗
    expect(calls.map((c) => c.sessionId)).toEqual(['s3', 's2']);
  });

  it('单次扫描有上限（按最近更新倒序截断，其余 defer）', async () => {
    const { scheduler, calls } = recorder();
    const goals = Array.from({ length: STARTUP_RESUME_MAX_GOALS + 5 }, (_, i) =>
      goal({
        id: `g${i}`,
        sessionId: `s${i}`,
        status: 'active',
        // g0 最新，越往后越旧（但都在新鲜窗口内）
        updatedAt: NOW - 1_000 * (i + 1),
      })
    );
    const report = await enqueueStartupGoalResumes({
      scheduler,
      now: NOW,
      store: source(goals),
    });

    expect(report.enqueued).toBe(STARTUP_RESUME_MAX_GOALS);
    expect(report.deferred).toBe(5);
    expect(calls).toHaveLength(STARTUP_RESUME_MAX_GOALS);
    // 倒序截断：只登记最新的 5 个（g0..g4），不会永卡在最早的目标上
    expect(calls.map((c) => c.sessionId)).toEqual([
      's0',
      's1',
      's2',
      's3',
      's4',
    ]);
  });

  it('同一进程内重复扫描不重复登记；未启用 CG3（scheduler=null）⇒ 零行为', async () => {
    const { scheduler, calls } = recorder();
    const store = source([goal({ id: 'g1', sessionId: 's1' })]);

    await enqueueStartupGoalResumes({ scheduler, now: NOW, store });
    const second = await enqueueStartupGoalResumes({
      scheduler,
      now: NOW,
      store,
    });
    expect(second.enqueued).toBe(0);
    expect(second.skipped).toBe(1);
    expect(calls).toHaveLength(1);

    const disabled = await enqueueStartupGoalResumes({
      scheduler: null,
      now: NOW,
      store,
    });
    expect(disabled).toEqual({
      scanned: 0,
      enqueued: 0,
      skipped: 0,
      deferred: 0,
    });
  });
});

describe('D2+：触发闸门', () => {
  const taskIdFor = (id: string, updatedAt: number): string =>
    `${STARTUP_RESUME_TASK_PREFIX}${id}:${updatedAt}`;

  it('active / blocked 且期间无推进 ⇒ 返回续接触发目标', async () => {
    const store = source([
      goal({ id: 'g1', sessionId: 's1', status: 'active', updatedAt: 500 }),
      goal({
        id: 'g2',
        sessionId: 's2',
        status: 'blocked',
        updatedAt: 600,
        noProgressStreak: 2,
        updatedReason: 'manual',
      }),
    ]);

    expect(
      await resolveStartupGoalResume({ taskId: taskIdFor('g1', 500), store })
    ).toEqual({
      goalId: 'g1',
      sessionId: 's1',
      objective: '目标 g1',
      streak: 0,
    });

    expect(
      await resolveStartupGoalResume({ taskId: taskIdFor('g2', 600), store })
    ).toEqual({
      goalId: 'g2',
      sessionId: 's2',
      objective: '目标 g2',
      streak: 2,
      updatedReason: 'manual',
    });
  });

  it('期间已有推进（updatedAt 变化）⇒ null（陈旧唤醒作废）', async () => {
    const store = source([goal({ id: 'g1', sessionId: 's1', updatedAt: 700 })]);
    expect(
      await resolveStartupGoalResume({ taskId: taskIdFor('g1', 500), store })
    ).toBeNull();
  });

  it('终态 / 无会话归属 / 目标不存在 / 非本前缀 ⇒ null', async () => {
    const store = source([
      goal({ id: 'g-done', sessionId: 's1', status: 'failed', updatedAt: 100 }),
      goal({ id: 'g-orphan', updatedAt: 100 }),
    ]);
    expect(
      await resolveStartupGoalResume({
        taskId: taskIdFor('g-done', 100),
        store,
      })
    ).toBeNull();
    expect(
      await resolveStartupGoalResume({
        taskId: taskIdFor('g-orphan', 100),
        store,
      })
    ).toBeNull();
    expect(
      await resolveStartupGoalResume({
        taskId: taskIdFor('g-missing', 100),
        store,
      })
    ).toBeNull();
    expect(
      await resolveStartupGoalResume({ taskId: 'goal-continue:g1:0', store })
    ).toBeNull();
  });

  it('开关关闭（默认）⇒ 不登记、已登记的也不再续跑（kill switch）', async () => {
    process.env['FEATURE_GOAL_STARTUP_RESUME'] = 'false';
    const { scheduler, calls } = recorder();
    const store = source([goal({ id: 'g1', sessionId: 's1' })]);

    const report = await enqueueStartupGoalResumes({
      scheduler,
      now: NOW,
      store,
    });
    expect(report.enqueued).toBe(0);
    expect(calls).toHaveLength(0);
    expect(
      await resolveStartupGoalResume({
        taskId: `${STARTUP_RESUME_TASK_PREFIX}g1:${RECENT}`,
        store,
      })
    ).toBeNull();
  });
});
