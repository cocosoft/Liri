// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * **自唤醒「启动期恢复」回归**（2026-11-19 真机根因）。
 *
 * 现象：任务早已完成，界面却长期显示「⏳ 等待中」。根因是一条**过期但仍是 `pending`** 的
 * `timer` 自唤醒条目：
 *   - 前端 `deriveWaitState` 只看 `GET /v1/sessions/{id}/streaming.pendingWake`；
 *   - `sleepFor(< tickInterval)` 只在**进程内**建 `setTimeout`，进程重启（含 `bun --watch`
 *     热重载）后 timer 丢失，条目永远停在 `pending`；
 *   - 兜底扫描（`CronScheduler.extraTick → getDueWakes → fire`）的接线只做一次，且发生在
 *     cron 启动**之前**（`startCg3` 在初始化管线） ⇒ 接线失败且无重试 ⇒ 永不被 `fire()`。
 *
 * 本组锁住三条修复：
 *   R1 `recoverOverdueWakes()`：过期 `timer` 补触发（落 `fired` + 续跑一次）；
 *      未来条目 / `completion` 等外部条件条目**不受影响**；
 *   R2 `collectGarbage()`：`fired` 超 24h 的条目被清理，`pending` 保留；
 *   R3 晚接线（cron 后起）：`ensureGlobalCronSchedulerStarted` 成功后会补接 `extraTick`，
 *      且重复接线幂等。
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
// 仅类型位（编译期擦除，不触发模块求值 ⇒ 不破坏下面的 env 前置）
import type { WakeEntry } from '../../../src/tasks/selfwake/types';

// 隔离数据目录，避免污染真实数据（bun 全量测试同进程 ⇒ 必须还原原值）
const testDataDir = join(tmpdir(), `cg3-selfwake-startup-${randomUUID()}.d`);
const prevDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_DATA_DIR = testDataDir;

const { WakeStore } = await import('../../../src/tasks/selfwake/WakeStore');
const { SelfWakeService, setSelfWakeResumeHandler } =
  await import('../../../src/tasks/selfwake/SelfWakeService');
const { createCg3Services, wireSelfWakeToCron } =
  await import('../../../src/tasks/Cg3Bootstrap');
const { applySelfWakeCronWire } =
  await import('../../../src/tasks/selfwake/cronBridge');
const {
  ensureGlobalCronSchedulerStarted,
  getGlobalCronScheduler,
  stopGlobalCronScheduler,
} = await import('../../../src/tasks/cron/GlobalCronScheduler');

/** 长 tick 间隔 ⇒ 不创建真实 setTimeout（测试只关心磁盘状态） */
const LONG_TICK = 3_600_000;
const HOUR = 3_600_000;

function seed(
  store: InstanceType<typeof WakeStore>,
  sessionId: string,
  entries: WakeEntry[]
): Promise<void> {
  return store.save(sessionId, entries);
}

/** 轮询等待异步落定（`fire()` 内部 await 执行器） */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('自唤醒启动期恢复（B/C）', () => {
  beforeEach(() => {
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
    setSelfWakeResumeHandler(null);
  });

  afterEach(() => {
    setSelfWakeResumeHandler(null);
  });

  it('R1 recoverOverdueWakes：只补触发过期的 timer，未来条目与 completion 不动', async () => {
    const store = new WakeStore();
    const svc = new SelfWakeService(store, LONG_TICK);
    const now = Date.now();
    const sid = `sess-recover-${randomUUID()}`;
    await seed(store, sid, [
      {
        id: 'overdue-timer',
        kind: 'timer',
        status: 'pending',
        sessionId: sid,
        taskId: 'goal-startup:g1',
        createdAt: now - HOUR,
        triggerAt: now - 1000,
      },
      {
        id: 'future-timer',
        kind: 'timer',
        status: 'pending',
        sessionId: sid,
        taskId: 'goal-startup:g2',
        createdAt: now,
        triggerAt: now + HOUR,
      },
      {
        id: 'pending-completion',
        kind: 'completion',
        status: 'pending',
        sessionId: sid,
        taskId: 'job-wait',
        jobId: 'job-1',
        createdAt: now,
      },
    ]);

    const resumed: string[] = [];
    setSelfWakeResumeHandler(async (p) => {
      resumed.push(p.wakeId);
      return { ok: true };
    });

    const recovered = await svc.recoverOverdueWakes(now);
    expect(recovered).toBe(1);
    expect(resumed).toEqual(['overdue-timer']);

    const after = await store.load(sid);
    const byId = new Map(after.map((e) => [e.id, e]));
    expect(byId.get('overdue-timer')?.status).toBe('fired');
    expect(byId.get('future-timer')?.status).toBe('pending');
    expect(byId.get('pending-completion')?.status).toBe('pending');
  });

  it('R2 collectGarbage：清掉 24h 前的 fired，保留 pending 与近期 fired', async () => {
    const store = new WakeStore();
    const svc = new SelfWakeService(store, LONG_TICK);
    const now = Date.now();
    const sid = `sess-gc-${randomUUID()}`;
    await seed(store, sid, [
      {
        id: 'old-fired',
        kind: 'timer',
        status: 'fired',
        sessionId: sid,
        taskId: 't1',
        createdAt: now - 30 * HOUR,
        triggerAt: now - 30 * HOUR,
        firedAt: now - 25 * HOUR,
      },
      {
        id: 'recent-fired',
        kind: 'timer',
        status: 'fired',
        sessionId: sid,
        taskId: 't2',
        createdAt: now - HOUR,
        triggerAt: now - HOUR,
        firedAt: now - 1000,
      },
      {
        id: 'still-pending',
        kind: 'timer',
        status: 'pending',
        sessionId: sid,
        taskId: 't3',
        createdAt: now,
        triggerAt: now + HOUR,
      },
    ]);

    const cleaned = await svc.collectGarbage();
    expect(cleaned).toBe(1);

    const ids = (await store.load(sid)).map((e) => e.id);
    expect(ids).not.toContain('old-fired');
    expect(ids).toContain('recent-fired');
    expect(ids).toContain('still-pending');
  });
});

describe('自唤醒晚接线（A）：cron 后起也能接上 extraTick', () => {
  afterAll(async () => {
    await stopGlobalCronScheduler();
  });

  it('CG3 先起、cron 后起 ⇒ 启动 cron 时补接；重复接线幂等', async () => {
    // 干净起点（同进程内其它用例可能已启动过调度器）
    await stopGlobalCronScheduler();
    expect(getGlobalCronScheduler()).toBeNull();

    // ① cron 未起 ⇒ 接线如实失败，不伪造成功
    const { selfWakeService } = createCg3Services();
    expect(await applySelfWakeCronWire()).toBe(false);
    expect(await wireSelfWakeToCron(selfWakeService)).toBe(false);

    // ② cron 起来 ⇒ 启动路径内补接（A 的落点）
    await ensureGlobalCronSchedulerStarted({});
    const scheduler = getGlobalCronScheduler();
    expect(scheduler).not.toBeNull();
    expect(typeof scheduler?.extraTick).toBe('function');

    // ③ 幂等：再调一次不叠加第二条链
    const before = scheduler?.extraTick;
    expect(await applySelfWakeCronWire()).toBe(true);
    expect(scheduler?.extraTick).toBe(before as () => void);

    // ④ 真跑一次：过期条目被 extraTick 扫到并落 fired
    const store = new WakeStore();
    const sid = `sess-late-wire-${randomUUID()}`;
    const now = Date.now();
    await seed(store, sid, [
      {
        id: 'overdue-via-tick',
        kind: 'timer',
        status: 'pending',
        sessionId: sid,
        taskId: 'goal-startup:g3',
        createdAt: now - HOUR,
        triggerAt: now - 1000,
      },
    ]);
    const resumed: string[] = [];
    setSelfWakeResumeHandler(async (p) => {
      resumed.push(p.wakeId);
      return { ok: true };
    });

    scheduler?.extraTick?.();
    await waitFor(async () => {
      const entries = await store.load(sid);
      return entries.some(
        (e) => e.id === 'overdue-via-tick' && e.status === 'fired'
      );
    });
    expect(resumed).toContain('overdue-via-tick');
  });
});

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  try {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});
