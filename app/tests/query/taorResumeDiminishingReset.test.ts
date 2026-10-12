// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// B3-2 回归（2026-10-12）：恢复边界未复位 loop-local 收益递减连续性。
//
// 缺陷：`TAORLoop._observeRound` 调用 **loop-local** `this.dailyBudget.checkDiminishingReturns`，
// 而唤醒路径为保住恢复的游标/steering **刻意跳过 `reset()`**（G-T3-1）⇒ `DailyBudgetManager` 的
// `lastTotalTokens` / `diminishingTurnsCount` **跨挂起边界残留** ⇒ 恢复首轮被误判为收益递减，
// 且该 `return` 先于 `persistMessages` ⇒ 工具已执行却结果不落盘。
//
// 修复：`resumeFromCheckpoint` 复位递减连续性（`resetDiminishingReturns(currentTokens)`），
// 使"进程内恢复"与"跨进程重启（新实例 ⇒ 计数为 0）"行为一致。修复前断言为 true（红）。

import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';
import type { TAORCheckpoint } from '../../src/query/types';
import {
  LOOP_MIN_TOKEN_DELTA,
  LOOP_DIMINISH_TURNS_THRESHOLD,
} from '../../src/query/loop-config';

interface TestableLoop {
  dailyBudget: {
    checkDiminishingReturns(tokens: number): {
      diminishing: boolean;
      reason?: string;
    };
  };
  checkpointStorage: { load(id: string): Promise<unknown> };
  resumeFromCheckpoint(id?: string): Promise<boolean>;
}

function makeLoop(): TestableLoop {
  return new TAORLoop({} as unknown as QueryEngine) as unknown as TestableLoop;
}

/** 最小可用 checkpoint（`resumeFromCheckpoint` 读取的字段）；`currentTokens` 与恢复基线同源 */
function suspendCheckpoint(currentTokens: number): TAORCheckpoint {
  return {
    id: 'cp-diminishing',
    sessionId: 's-taor-diminishing',
    turnCount: 3,
    phase: 'act',
    budgetState: {
      modelName: 'default',
      maxTokens: 200000,
      currentTokens,
      maxOutputTokens: 8000,
    },
    conversationSummary: '',
    lastPrompt: '',
    createdAt: Date.now(),
    type: 'budget_suspend',
  } as unknown as TAORCheckpoint;
}

describe('B3-2：resumeFromCheckpoint 复位 loop-local 收益递减连续性', () => {
  it('逼近递减阈值后恢复 ⇒ 恢复首轮不再被误判收益递减', async () => {
    const loop = makeLoop();

    // 先读默认值以确定需要几次连续小增量（LOOP_MIN_TOKEN_DELTA 默认 500，阈值默认 2）
    const step = Math.max(1, LOOP_MIN_TOKEN_DELTA - 1);
    let currentTokens = 0;
    let last: { diminishing: boolean } = { diminishing: false };
    for (let i = 0; i < LOOP_DIMINISH_TURNS_THRESHOLD; i++) {
      currentTokens += step;
      last = loop.dailyBudget.checkDiminishingReturns(currentTokens);
    }
    // 前置：已到达递减阈值（`diminishingTurnsCount === threshold`）
    expect(last.diminishing).toBe(true);

    loop.checkpointStorage = {
      load: async () => suspendCheckpoint(currentTokens),
    };
    const ok = await loop.resumeFromCheckpoint('cp-diminishing');
    expect(ok).toBe(true);

    // 恢复首轮：与恢复基线同源的累计 tokens ⇒ 期望不再被判递减
    // （修复前 `diminishingTurnsCount` 跨边界残留 ⇒ 此处为 true，断言失败=红）
    expect(
      loop.dailyBudget.checkDiminishingReturns(currentTokens).diminishing
    ).toBe(false);
  });
});
