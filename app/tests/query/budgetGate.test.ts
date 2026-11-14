// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2 待办 2/2（2026-11-04）：预算判定式 + 拒绝理由词汇收敛到 `query/budgetGate.ts`。
 *
 * 改造前"为什么被拦"由各入口自己拼证据：HTTP 入口拼 `entry/unit/todayUsed`、长程执行器拼
 * `taskId/unit/todayUsed`，且都答不出"是手动总闸还是额度用完"。本文件锁两件事：
 *   ① 判定式唯一（kill-switch 不可被 waiver 绕过、waiver 可放行 locked）；
 *   ② 两个拒绝载体都带同一个 `blockedBy` 词（`kill_switch` / `budget_limit`）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateBudgetGate } from '@modules/query/budgetGate';
import { checkDailyBudget } from '@modules/query/dailyBudgetGate';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '@modules/query/DailyBudgetManager';
import { queryPath } from '../../../scripts/lib/queryPaths';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const DAILY_GATE_SRC = readFileSync(
  queryPath(REPO_ROOT, 'dailyBudgetGate.ts'),
  'utf8'
);
// 2026-11-08：日预算收口已外移 `lro/executorBudgetGuard`（守 R04-001 行数上限）——
// 断言目标随之迁移到**新实现**，宿主文件不再含该函数。
const LRO_SRC = readFileSync(
  new URL('../../src/tasks/lro/executorBudgetGuard.ts', import.meta.url),
  'utf8'
);

describe('evaluateBudgetGate：判定式（纯函数）', () => {
  it('未越界 / 未开总闸 ⇒ 放行且无理由', () => {
    expect(
      evaluateBudgetGate({ mode: 'normal', killSwitch: false, waiver: false })
    ).toEqual({ allowed: true, blockedBy: null });
    expect(
      evaluateBudgetGate({
        mode: 'report_only',
        killSwitch: false,
        waiver: false,
      })
    ).toEqual({ allowed: true, blockedBy: null });
  });

  it('额度用尽（locked）⇒ 拒发，理由是 budget_limit', () => {
    expect(
      evaluateBudgetGate({ mode: 'locked', killSwitch: false, waiver: false })
    ).toEqual({ allowed: false, blockedBy: 'budget_limit' });
  });

  it('一次性通行证可放行 locked（waive-once 语义）', () => {
    expect(
      evaluateBudgetGate({ mode: 'locked', killSwitch: false, waiver: true })
    ).toEqual({ allowed: true, blockedBy: null });
  });

  it('手动总闸任何情况下都拒发，且理由优先报 kill_switch', () => {
    expect(
      evaluateBudgetGate({ mode: 'normal', killSwitch: true, waiver: false })
    ).toEqual({ allowed: false, blockedBy: 'kill_switch' });
    // 通行证不能绕过总闸
    expect(
      evaluateBudgetGate({ mode: 'locked', killSwitch: true, waiver: true })
    ).toEqual({ allowed: false, blockedBy: 'kill_switch' });
  });
});

describe('checkDailyBudget：真实状态机产出的理由', () => {
  beforeEach(() => resetDailyBudgetForTest());
  afterEach(() => resetDailyBudgetForTest());

  it('常态放行 ⇒ blockedBy = null', () => {
    const decision = checkDailyBudget({
      sessionId: 's-gate',
      estimatedTokens: 10,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.blockedBy).toBeNull();
  });

  it('金额超限 ⇒ allowed=false 且 blockedBy=budget_limit', () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(1);
    budget.recordUsdUsage(2);

    const decision = checkDailyBudget({
      sessionId: 's-gate',
      estimatedTokens: 10,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedBy).toBe('budget_limit');
  });

  it('手动总闸 ⇒ allowed=false 且 blockedBy=kill_switch', () => {
    const budget = getDailyBudget();
    budget.enableKillSwitch();

    const decision = checkDailyBudget({
      sessionId: 's-gate',
      estimatedTokens: 10,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockedBy).toBe('kill_switch');
  });
});

describe('接线：拒绝载体共用同一理由词汇', () => {
  it('dailyBudgetGate 走 budgetGate 的判定式，入口拒绝载荷带 blockedBy', () => {
    expect(DAILY_GATE_SRC).toContain('evaluateBudgetGate({');
    // 判定式不得在闸门内再写一份（双轨）
    expect(DAILY_GATE_SRC).not.toContain(
      'const allowed = !killSwitch && (waiver || primaryAllows);'
    );
    expect(DAILY_GATE_SRC).toContain('blockedBy: decision.blockedBy');
  });

  it('长程执行器前置检查的**错误上下文**带 blockedBy', () => {
    // R04-001（2000 行上限）：只加一处 —— 拒绝载荷（用户/HTTP 可见）带理由；
    // warn 日志已有 `mode`/`todayUsed`/`dailyLimit`，不再重复占一行。
    const hits = LRO_SRC.match(/blockedBy: decision\.blockedBy/g) ?? [];
    expect(hits.length).toBe(1);
  });
});
