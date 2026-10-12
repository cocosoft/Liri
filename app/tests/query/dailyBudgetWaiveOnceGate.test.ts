// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// F4（Spec `.trae/specs/long-task-suspend-resume.md` §3-D8 / §1.3-F4）：
// `waive-once` 的**闸门消费点** —— 一次性通行证必须真正被 `canExecute()` 消费，
// 使"放行一次"从"死能力"变为可用；且该放行**恰消费一次**（本轮记账后失效）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import { checkDailyBudget } from '../../src/query/dailyBudgetGate';

const LIMIT = 100;

describe('F4：waive-once 被日预算闸门消费（canExecute 放行一次）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    getDailyBudget().setLimit(LIMIT);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('① locked + applyRelief({kind:waive-once}) ⇒ canExecute() === true', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT); // 100/100 ⇒ locked
    expect(b.getMode().mode).toBe('locked');
    expect(b.canExecute()).toBe(false); // 放行前：无 waiver ⇒ 拦截

    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });
    expect(b.getRelief()).toBeNull(); // waive-once 不是 reliefState（不改有效上限）
    expect(b.canExecute()).toBe(true);
  });

  it('② 放行恰消费一次：recordUsage(1) 后下一次 canExecute() === false', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });
    expect(b.canExecute()).toBe(true); // 本轮放行

    b.recordUsage(1); // 本轮记账 ⇒ 消费 waiver（Consume-and-Die）
    expect(b.canExecute()).toBe(false);
  });

  it('③ 既有语义不变：无 waiver 时 locked ⇒ canExecute() === false', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    expect(b.getMode().mode).toBe('locked');
    expect(b.canExecute()).toBe(false);
  });

  it('④ waiver 过期 ⇒ 不消费、不放行（canExecute() === false）', async () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));

    expect(b.canExecute()).toBe(false);
  });
});

// ─── C2（最终整支评审）：waive-once 必须接到**流式/发送侧**唯一收口 `checkDailyBudget()` ──
//
// 缺陷：F4 只接了 `DailyBudgetManager.canExecute()`（唯一运行时调用者 = TAORLoop），而流式
// 主链的闸门是 `checkDailyBudget()`（自述纯读、不读 `waiveOncePending`）⇒ 放行后被唤醒的
// 流式会话**立刻再次 locked**（反目标②在主链仍成立）。修复：`checkDailyBudget()` 在
// `mode === 'locked'` 时按只读判据 `hasActiveWaiver()` 放行；消费点仍在 `recordUsage()`。
describe('C2：checkDailyBudget 认 waive-once（流式/发送侧闸门）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    getDailyBudget().setLimit(LIMIT);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('locked + 有效 waiver ⇒ allowed === true；消费后 ⇒ allowed === false', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT); // 100/100 ⇒ locked
    const q = { sessionId: 'sess-c2', estimatedTokens: 0 };
    expect(checkDailyBudget(q).allowed).toBe(false); // 无 waiver ⇒ 拦截（既有语义）

    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });
    expect(checkDailyBudget(q).allowed).toBe(true); // 放行（不再"立刻 locked"）

    // 消费：F4 既有路径（canExecute 放行一轮 → recordUsage 末尾 Consume-and-Die）
    expect(b.canExecute()).toBe(true);
    b.recordUsage(1);
    expect(checkDailyBudget(q).allowed).toBe(false); // 已消费 ⇒ 回到拦截
  });

  it('waiver 过期 ⇒ checkDailyBudget 仍拦截', async () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));

    expect(
      checkDailyBudget({ sessionId: 's', estimatedTokens: 0 }).allowed
    ).toBe(false);
  });
});
