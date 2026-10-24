/**
 * SafeInterval / TimerLifecycleRegistry 单测
 *
 * 覆盖定时器生命周期专项的三条不变量：
 * - 句柄受管：重复 start 不叠加，stop 后可重启；
 * - 注册表受管：启动即登记、停止即注销、stopAll 能一次回收；
 * - 非法间隔不启动（避免 0/NaN 退化为忙循环）。
 */

import { describe, expect, test } from 'bun:test';
import {
  SafeInterval,
  timerLifecycleRegistry,
} from '@modules/utils/SafeInterval';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SafeInterval', () => {
  test('重复 start 不叠加定时器', async () => {
    let ticks = 0;
    const timer = new SafeInterval({
      name: 'test:no-stack',
      run: () => {
        ticks++;
      },
    });

    const before = timerLifecycleRegistry.size;
    timer.start(10);
    timer.start(10);
    timer.start(10);

    // **不变量用注册表判**（确定性）：三次 start 只能有 1 个受管定时器。
    // 原实现靠「35ms 内 tick 数 ≥ 2」间接推断 —— 该断言在慢 runner（macOS 3 vCPU）
    // 上会因事件循环被其他并行用例占住而只跑到 1 次（CI 实证 `Expected: >= 2`）。
    expect(timerLifecycleRegistry.size).toBe(before + 1);
    expect(timer.isRunning).toBe(true);

    await sleep(120);
    timer.stop();
    expect(timerLifecycleRegistry.size).toBe(before);

    // 叠加三次会得到 ~3 倍 tick；允许调度抖动，只断言量级
    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(ticks).toBeLessThanOrEqual(12);
  });

  test('stop 后不再触发，且可再次 start', async () => {
    let ticks = 0;
    const timer = new SafeInterval({
      name: 'test:restart',
      run: () => {
        ticks++;
      },
    });

    timer.start(10);
    await sleep(120);
    timer.stop();
    const afterStop = ticks;
    await sleep(30);
    expect(ticks).toBe(afterStop);
    expect(timer.isRunning).toBe(false);

    timer.start(10);
    await sleep(120);
    timer.stop();
    expect(ticks).toBeGreaterThan(afterStop);
  });

  test('非法间隔不启动', () => {
    const timer = new SafeInterval({
      name: 'test:invalid',
      run: () => {},
    });

    timer.start(0);
    expect(timer.isRunning).toBe(false);
    timer.start(Number.NaN);
    expect(timer.isRunning).toBe(false);
    timer.start(-1);
    expect(timer.isRunning).toBe(false);
  });

  test('周期任务抛错不影响后续 tick', async () => {
    let attempts = 0;
    const errors: unknown[] = [];
    const timer = new SafeInterval({
      name: 'test:error',
      run: () => {
        attempts++;
        throw new Error('boom');
      },
      onError: (e) => errors.push(e),
    });

    timer.start(10);
    await sleep(120);
    timer.stop();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBe(attempts);
  });

  test('unref:false 时仍可正常运行与停止', async () => {
    let ticks = 0;
    const timer = new SafeInterval({
      name: 'test:ref',
      unref: false,
      run: () => {
        ticks++;
      },
    });

    timer.start(10);
    await sleep(120);
    timer.stop();

    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(timer.isRunning).toBe(false);
  });
});

describe('TimerLifecycleRegistry', () => {
  test('启动登记、停止注销', () => {
    const timer = new SafeInterval({
      name: 'test:registry',
      run: () => {},
    });

    const before = timerLifecycleRegistry.size;
    timer.start(1000);
    expect(timerLifecycleRegistry.size).toBe(before + 1);
    timer.stop();
    expect(timerLifecycleRegistry.size).toBe(before);
  });

  test('stopAll 一次回收全部受管定时器', async () => {
    const a = new SafeInterval({ name: 'test:all:a', run: () => {} });
    const b = new SafeInterval({ name: 'test:all:b', run: () => {} });
    a.start(1000);
    b.start(1000);

    const stopped = timerLifecycleRegistry.stopAll();
    expect(stopped).toBeGreaterThanOrEqual(2);
    expect(a.isRunning).toBe(false);
    expect(b.isRunning).toBe(false);
    expect(timerLifecycleRegistry.size).toBe(0);
  });
});
