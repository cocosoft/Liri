/**
 * 供应商余额熔断（2026-11-03 实时巡检）
 *
 * 现场：账户余额不足时批量链路（Dream 精炼）逐条发请求，2 秒内连撞 3 次 402。
 * 402 本身不重试（`shouldBackOff` 只管 429/529），缺的是**跨调用的短期记忆**。
 */
import { describe, it, expect, afterEach } from 'bun:test';

import {
  BALANCE_CIRCUIT_TTL_MS,
  isInsufficientBalanceError,
  providerBalanceCircuitRemaining,
  tripProviderBalanceCircuit,
  ProviderBalanceCircuitOpenError,
  resetProviderBalanceCircuitForTest,
} from '../../src/ai/providers/providerCircuitBreaker';

afterEach(() => resetProviderBalanceCircuitForTest());

describe('isInsufficientBalanceError', () => {
  it('status / statusCode = 402 ⇒ true', () => {
    expect(isInsufficientBalanceError({ status: 402 })).toBe(true);
    expect(isInsufficientBalanceError({ statusCode: 402 })).toBe(true);
  });

  it('消息文案命中（部分端点只在正文写原因）⇒ true', () => {
    expect(
      isInsufficientBalanceError(
        new Error(
          'OpenAI API error (402): {"code":30001,"message":"Sorry, your account balance is insufficient"}'
        )
      )
    ).toBe(true);
    expect(isInsufficientBalanceError(new Error('账户余额不足，请充值'))).toBe(
      true
    );
  });

  it('429 / 5xx / 普通错误 ⇒ false（它们走既有退避重试，不属本熔断）', () => {
    expect(isInsufficientBalanceError({ status: 429 })).toBe(false);
    expect(isInsufficientBalanceError({ status: 500 })).toBe(false);
    expect(isInsufficientBalanceError(new Error('network reset'))).toBe(false);
    expect(isInsufficientBalanceError(null)).toBe(false);
  });
});

describe('熔断窗口', () => {
  it('未触发 ⇒ 剩余 0；触发后 > 0；按 provider 隔离', () => {
    expect(providerBalanceCircuitRemaining('OpenAI')).toBe(0);

    tripProviderBalanceCircuit('OpenAI');
    expect(providerBalanceCircuitRemaining('OpenAI')).toBeGreaterThan(0);
    expect(providerBalanceCircuitRemaining('Other')).toBe(0);
  });

  it('超过 TTL ⇒ 自动恢复（充值后无需重启）', () => {
    const now = 1_000_000;
    tripProviderBalanceCircuit('OpenAI', now);
    expect(providerBalanceCircuitRemaining('OpenAI', now + 1)).toBeGreaterThan(
      0
    );
    expect(
      providerBalanceCircuitRemaining(
        'OpenAI',
        now + BALANCE_CIRCUIT_TTL_MS + 1
      )
    ).toBe(0);
  });

  it('熔断错误保留 status=402（上游分类口径不变）且文案可操作', () => {
    const err = new ProviderBalanceCircuitOpenError('OpenAI', 30_000);
    expect(err.status).toBe(402);
    expect(err.message).toContain('余额/配额不足');
    expect(err.message).toContain('本次未发起网络请求');
    expect(err.message).toContain('充值');
  });
});
