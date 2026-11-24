// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * 批次 2 / A3（2026-11-24）：自唤醒状态机补全的回归用例。
 *
 * 修复前的问题：
 * - `wake_on_job` / `wake_on_event` 无 `expiresAt` ⇒ 触发源缺失时**永不 due**，永久 pending；
 * - `fire()` **先 `markFired` 再续跑** ⇒ 续跑失败也记为已唤醒（唤醒被静默吞掉，无重试）；
 * - 无并发保护 ⇒ cron tick 重扫与短时 timer 可能双续跑；
 * - 崩溃残留的中间态（`firing`）无人复位。
 *
 * 本文件锁定：TTL 过期、失败重试与耗尽转 `failed`、并发 CAS、启动期 `firing` 复位。
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// 隔离数据目录（与既有 selfwake 测试同法：env 必须在模块导入前生效）
const testDataDir = join(tmpdir(), `cg3-selfwake-lifecycle-${randomUUID()}.d`);
const prevDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_DATA_DIR = testDataDir;

const { WakeStore } = await import('../../../src/tasks/selfwake/WakeStore');
const { SelfWakeService, setSelfWakeResumeHandler } =
  await import('../../../src/tasks/selfwake/SelfWakeService');
const { WAKE_EXTERNAL_TTL_MS } =
  await import('../../../src/tasks/selfwake/defaults');
const { WakeKind } = await import('../../../src/tasks/selfwake/types');
import type { WakeEntry } from '../../../src/tasks/selfwake/types';

/** 长 tick 间隔 ⇒ `sleepFor` 走长时分支，不创建真实 setTimeout */
const LONG_TICK = 1000;
const HOUR = 3600_000;

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
});

describe('自唤醒状态机（批次 2 / A3）', () => {
  beforeEach(() => {
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
    setSelfWakeResumeHandler(null);
  });

  afterEach(() => {
    setSelfWakeResumeHandler(null);
    try {
      if (existsSync(testDataDir))
        rmSync(testDataDir, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 清理临时目录失败不影响断言
    }
  });

  it('wakeOnJob / wakeOnEvent 写入 24h 的 expiresAt（触发源缺失也能收敛）', async () => {
    const svc = new SelfWakeService(new WakeStore(), LONG_TICK);
    const before = Date.now();

    const job = await svc.wakeOnJob('sess-ttl', 'task-1', 'job-1');
    const event = await svc.wakeOnEvent('sess-ttl', 'task-1', 'file_changed');

    for (const entry of [job, event]) {
      expect(entry.expiresAt).toBeGreaterThanOrEqual(
        before + WAKE_EXTERNAL_TTL_MS
      );
      expect(entry.expiresAt).toBeLessThanOrEqual(
        Date.now() + WAKE_EXTERNAL_TTL_MS
      );
    }
  });

  it('过期扫描：expiresAt 已过 ⇒ 转 expired，且不再出现在待触发投影里', async () => {
    const store = new WakeStore();
    const svc = new SelfWakeService(store, LONG_TICK);
    const sid = 'sess-expire';
    const now = Date.now();
    const expiredEntry: WakeEntry = {
      id: 'expired-completion',
      kind: WakeKind.COMPLETION,
      status: 'pending',
      sessionId: sid,
      taskId: 'job-wait',
      jobId: 'job-1',
      createdAt: now - 25 * HOUR,
      expiresAt: now - HOUR,
    };
    const liveEntry: WakeEntry = {
      id: 'live-completion',
      kind: WakeKind.EVENT,
      status: 'pending',
      sessionId: sid,
      taskId: 'event-wait',
      eventKey: 'file_changed',
      createdAt: now,
      expiresAt: now + HOUR,
    };
    await store.save(sid, [expiredEntry, liveEntry]);

    // getDueWakes 是 tick 入口：扫描前先收口过期（completion 没有 triggerAt，永不 due）
    await svc.getDueWakes();

    const after = await store.load(sid);
    expect(after.find((e) => e.id === 'expired-completion')?.status).toBe(
      'expired'
    );
    expect(after.find((e) => e.id === 'live-completion')?.status).toBe(
      'pending'
    );

    const pending = await svc.getPendingBySession(sid);
    expect(pending.map((e) => e.id)).toEqual(['live-completion']);
  });

  it('续跑失败 3 次 ⇒ 转 failed（不再无限重试），第 4 次 fire 不再调用执行器', async () => {
    const store = new WakeStore();
    const svc = new SelfWakeService(store, LONG_TICK);
    const sid = 'sess-retry';
    const now = Date.now();
    await store.save(sid, [
      {
        id: 'retry-wake',
        kind: WakeKind.TIMER,
        status: 'pending',
        sessionId: sid,
        taskId: 't1',
        createdAt: now,
        triggerAt: now - 1000,
      },
    ]);

    let calls = 0;
    setSelfWakeResumeHandler(async () => {
      calls += 1;
      return { ok: false, error: 'still broken' };
    });

    for (let i = 0; i < 3; i += 1) await svc.fire('retry-wake');

    let saved = (await store.load(sid)).find((e) => e.id === 'retry-wake');
    expect(calls).toBe(3);
    expect(saved?.status).toBe('failed');
    expect(saved?.attempts).toBe(3);
    expect(saved?.lastError).toBe('still broken');

    // 终态不再重试（幂等短路，不重复调用执行器）
    await svc.fire('retry-wake');
    expect(calls).toBe(3);
    saved = (await store.load(sid)).find((e) => e.id === 'retry-wake');
    expect(saved?.attempts).toBe(3);
  });

  it('并发 fire ⇒ CAS 只放行一方续跑（tick 重扫 + 短时 timer 不双跑）', async () => {
    const store = new WakeStore();
    const svc = new SelfWakeService(store, LONG_TICK);
    const sid = 'sess-cas';
    const now = Date.now();
    await store.save(sid, [
      {
        id: 'cas-wake',
        kind: WakeKind.TIMER,
        status: 'pending',
        sessionId: sid,
        taskId: 't1',
        createdAt: now,
        triggerAt: now - 1000,
      },
    ]);

    let calls = 0;
    setSelfWakeResumeHandler(async () => {
      calls += 1;
      // 让第一次 fire 停在执行器里，确保第二次 fire 落在它之后
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true };
    });

    await Promise.all([svc.fire('cas-wake'), svc.fire('cas-wake')]);

    expect(calls).toBe(1);
    const saved = (await store.load(sid)).find((e) => e.id === 'cas-wake');
    expect(saved?.status).toBe('fired');
  });

  it('启动期复位：崩溃残留的 firing 回到 pending 并可被补触发', async () => {
    const store = new WakeStore();
    const svc = new SelfWakeService(store, LONG_TICK);
    const sid = 'sess-firing';
    const now = Date.now();
    await store.save(sid, [
      {
        id: 'stuck-firing',
        kind: WakeKind.TIMER,
        status: 'firing',
        sessionId: sid,
        taskId: 't1',
        createdAt: now - HOUR,
        triggerAt: now - 1000,
        firingAt: now - 30 * 60_000,
      },
    ]);

    const resumed: string[] = [];
    setSelfWakeResumeHandler(async (p) => {
      resumed.push(p.wakeId);
      return { ok: true };
    });

    const recovered = await svc.recoverOverdueWakes(now);

    expect(recovered).toBe(1);
    expect(resumed).toEqual(['stuck-firing']);
    const saved = (await store.load(sid)).find((e) => e.id === 'stuck-firing');
    expect(saved?.status).toBe('fired');
  });
});
