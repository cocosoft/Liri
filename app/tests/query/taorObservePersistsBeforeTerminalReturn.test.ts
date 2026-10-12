// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// observeRound 收口（2026-10-12）：`TAORLoop._observeRound` 的两条**终态早退**
// （① 熔断 `shouldBreak` ② 收益递减 `checkDiminishingReturns`）此前**先于** `persistMessages`
// ⇒ 该轮**已执行**的工具结果**不落盘**（用户观感"没继续"）。
//
// 修复：让 `persistMessages` 先于两条终态早退执行（工具确已执行 ⇒ 结果必须落盘；是否终止是另一件事）。
// 修复前：两条路径的 `persistMessages` 计数为 0（红）。

import { describe, expect, it } from 'bun:test';
import { TAORLoop } from '../../src/query/TAORLoop';
import type { QueryEngine } from '../../src/query/QueryEngine';
import { LOOP_DIMINISH_TURNS_THRESHOLD } from '../../src/query/loop-config';

interface TestableLoop {
  messages: Array<{ role: string; content: string }>;
  deps: {
    persistMessages: (m: unknown, signal: AbortSignal) => Promise<void>;
  };
  dailyBudget: {
    checkDiminishingReturns(tokens: number): { diminishing: boolean };
  };
  circuitBreaker: { recordFailure(error: string): unknown };
  _observeRound(): Promise<void>;
}

function makeLoop(): TestableLoop {
  return new TAORLoop({} as unknown as QueryEngine) as unknown as TestableLoop;
}

describe('observeRound：真递减/熔断终态早退不得快于 persistMessages', () => {
  it('① 真递减终止轮 ⇒ persistMessages 仍被调用（工具结果落盘）', async () => {
    const loop = makeLoop();
    let persisted = 0;
    loop.messages = [{ role: 'user', content: 'hi' }];
    loop.deps = {
      persistMessages: async () => {
        persisted++;
      },
    };
    // 逼近递减阈值：构造 threshold-1 次连续小增量，使 `_observeRound` 内一次调用即达阈值
    for (let i = 0; i < Math.max(1, LOOP_DIMINISH_TURNS_THRESHOLD - 1); i++) {
      loop.dailyBudget.checkDiminishingReturns(0);
    }

    await loop._observeRound();

    // 修复前：收益递减早退先于持久化 ⇒ 0（红）
    expect(persisted).toBe(1);
  });

  it('② 熔断终止轮 ⇒ persistMessages 仍被调用（工具结果落盘）', async () => {
    const loop = makeLoop();
    let persisted = 0;
    loop.messages = [{ role: 'user', content: 'hi' }];
    loop.deps = {
      persistMessages: async () => {
        persisted++;
      },
    };
    // 打开断路器：默认 maxConsecutiveSameError=5 / maxConsecutiveFailures=10 ⇒ 5 次同错误即 OPEN
    for (let i = 0; i < 5; i++) loop.circuitBreaker.recordFailure('tool_error');

    await loop._observeRound();

    // 修复前：熔断早退先于持久化 ⇒ 0（红）
    expect(persisted).toBe(1);
  });
});
