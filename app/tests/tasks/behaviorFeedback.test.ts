// MIT License
// Copyright (c) 2026 190615273@qq.com
// 行为反馈回流用例（13-P2-2，2026-10-05）：滚动账本 + 升级判据

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_ESCALATE_FAILURE_RATE,
  DEFAULT_ESCALATE_MIN_SAMPLES,
  TaskOutcomeLedger,
  getTaskOutcomeLedger,
  resetTaskOutcomeLedgerForTest,
  shouldEscalateGranularity,
} from '../../src/tasks/behaviorFeedback';

describe('TaskOutcomeLedger：滚动窗口（13-P2-2）', () => {
  it('无样本 ⇒ signal 为 undefined（调用方不干预）', () => {
    const led = new TaskOutcomeLedger();
    expect(led.signal('k')).toBeUndefined();
  });

  it('按分桶键隔离，互不串味', () => {
    const led = new TaskOutcomeLedger();
    led.record('a', { path: 'simple', success: false });
    led.record('b', { path: 'simple', success: true });
    expect(led.signal('a')).toEqual({ sampleCount: 1, failureRate: 1 });
    expect(led.signal('b')).toEqual({ sampleCount: 1, failureRate: 0 });
  });

  it('窗口满后淘汰最旧（只保留最近 N 条）', () => {
    const led = new TaskOutcomeLedger(3);
    // 先 3 次失败，再 3 次成功 ⇒ 只有最近 3 次成功留在窗口
    for (let i = 0; i < 3; i++) {
      led.record('k', { path: 'simple', success: false });
    }
    for (let i = 0; i < 3; i++) {
      led.record('k', { path: 'simple', success: true });
    }
    expect(led.signal('k')).toEqual({ sampleCount: 3, failureRate: 0 });
  });

  it('windowSize 非法 ⇒ 回退默认值（不静默成 0 窗口）', () => {
    const led = new TaskOutcomeLedger(0);
    led.record('k', { path: 'simple', success: true });
    expect(led.signal('k')?.sampleCount).toBe(1);
  });

  it('clear 清空全部桶', () => {
    const led = new TaskOutcomeLedger();
    led.record('k', { path: 'simple', success: true });
    led.clear();
    expect(led.signal('k')).toBeUndefined();
  });

  it('全局单例：get 返回同一实例，reset 后重建', () => {
    const a = getTaskOutcomeLedger();
    expect(getTaskOutcomeLedger()).toBe(a);
    resetTaskOutcomeLedgerForTest();
    expect(getTaskOutcomeLedger()).not.toBe(a);
  });
});

describe('shouldEscalateGranularity：升级判据（纯函数，13-P2-2）', () => {
  it('无信号 ⇒ false', () => {
    expect(shouldEscalateGranularity(undefined)).toBe(false);
  });

  it('样本不足 ⇒ false（不用 1 次失败翻转策略）', () => {
    expect(shouldEscalateGranularity({ sampleCount: 2, failureRate: 1 })).toBe(
      false
    );
  });

  it('样本足 + 失败率达阈值 ⇒ true', () => {
    expect(
      shouldEscalateGranularity(
        { sampleCount: DEFAULT_ESCALATE_MIN_SAMPLES, failureRate: 1 },
        { failureRate: DEFAULT_ESCALATE_FAILURE_RATE }
      )
    ).toBe(true);
  });

  it('失败率低于阈值 ⇒ false（边界：恰好等于阈值算达标）', () => {
    expect(
      shouldEscalateGranularity({ sampleCount: 10, failureRate: 0.49 })
    ).toBe(false);
    expect(
      shouldEscalateGranularity({ sampleCount: 10, failureRate: 0.5 })
    ).toBe(true);
  });
});
