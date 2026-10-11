// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T4（Spec `daily-budget-over-limit-ux.md` §4 D-b/D-d/D-m/D-n、§6.1 C1–C4）：
// relief 状态机 —— `boost`（限时自动恢复，不写回配置键）/ `waive-once`（按会话键控 +
// Consume-and-Die）/ `unlock-today`（软上限 = 原上限 ×5）；`reset()` 清 relief **不清欠账**。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

const LIMIT = 100;

function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

describe('T4：日预算 relief 状态机（boost / waive-once / unlock-today）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    getDailyBudget().setLimit(LIMIT);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('boost 默认 ×2；到期后自动恢复原上限', async () => {
    const b = getDailyBudget();
    expect(b.getSnapshot().limit).toBe(LIMIT);

    const v = b.applyRelief({ kind: 'boost', ttlMs: 1 });
    expect(v.kind).toBe('boost');
    expect(v.effectiveLimit).toBe(LIMIT * 2);
    expect(b.getSnapshot().limit).toBe(LIMIT * 2);

    await new Promise((r) => setTimeout(r, 5));
    expect(b.getRelief()).toBeNull();
    expect(b.getSnapshot().limit).toBe(LIMIT);
  });

  it('重启恢复：已过期的 boost 不得复活（Review Focus #2）', () => {
    const b = getDailyBudget();
    b.restore({
      todayUsed: 0,
      date: todayLocal(),
      relief: { kind: 'boost', expiresAt: Date.now() - 1000, factor: 2 },
    });
    expect(b.getRelief()).toBeNull();
    expect(b.getSnapshot().limit).toBe(LIMIT);
  });

  it('unlock-today 仍有软上限（原上限 ×5）', () => {
    const b = getDailyBudget();
    const v = b.applyRelief({ kind: 'unlock-today' });
    expect(v.effectiveLimit).toBe(LIMIT * 5);

    b.recordUsage(400); // 400 < 500 ⇒ 放行
    expect(b.getMode().mode).not.toBe('locked');

    b.recordUsage(150); // 550 ≥ 500 ⇒ 软上限兜底仍锁定
    expect(b.getMode().mode).toBe('locked');
  });

  it('waive-once：被消费一次后即失效（Consume-and-Die）', () => {
    const b = getDailyBudget();
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });
    expect(b.consumeWaiveOnce('s1')).toBe(true);
    expect(b.consumeWaiveOnce('s1')).toBe(false);
  });

  it('waive-once：TTL 过期后不可消费（防悬挂）', async () => {
    const b = getDailyBudget();
    b.applyRelief({ kind: 'waive-once', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(b.consumeWaiveOnce('s1')).toBe(false);
  });

  it('跨日界：欠账结转、relief 不跨日（Review Focus #3）', () => {
    const b = getDailyBudget();
    b.applyRelief({ kind: 'boost', ttlMs: 60_000 });
    expect(b.getSnapshot().limit).toBe(LIMIT * 2);

    // 模拟"昨日落盘的状态"：跨日 + 有欠账
    b.restore({ todayUsed: 30, date: '2000-01-01', debt: 40 });

    const s = b.getSnapshot(); // 读侧触发日切
    expect(s.used).toBe(40); // 昨日用量归零，**欠账计入新的一天**
    expect(s.limit).toBe(LIMIT); // boost 不跨日
    expect(b.getRelief()).toBeNull();
  });

  it('reset() 清 relief 但不清欠账（§6.1 C3）', () => {
    const b = getDailyBudget();
    b.applyRelief({ kind: 'boost', ttlMs: 60_000 });
    b.restore({ todayUsed: 10, date: todayLocal(), debt: 25 });

    b.reset();
    expect(b.getRelief()).toBeNull();
    expect(b.getSnapshot().used).toBe(0);

    // 欠账未被 reset 抹掉：跨日时仍会结转
    b.restore({ todayUsed: 0, date: '2000-01-01' });
    expect(b.getSnapshot().used).toBe(25);
  });
});
