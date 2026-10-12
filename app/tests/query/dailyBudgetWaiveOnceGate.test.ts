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

  it('② 放行恰消费一次：同会话 recordUsage(1, sess) 后下一次 canExecute() === false', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });
    expect(b.canExecute('sess-f4')).toBe(true); // 本轮放行（通行证归属 sess-f4）

    b.recordUsage(1, 'sess-f4'); // 同会话记账 ⇒ 消费 waiver（Consume-and-Die）
    expect(b.canExecute('sess-f4')).toBe(false);
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

    // 消费：F4 既有路径（canExecute 放行一轮 → 同会话 recordUsage 末尾 Consume-and-Die）
    expect(b.canExecute('sess-c2')).toBe(true);
    b.recordUsage(1, 'sess-c2');
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

// ─── M1（2026-10-12）：`waive-once` 通行证按**会话归属** ─────────────────────────
//
// 缺陷：`_waiverGrantedThisTurn` 是 **manager 级** 布尔（`getDailyBudget()` 为进程单例，被所有
// 会话共享）—— A 会话经 waive-once 放行拿到通行证后，**B 会话**任何一笔记账都会清位并消费掉
// A 的通行证 ⇒ A 的"一手放行"被静默吃掉、B 白得一次放行。
//
// 修复：通行证记录**取得它的会话**（`_waiverGrantedForSession`）；仅**同一会话**的记账才消费它。
// 无 sessionId 的记账不消费任何通行证（未消费者由既有 TTL 兜底失效）。判据用精确相等（CS02）。
describe('M1：waive-once 通行证按会话归属（跨会话不得互相消费）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    getDailyBudget().setLimit(LIMIT);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('① 跨会话记账不消费通行证：A 取得，B 记账 ⇒ 通行证仍有效', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT); // 100/100 ⇒ locked
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });

    expect(b.canExecute('A')).toBe(true); // A 取得通行证
    b.recordUsage(1, 'B'); // B 记账（修复前 ⇒ 消费掉 A 的通行证，断言失败=红）
    expect(b.hasActiveWaiver()).toBe(true); // A 的通行证未被 B 吃掉
  });

  it('② 同会话记账消费通行证：A 取得，A 记账 ⇒ 通行证失效', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });

    b.canExecute('A');
    b.recordUsage(1, 'A');
    expect(b.hasActiveWaiver()).toBe(false);
  });

  it('③ 无 sessionId 的记账不消费任何通行证', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });

    b.canExecute('A');
    b.recordUsage(1); // 无 sessionId（修复前 ⇒ 消费，断言失败=红）
    expect(b.hasActiveWaiver()).toBe(true);
  });

  it('④ 通行证 TTL 到期 ⇒ hasActiveWaiver() === false', async () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT);
    b.applyRelief({ kind: 'waive-once', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));

    expect(b.hasActiveWaiver()).toBe(false);
  });

  it('⑤ settleFor 透传 sessionId：本会话结算消费，他会话结算不消费', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT); // locked
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });

    b.canExecute('A'); // A 取得通行证
    b.settleFor('B', 10); // 他会话结算（chat 主路径记账）⇒ 不消费
    expect(b.hasActiveWaiver()).toBe(true);

    b.settleFor('A', 10); // 本会话结算 ⇒ 消费（Consume-and-Die）
    expect(b.hasActiveWaiver()).toBe(false);
  });

  it('⑥ 先认领者独占：A 认领后 B 仍被放行但不夺走认领（B 记账不消费、A 记账才消费）', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT); // locked
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });

    expect(b.canExecute('A')).toBe(true); // A **先**认领
    expect(b.canExecute('B')).toBe(true); // B 同样被放行（waiver 有效）
    b.recordUsage(1, 'B'); // B 记账 ⇒ 不消费（认领者不是 B）
    expect(b.hasActiveWaiver()).toBe(true);
    b.recordUsage(1, 'A'); // A（认领者）记账 ⇒ 消费
    expect(b.hasActiveWaiver()).toBe(false);
  });

  it('⑦ 消费按**本次实际消耗**计入欠账（`debtTokens`；修复前恒 0 = 静默 no-op）', () => {
    const b = getDailyBudget();
    b.recordUsage(LIMIT); // locked
    b.applyRelief({ kind: 'waive-once', ttlMs: 60_000 });

    b.canExecute('A'); // 取得通行证
    b.recordUsage(1_234, 'A'); // 同会话记账 ⇒ 消费（Consume-and-Die）

    expect(b.hasActiveWaiver()).toBe(false);
    expect(b.getDebtTokens()).toBe(1_234); // 实际消耗计入欠账（次日 rollover 扣回）
  });
});
