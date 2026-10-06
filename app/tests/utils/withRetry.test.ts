/**
 * utils/withRetry 单测（P2-8 ② 工程清偿 · C 类迁移）
 *
 * 由 `tests/utils/common.test.ts` 的 `describe('retry')` **迁移**而来：
 * 被弃的 `utils/common.retry`（固定延迟 + 无条件重试 + `onRetry`）**能力不等价**于
 * 规范实现 `withRetry`（**可重试性门控** + 指数退避 + `handleError` 上报），
 * 故按 `withRetry` 的真实语义重写断言（并**补**「不可重试错误立即抛出」这一
 * 区分性用例），随后删除 `common.retry` 及其旧用例。
 */

import { describe, it, expect } from 'bun:test';
import { withRetry, RetryableError } from '../../src/utils/withRetry.js';

/** 快速退避配置：避免单测等待真实退避 */
const FAST = {
  initialDelayMs: 1,
  maxDelayMs: 1,
  backoffMultiplier: 1,
};

describe('withRetry', () => {
  it('成功时直接返回（不重试）', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return 'success';
    });
    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  it('可重试错误 ⇒ 重试后成功', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new RetryableError('temporary failure');
        return 'success';
      },
      { maxRetries: 3, ...FAST }
    );
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('不可重试错误 ⇒ 立即抛出（不消耗重试次数）', async () => {
    let attempts = 0;
    expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error('fatal, not retryable');
        },
        { maxRetries: 3, ...FAST }
      )
    ).rejects.toThrow('fatal, not retryable');
    // 门控生效：只调用一次（旧 `common.retry` 会无条件重试）
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(attempts).toBe(1);
  });

  it('可重试错误耗尽重试次数 ⇒ 抛出最后错误', async () => {
    let attempts = 0;
    expect(
      withRetry(
        async () => {
          attempts++;
          throw new RetryableError('persistent failure');
        },
        { maxRetries: 2, ...FAST }
      )
    ).rejects.toThrow('persistent failure');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBe(3); // 首次 + 2 次重试
  });
});
