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

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
  resolveBudgetResumeMaxPerWake,
  BUDGET_RESUME_MAX_PER_WAKE,
  SUSPEND_TTL_MS,
} from '../../src/query/budgetSuspend';

/**
 * 长任务预算挂起续跑（Task 4）：内存挂起协调器。
 *
 * 锁定：登记/查询 · 同 session 重复 `suspend` **保留最早一条**（挂起时间序稳定）·
 * `list()` 现算 `expired`（>24h）· `release` 幂等 · 测试重置清空。
 */
describe('BudgetSuspendCoordinator（预算挂起协调器）', () => {
  let nowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetBudgetSuspendForTest();
    nowSpy = spyOn(Date, 'now');
  });
  afterEach(() => {
    nowSpy.mockRestore();
    resetBudgetSuspendForTest();
  });

  it('登记后可查询；未登记会话为 false', () => {
    nowSpy.mockReturnValue(1_000);
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'stream', reason: 'daily-budget' });

    expect(c.isSuspended('s1')).toBe(true);
    expect(c.isSuspended('s2')).toBe(false);
  });

  it('同 session 重复 suspend ⇒ 只保留最早一条（挂起时间序稳定）', () => {
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 's1', chain: 'stream', reason: 'first' });
    nowSpy.mockReturnValue(2_000);
    c.suspend({ sessionId: 's1', chain: 'taor', reason: 'second' });

    const list = c.list();
    expect(list.length).toBe(1);
    expect(list[0].suspendedAt).toBe(1_000);
    expect(list[0].chain).toBe('stream');
    expect(list[0].reason).toBe('first');
  });

  it('list() 按 suspendedAt 升序，且对 >24h 条目标 expired', () => {
    const c = getBudgetSuspendCoordinator();
    nowSpy.mockReturnValue(1_000);
    c.suspend({ sessionId: 'b', chain: 'taor', reason: 'r' });
    nowSpy.mockReturnValue(2_000);
    c.suspend({ sessionId: 'a', chain: 'stream', reason: 'r' });

    // 未过期（最早条目 b 距今仍 < TTL）
    nowSpy.mockReturnValue(1_000 + SUSPEND_TTL_MS - 1);
    let list = c.list();
    expect(list.map((e) => e.sessionId)).toEqual(['b', 'a']);
    expect(list[0].expired).toBe(false);

    // 越过 TTL ⇒ 最早条目 b 过期，较晚的 a 仍有效
    nowSpy.mockReturnValue(1_000 + SUSPEND_TTL_MS + 1);
    list = c.list();
    expect(list[0].expired).toBe(true);
    expect(list[1].expired).toBe(false);
  });

  it('release 移除且幂等（不存在也不报错）', () => {
    nowSpy.mockReturnValue(1_000);
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'stream', reason: 'r' });

    c.release('s1');
    expect(c.isSuspended('s1')).toBe(false);
    expect(c.list().length).toBe(0);

    // 幂等：再次释放无异常
    expect(() => c.release('s1')).not.toThrow();
  });

  it('resetBudgetSuspendForTest 清空登记', () => {
    nowSpy.mockReturnValue(1_000);
    const c = getBudgetSuspendCoordinator();
    c.suspend({ sessionId: 's1', chain: 'stream', reason: 'r' });

    resetBudgetSuspendForTest();
    expect(getBudgetSuspendCoordinator().isSuspended('s1')).toBe(false);
    expect(getBudgetSuspendCoordinator().list().length).toBe(0);
  });
});

/**
 * Task 4 遗留修正：env 键名对齐 spec 字面 `BUDGET_RESUME_MAX_PER_WAKE`（此前误用 `LIRI_` 前缀）。
 */
describe('BUDGET_RESUME_MAX_PER_WAKE（env 键名 + 默认值）', () => {
  const KEY = 'BUDGET_RESUME_MAX_PER_WAKE';
  const LEGACY = 'LIRI_BUDGET_RESUME_MAX_PER_WAKE';

  it('不设 env ⇒ 默认值为 3', () => {
    expect(BUDGET_RESUME_MAX_PER_WAKE).toBe(3);
  });

  it('env 键名恰为 BUDGET_RESUME_MAX_PER_WAKE（旧 LIRI_ 前缀不再被读取）', () => {
    const prev = process.env[KEY];
    const prevLegacy = process.env[LEGACY];
    process.env[LEGACY] = '9';
    delete process.env[KEY];
    try {
      // 旧键名被读取则应返回 9；实际回退默认 ⇒ 证明键名已切换
      expect(resolveBudgetResumeMaxPerWake()).toBe(3);
      process.env[KEY] = '5';
      expect(resolveBudgetResumeMaxPerWake()).toBe(5);
    } finally {
      if (prev === undefined) delete process.env[KEY];
      else process.env[KEY] = prev;
      if (prevLegacy === undefined) delete process.env[LEGACY];
      else process.env[LEGACY] = prevLegacy;
    }
  });
});
