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
