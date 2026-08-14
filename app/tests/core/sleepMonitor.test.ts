// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  sleepMonitor as monitor,
  SLEEP_EVENTS,
} from '../../src/core/sleep/SleepMonitor';
import { globalEventBus } from '../../src/core/events/EventBus';

/** 模拟可控时钟 */
let fakeNow = 0;
const originalNow = Date.now;

function resetMonitorState(): void {
  const m = monitor as unknown as {
    lastTickTs: number | null;
    paused: boolean;
    info: unknown;
  };
  m.lastTickTs = null;
  m.paused = false;
  m.info = null;
}

beforeEach(() => {
  fakeNow = 1_700_000_000_000;
  Date.now = () => fakeNow;
  resetMonitorState();
});

afterEach(() => {
  Date.now = originalNow;
});

describe('SleepMonitor', () => {
  test('正常 tick 序列返回 normal，不触发暂停', () => {
    expect(monitor.detectTick(1000)).toBe('normal');
    fakeNow += 1000; // 间隔恰好 1s
    expect(monitor.detectTick(1000)).toBe('normal');
    expect(monitor.isPaused()).toBe(false);
  });

  test('休眠滞后超过阈值 → detected，持续 paused，resolve 后恢复 normal', () => {
    expect(monitor.detectTick(1000)).toBe('normal');
    // 模拟休眠 2 小时（阈值 60s）
    fakeNow += 2 * 60 * 60 * 1000;
    expect(monitor.detectTick(1000)).toBe('detected');
    expect(monitor.isPaused()).toBe(true);
    expect(monitor.getInfo()?.lagMs).toBe(2 * 60 * 60 * 1000 - 1000);

    // 暂停期间后续 tick 不再重复检测
    fakeNow += 1000;
    expect(monitor.detectTick(1000)).toBe('paused');

    // 用户决策：继续 → 恢复
    monitor.resolve(true);
    expect(monitor.isPaused()).toBe(false);
    expect(monitor.getInfo()).toBeNull();
    fakeNow += 1000;
    expect(monitor.detectTick(1000)).toBe('normal');
  });

  test('detected 发布事件，resolve 发布 resolved 事件（含 runMissed）', () => {
    const detected: unknown[] = [];
    const resolved: unknown[] = [];
    const sub1 = globalEventBus.subscribe(SLEEP_EVENTS.DETECTED, (d) =>
      detected.push(d)
    );
    const sub2 = globalEventBus.subscribe(SLEEP_EVENTS.RESOLVED, (d) =>
      resolved.push(d)
    );

    monitor.detectTick(1000);
    fakeNow += 3 * 60 * 60 * 1000;
    monitor.detectTick(1000);
    expect(detected).toHaveLength(1);
    expect((detected[0] as { lagMs: number }).lagMs).toBeGreaterThan(0);

    monitor.resolve(false);
    expect(resolved).toHaveLength(1);
    expect((resolved[0] as { runMissed: boolean }).runMissed).toBe(false);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  test('未暂停时 resolve 为空操作（不发布事件）', () => {
    const resolved: unknown[] = [];
    const sub = globalEventBus.subscribe(SLEEP_EVENTS.RESOLVED, (d) =>
      resolved.push(d)
    );
    monitor.resolve(true);
    expect(resolved).toHaveLength(0);
    sub.unsubscribe();
  });

  test('检测一次只广播一次（幂等）', () => {
    const detected: unknown[] = [];
    const sub = globalEventBus.subscribe(SLEEP_EVENTS.DETECTED, (d) =>
      detected.push(d)
    );
    monitor.detectTick(1000);
    fakeNow += 5 * 60 * 60 * 1000;
    monitor.detectTick(1000);
    monitor.detectTick(1000); // paused，不重复广播
    expect(detected).toHaveLength(1);
    sub.unsubscribe();
  });
});
