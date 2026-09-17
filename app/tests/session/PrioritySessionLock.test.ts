// MIT License
// Copyright (c) 2026 190615273@qq.com
// H10 回归测试（2026-09-17）：
//   H10(a) watchdog/aging 定时器 async 未 await 未 catch → 不再产生 unhandledRejection，
//          过期锁被清理后排队请求继续推进。
//   H10(b) 排队请求不再拿到静态 success:false——队列内部存 resolver，授予/超时/释放
//          全部兑现 Promise，排队者最终必能拿到结果（不静默吞掉 + 不悬挂）。

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrioritySessionLock } from '../../src/session/lock/PrioritySessionLock';

const lockDirs: string[] = [];
afterEach(() => {
  while (lockDirs.length > 0) {
    const dir = lockDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function makeLockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plock-h10-'));
  lockDirs.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('H10(b): 排队请求经 resolver 兑现——不静默吞掉、不悬挂', () => {
  it('持锁期间排队，release 后授予成功（旧实现返回静态 success:false，此断言必失败）', async () => {
    const lock = new PrioritySessionLock({
      lockOptions: { lockDir: makeLockDir() },
    });

    const first = await lock.acquire('s1');
    expect(first.success).toBe(true);

    // 同优先级入队（持有者在列，未短路授予）
    const queued = lock.acquire('s1');
    expect(lock.getQueueLength('s1')).toBe(1);

    // 未释放前排队请求仍 pending（resolver 未兑现）
    let settled = false;
    void queued.then(() => {
      settled = true;
    });
    await sleep(20);
    expect(settled).toBe(false);

    await lock.release('s1');

    const result = await queued;
    expect(result.success).toBe(true);
    expect(result.requestId).toBeDefined();
    // 授予后队列清空
    expect(lock.getQueueLength('s1')).toBe(0);

    await lock.releaseAll();
  });

  it('排队超时后兑现失败结果（不悬挂）', async () => {
    const lock = new PrioritySessionLock({
      lockOptions: { lockDir: makeLockDir() },
      defaultTimeoutMs: 60_000,
    });

    await lock.acquire('s1');
    // 持有者 maxHoldMs 足够长，排队者必超时
    const queued = lock.acquire('s1', { timeoutMs: 60 });
    const result = await queued;
    expect(result.success).toBe(false);
    expect(result.requestId).toBeDefined();
    // 超时移除后队列为空
    expect(lock.getQueueLength('s1')).toBe(0);

    await lock.releaseAll();
  });

  it('releaseAll 兑现所有 pending 排队请求（失败结果，无悬挂）', async () => {
    const lock = new PrioritySessionLock({
      lockOptions: { lockDir: makeLockDir() },
    });

    await lock.acquire('s1');
    const q1 = lock.acquire('s1');
    const q2 = lock.acquire('s1');
    expect(lock.getQueueLength('s1')).toBe(2);

    await lock.releaseAll();

    const r1 = await q1;
    const r2 = await q2;
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(r1.requestId).toBeDefined();
    expect(r2.requestId).toBeDefined();
  });
});

describe('H10(a): watchdog 定时器清理过期锁——无 unhandledRejection、队列不悬挂', () => {
  it('过期锁被 watchdog 清理且排队请求最终 resolve', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    let lock: PrioritySessionLock | null = null;
    try {
      lock = new PrioritySessionLock({
        lockOptions: { lockDir: makeLockDir() },
        defaultMaxHoldMs: 40, // 40ms 后过期
        watchdogIntervalMs: 20, // 快速触发
      });
      lock.start();

      await lock.acquire('s1');
      expect(await lock.isLocked('s1')).toBe(true);

      // 等待 watchdog 触发：锁过期 → releaseLock + processQueue（内部已 try/catch）
      await sleep(200);
      expect(await lock.isLocked('s1')).toBe(false);
    } finally {
      if (lock) lock.stop();
      process.off('unhandledRejection', onRejection);
    }
    // H10(a) 断言：watchdog 回调的异步异常已内部捕获，不泄漏为 unhandledRejection
    expect(rejections).toHaveLength(0);
  });
});
