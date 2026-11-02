// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * RetryPolicy 回归（2026-11-02）
 *
 * 修复的三类缺陷（均有修复前的行为断言）：
 * ① 零用量重试与瞬态重试**共用** `retryCount` ⇒ 零用量会吃掉瞬态配额；
 * ② 退避首轮从 `2^1` 起 ⇒ `baseDelayMs=1000` 实际等 2000ms；
 * ③ 无抖动、不认 `Retry-After`；且两段式循环导致"限流重试后返回空响应"不再被判零用量。
 *
 * 另外固化「先同路径重试、重试耗尽才回退」的顺序（此前回退链恒不生效）。
 */
import { describe, it, expect } from 'bun:test';
import {
  computeRetryDelay,
  executeWithRetry,
  executeWithRetryThenFallback,
} from '../../src/ai/router/RetryPolicy.js';
import type { RetryableResponse } from '../../src/ai/router/RetryPolicy.js';
import type { RouterConfig, RouteDecision } from '../../src/ai/router/types.js';

const decision = (provider = 'p1', model = 'm1'): RouteDecision => ({
  provider,
  model,
  tier: 'medium',
  reason: 'test',
});

function config(over: Partial<RouterConfig> = {}): RouterConfig {
  return {
    enabled: true,
    tiers: {},
    defaultTier: 'medium',
    // 退避压到 1ms（`maxDelayMs` 同时为上限）⇒ 只验证次数与顺序，不引入墙钟等待
    transientRetry: {
      enabled: true,
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
    },
    zeroUsageRetry: { enabled: true, maxAttempts: 2 },
    ...over,
  };
}

const ZERO_USAGE: RetryableResponse = {
  success: true,
  content: '   ',
  outputTokens: 0,
};
const OK: RetryableResponse = {
  success: true,
  content: 'ok',
  outputTokens: 12,
};
const RATE_LIMITED: RetryableResponse = {
  success: false,
  statusCode: 429,
  error: 'rate limited',
};
const BAD_REQUEST: RetryableResponse = {
  success: false,
  statusCode: 400,
  error: 'bad request',
};

/** 按序返回响应；用尽后重复最后一个 */
function scripted(responses: RetryableResponse[]) {
  const calls: RouteDecision[] = [];
  const execute = async (d: RouteDecision) => {
    calls.push(d);
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return r;
  };
  return { execute, calls };
}

describe('computeRetryDelay（退避从 2^0 起 + 抖动 + Retry-After）', () => {
  it('第 N 次重试的指数从 base * 2^(N-1) 起（修复前首轮误为 2^1）', () => {
    const random = () => 0;
    expect(computeRetryDelay(1, 1000, 30000, { random })).toBe(1000);
    expect(computeRetryDelay(2, 1000, 30000, { random })).toBe(2000);
    expect(computeRetryDelay(3, 1000, 30000, { random })).toBe(4000);
  });

  it('抖动有界（0–30%），不会越过 maxDelayMs', () => {
    expect(computeRetryDelay(1, 1000, 30000, { random: () => 1 })).toBe(1300);
    expect(computeRetryDelay(20, 1000, 5000, { random: () => 0 })).toBe(5000);
  });

  it('Retry-After 优先，且仍受上限约束', () => {
    expect(computeRetryDelay(1, 1000, 30000, { retryAfterMs: 7000 })).toBe(
      7000
    );
    expect(computeRetryDelay(1, 1000, 5000, { retryAfterMs: 9000 })).toBe(5000);
    // 非法值（负数）⇒ 退回指数退避
    expect(
      computeRetryDelay(1, 1000, 30000, { retryAfterMs: -1, random: () => 0 })
    ).toBe(1000);
  });
});

describe('executeWithRetry（两类配额独立）', () => {
  it('零用量不吃瞬态配额：2 次零用量后仍能拿到 2 次瞬态重试', async () => {
    const { execute, calls } = scripted([
      ZERO_USAGE,
      ZERO_USAGE,
      RATE_LIMITED,
      RATE_LIMITED,
      OK,
    ]);
    const result = await executeWithRetry(decision(), {
      config: config(),
      execute,
    });
    // 修复前：零用量先耗掉 2 次配额 ⇒ 瞬态块 `retryCount < maxAttempts` 直接不成立
    expect(calls.length).toBe(5);
    expect(result.retryCount).toBe(4);
    expect(result.response.success).toBe(true);
    expect(result.response.content).toBe('ok');
    expect(result.didRetry).toBe(true);
    expect(result.errors.length).toBe(4);
  });

  it('分类按当前响应进行：限流重试后返回空响应仍会被判零用量并继续重试', async () => {
    const { execute, calls } = scripted([RATE_LIMITED, ZERO_USAGE, OK]);
    const result = await executeWithRetry(decision(), {
      config: config({
        zeroUsageRetry: { enabled: true, maxAttempts: 1 },
        transientRetry: {
          enabled: true,
          maxAttempts: 1,
          baseDelayMs: 1,
          maxDelayMs: 1,
        },
      }),
      execute,
    });
    // 修复前：瞬态块退出时不再回到零用量块 ⇒ 返回 content='' 的"成功"
    expect(calls.length).toBe(3);
    expect(result.retryCount).toBe(2);
    expect(result.response.content).toBe('ok');
  });

  it('配额耗尽后如实施返回最后一次响应', async () => {
    const { execute, calls } = scripted([RATE_LIMITED]);
    const result = await executeWithRetry(decision(), {
      config: config({
        transientRetry: {
          enabled: true,
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
        },
      }),
      execute,
    });
    expect(calls.length).toBe(3); // 首次 + 2 次重试
    expect(result.response.success).toBe(false);
    expect(result.response.statusCode).toBe(429);
  });

  it('开关关闭 ⇒ 不重试', async () => {
    const { execute, calls } = scripted([ZERO_USAGE]);
    const result = await executeWithRetry(decision(), {
      config: config({
        zeroUsageRetry: { enabled: false, maxAttempts: 3 },
        transientRetry: {
          enabled: false,
          maxAttempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 1,
        },
      }),
      execute,
    });
    expect(calls.length).toBe(1);
    expect(result.retryCount).toBe(0);
  });
});

describe('executeWithRetryThenFallback（先重试、耗尽才回退）', () => {
  it('主决策一次瞬时 429 后成功 ⇒ 不切模型', async () => {
    const { execute, calls } = scripted([RATE_LIMITED, OK]);
    const result = await executeWithRetryThenFallback(decision('p1', 'm1'), {
      config: config(),
      execute,
      fallbacks: [{ provider: 'p2', model: 'm2' }],
    });
    expect(result.didFallback).toBe(false);
    expect(result.decision.provider).toBe('p1');
    expect(calls.every((d) => d.provider === 'p1')).toBe(true);
  });

  it('主决策失败（不可重试）⇒ 主重试结束后才回退', async () => {
    const calls: RouteDecision[] = [];
    const execute = async (d: RouteDecision) => {
      calls.push(d);
      return d.provider === 'p2' ? OK : BAD_REQUEST;
    };
    const result = await executeWithRetryThenFallback(decision('p1', 'm1'), {
      config: config(),
      execute,
      fallbacks: [{ provider: 'p2', model: 'm2' }],
    });
    // 主决策只有 1 次（400 不可重试）⇒ 之后才轮到回退
    expect(calls[0].provider).toBe('p1');
    expect(calls[1].provider).toBe('p2');
    expect(result.didFallback).toBe(true);
    expect(result.decision.provider).toBe('p2');
    expect(result.response.success).toBe(true);
  });

  it('回退候选与主决策同 provider/model ⇒ 跳过（不重复打同一模型）', async () => {
    const { execute } = scripted([BAD_REQUEST]);
    const result = await executeWithRetryThenFallback(decision('p1', 'm1'), {
      config: config(),
      execute,
      fallbacks: [{ provider: 'p1', model: 'm1' }],
    });
    expect(result.didFallback).toBe(false);
    expect(result.decision.provider).toBe('p1');
  });

  it('回退也全失败 ⇒ 如实返回主决策的失败响应（不伪装成回退成功）', async () => {
    const { execute } = scripted([BAD_REQUEST]);
    const result = await executeWithRetryThenFallback(decision('p1', 'm1'), {
      config: config(),
      execute,
      fallbacks: [{ provider: 'p2', model: 'm2' }],
    });
    expect(result.didFallback).toBe(false);
    expect(result.decision.provider).toBe('p1');
    expect(result.response.statusCode).toBe(400);
  });

  it('allowFallback=false（fastPath）⇒ 只走主决策', async () => {
    const { execute, calls } = scripted([BAD_REQUEST]);
    const result = await executeWithRetryThenFallback(decision('p1', 'm1'), {
      config: config(),
      execute,
      fallbacks: [{ provider: 'p2', model: 'm2' }],
      allowFallback: false,
    });
    expect(calls.every((d) => d.provider === 'p1')).toBe(true);
    expect(result.didFallback).toBe(false);
  });

  it('主决策成功 ⇒ 回退候选一次都不执行', async () => {
    const { execute, calls } = scripted([OK]);
    const result = await executeWithRetryThenFallback(decision('p1', 'm1'), {
      config: config(),
      execute,
      fallbacks: [{ provider: 'p2', model: 'm2' }],
    });
    expect(calls.length).toBe(1);
    expect(result.didFallback).toBe(false);
    expect(result.retryCount).toBe(0);
  });
});
