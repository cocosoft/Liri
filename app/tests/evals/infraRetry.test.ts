/**
 * `--retry-on-infra`（基建重试）行为测试。
 *
 * 背景（2026-09-26）：模型/供应商会**停摆**（本仓实测 `deepseek-v4-flash` 约 2/9 请求 180s
 * 无首字节）。停摆若被记成失败，会把**基建问题算成能力问题**，进而在定基线时给出错误阈值。
 * ⇒ 只对 `failureKind === 'infra'`（执行异常）重试，且**不消耗 attempt 额度**；
 * 模型"答错 / 未交付"（`'assert'`）**绝不重试**。
 *
 * 判据是**结构化字段**（`EvalAttempt.failureKind`），不做 `assertion.reason` 字符串匹配（CS02）。
 *
 * 重试本身走 `utils/withRetry`（R01-003）；本测试用**假 runOnce** 离线驱动，无需 daemon。
 */
import { describe, test, expect } from 'bun:test';

import { runAttemptWithInfraRetry } from '../../src/evals/runner';
import type { EvalAttempt } from '../../src/evals/types';

function attemptOf(
  failureKind: 'infra' | 'assert' | undefined,
  error?: string
): EvalAttempt {
  return {
    index: 1,
    assertion: { pass: false, reason: 'x' },
    asExpected: false,
    durationMs: 1,
    error,
    failureKind,
  };
}

describe('基建重试 runAttemptWithInfraRetry', () => {
  test('infra 未达上限 ⇒ 重试，且重试后取**真实**结果（不伪造成功）', async () => {
    let calls = 0;
    const result = await runAttemptWithInfraRetry(
      'task#1',
      async () => {
        calls += 1;
        return calls === 1
          ? attemptOf('infra', 'The operation timed out.')
          : attemptOf('assert', undefined);
      },
      2
    );

    expect(calls).toBe(2);
    expect(result.failureKind).toBe('assert');
    expect(result.infraRetries).toBe(1);
  });

  test('assert（模型答错/未交付）⇒ 绝不重试', async () => {
    let calls = 0;
    const result = await runAttemptWithInfraRetry(
      'task#1',
      async () => {
        calls += 1;
        return attemptOf('assert', undefined);
      },
      5
    );

    expect(calls).toBe(1);
    expect(result.infraRetries).toBeUndefined();
  });

  test('缺省/未知种类 ⇒ 不重试（fail-closed）', async () => {
    let calls = 0;
    const result = await runAttemptWithInfraRetry(
      'task#1',
      async () => {
        calls += 1;
        return attemptOf(undefined, undefined);
      },
      5
    );

    expect(calls).toBe(1);
    expect(result.infraRetries).toBeUndefined();
  });

  test('额度耗尽 ⇒ 停止重试并交回**最后一次真实 attempt**（共 1+limit 次调用）', async () => {
    let calls = 0;
    const result = await runAttemptWithInfraRetry(
      'task#1',
      async () => {
        calls += 1;
        return attemptOf('infra', `timeout #${calls}`);
      },
      2
    );

    expect(calls).toBe(3);
    expect(result.failureKind).toBe('infra');
    expect(result.error).toBe('timeout #3');
    expect(result.infraRetries).toBe(2);
  });

  test('上限 0（缺省）⇒ 不重试（等同旧行为：一次定成败）', async () => {
    let calls = 0;
    const result = await runAttemptWithInfraRetry(
      'task#1',
      async () => {
        calls += 1;
        return attemptOf('infra', 'timeout');
      },
      0
    );

    expect(calls).toBe(1);
    expect(result.infraRetries).toBeUndefined();
  });

  test('负数上限按 0 处理 ⇒ 不重试', async () => {
    let calls = 0;
    await runAttemptWithInfraRetry(
      'task#1',
      async () => {
        calls += 1;
        return attemptOf('infra', 'timeout');
      },
      -1
    );

    expect(calls).toBe(1);
  });

  test('重试过程对用户可见（stdout 明确标注"不计入 attempt"）', async () => {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    let calls = 0;
    try {
      process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        chunks.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;

      await runAttemptWithInfraRetry(
        'src-format-ms #1',
        async () => {
          calls += 1;
          return calls === 1
            ? attemptOf('infra', 'The operation timed out.')
            : attemptOf('assert', undefined);
        },
        2
      );
    } finally {
      process.stdout.write = original;
    }

    const out = chunks.join('');
    expect(out).toContain('src-format-ms #1');
    expect(out).toContain('重试 1/2');
    expect(out).toContain('不计入 attempt');
  });
});
