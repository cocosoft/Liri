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

/**
 * MemoryPressureMonitor 单测（2026-09-02，内存水位触发机制）
 *
 * 覆盖：分级判定（soft1/soft2/hard/滞后）、订阅动作、冷却防抖、升级、恢复、
 * 压力收紧分层窗口、记录反馈计数。测试用 feed() 注入合成样本，不触碰真实内存。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getMemoryPressureMonitor,
  resetMemoryPressureMonitorForTest,
  PRESSURE_LAYER_WINDOW_OVERRIDE,
} from '../MemoryPressureMonitor';

/** 让 monitor 快速学完基线（12 个低样本） */
function learnBaseline(rssMb: number): void {
  const m = getMemoryPressureMonitor();
  for (let i = 0; i < 12; i++) {
    m.feed({ rssMb, heapUsedMb: rssMb * 0.5, heapTotalMb: rssMb * 0.8 });
  }
}

describe('MemoryPressureMonitor', () => {
  beforeEach(() => {
    resetMemoryPressureMonitorForTest();
  });

  afterEach(() => {
    resetMemoryPressureMonitorForTest();
  });

  it('基线学习后：低于 soft1 为正常(level 0)', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    // baseline=1000 → soft1 = max(1000+1000, 2400)=2400
    const snap = m.feed({ rssMb: 2000, heapUsedMb: 500, heapTotalMb: 1000 });
    expect(snap.level).toBe(0);
    expect(m.isUnderPressure()).toBe(false);
  });

  it('越过 soft1 → L0(level 1) 且通知订阅者', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    let notified: number[] = [];
    m.subscribe((lvl) => notified.push(lvl));
    const snap = m.feed({ rssMb: 2500, heapUsedMb: 800, heapTotalMb: 1500 });
    expect(snap.level).toBe(1);
    expect(notified).toEqual([1]);
  });

  it('越过 soft2 → L1(level 2)；冷却期内不重复通知', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    let notified: number[] = [];
    m.subscribe((lvl) => notified.push(lvl));
    m.feed({ rssMb: 3100, heapUsedMb: 900, heapTotalMb: 1600 }); // L1
    expect(notified).toEqual([2]);
    m.feed({ rssMb: 3300, heapUsedMb: 900, heapTotalMb: 1600 }); // 同级别冷却内
    expect(notified).toEqual([2]);
  });

  it('越过 hard → L2(level 3)', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    const snap = m.feed({ rssMb: 4100, heapUsedMb: 1000, heapTotalMb: 2000 });
    expect(snap.level).toBe(3);
  });

  it('事件循环滞后 ≥2s 且 rss 超 soft1 → 视为 L1(level 2)', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    const snap = m.feed(
      { rssMb: 2500, heapUsedMb: 800, heapTotalMb: 1500 },
      2500
    );
    expect(snap.level).toBe(2);
  });

  it('L1 压力下收紧分层窗口（effectiveLayerWindow）', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    // 正常：默认窗口
    expect(m.effectiveLayerWindow(45_000)).toBe(45_000);
    m.feed({ rssMb: 3100, heapUsedMb: 900, heapTotalMb: 1600 }); // L1
    expect(m.effectiveLayerWindow(45_000)).toBe(PRESSURE_LAYER_WINDOW_OVERRIDE);
  });

  it('升级：更高水位触发升一级', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    let notified: number[] = [];
    m.subscribe((lvl) => notified.push(lvl));
    m.feed({ rssMb: 2500, heapUsedMb: 800, heapTotalMb: 1500 }); // L0
    m.feed({ rssMb: 3300, heapUsedMb: 900, heapTotalMb: 1600 }); // L1
    m.feed({ rssMb: 4500, heapUsedMb: 1200, heapTotalMb: 2400 }); // L2
    expect(notified).toEqual([1, 2, 3]);
  });

  it('反向信号仅计数不自动放宽（保底不越有损边界）', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    m.recordReverseSignal('sess-1', 'session_lookup 命中率升高');
    expect(m.getCounters().reverseWindow).toBe(1);
  });

  it('反向放宽：压力 L1+ 下 60s 内连续 2 次反向信号 → 撤销 32K 收紧 60s', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    m.feed({ rssMb: 3100, heapUsedMb: 900, heapTotalMb: 1600 }); // L1(level2)
    // 收紧生效
    expect(m.effectiveLayerWindow(45_000)).toBe(PRESSURE_LAYER_WINDOW_OVERRIDE);
    // 单次信号：仅记录，不放宽
    m.recordReverseSignal('sess-1', '压缩重复');
    expect(m.effectiveLayerWindow(45_000)).toBe(PRESSURE_LAYER_WINDOW_OVERRIDE);
    expect(m.getCounters().relax).toBe(0);
    // 60s 内第二次信号 → 放宽（恢复默认窗口）
    m.recordReverseSignal('sess-1', '压缩重复');
    expect(m.effectiveLayerWindow(45_000)).toBe(45_000);
    expect(m.getCounters().relax).toBe(1);
  });

  it('反向放宽守卫：非压力(L0)下连续信号不放宽', () => {
    learnBaseline(1000);
    const m = getMemoryPressureMonitor();
    m.recordReverseSignal('sess-1', '压缩重复');
    m.recordReverseSignal('sess-1', '压缩重复');
    expect(m.effectiveLayerWindow(45_000)).toBe(45_000); // 本就默认
    expect(m.getCounters().relax).toBe(0);
  });
});
