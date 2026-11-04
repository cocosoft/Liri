/**
 * P1-1 回归（2026-11-04，《运行态问题排查与修复方案》）：响应体读取阶段的连接重置。
 *
 * 实测缺陷：`provider 聊天失败 provider=DeepSeek ECONNRESET` 32 次/窗口，并连带
 * `compaction:tier3_fold_batch_error`。既有重试只覆盖两种情形：
 *   - `fetchWithConnectionRetry`：`fetch()` 本身抛出的连接期错误（TypeError / ConnectionRefused）；
 *   - `withRetry`：仅 429/529 退避。
 * 而 ECONNRESET 发生在**响应头已返回、body 读到一半** ⇒ 一路冒泡为 High severity。
 *
 * 本用例锁三件事：
 *   ① 分类只收「连接重置」这一类，AbortError 与业务错误必须排除；
 *   ② 非流式：重置重试**一次**即成功；再次重置仍失败（有界，不无限重试）；
 *   ③ 流式：只有**首包前**才重试；已产出 chunk 后失败不重试（无法撤回已下发内容）。
 */
import { describe, it, expect } from 'bun:test';

import { BaseAIProvider } from '../../src/ai/providers/BaseAIProvider.js';

/** `protected static` 成员经类型断言访问（不改生产可见性） */
type BaseInternals = {
  isRetryableBodyResetError(error: unknown): boolean;
  measureChat<T>(
    label: string,
    fn: () => Promise<T>,
    maxRetries?: number
  ): Promise<T>;
  wrapChatStreamMeasure<T, TReturn = void>(
    label: string,
    createStream: () => AsyncGenerator<T, TReturn>,
    maxRetries?: number
  ): AsyncGenerator<T, TReturn>;
};

const Base = BaseAIProvider as unknown as BaseInternals;

const resetError = () => {
  const err = new Error('read ECONNRESET') as Error & { code?: string };
  err.code = 'ECONNRESET';
  return err;
};

const socketError = () => {
  const err = new Error('other side closed') as Error & { code?: string };
  err.code = 'UND_ERR_SOCKET';
  return err;
};

async function* genOf<T>(chunks: T[]): AsyncGenerator<T, void> {
  for (const chunk of chunks) yield chunk;
}

describe('P1-1：连接重置分类', () => {
  it('ECONNRESET / UND_ERR_SOCKET / socket hang up / EPIPE ⇒ 可重试', () => {
    expect(Base.isRetryableBodyResetError(resetError())).toBe(true);
    expect(Base.isRetryableBodyResetError(socketError())).toBe(true);
    expect(Base.isRetryableBodyResetError(new Error('socket hang up'))).toBe(
      true
    );
    expect(
      Base.isRetryableBodyResetError(
        Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
      )
    ).toBe(true);
  });

  it('主动取消与业务/HTTP 错误绝不归入（避免把用户中止变成重试）', () => {
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    expect(Base.isRetryableBodyResetError(abort)).toBe(false);
    expect(
      Base.isRetryableBodyResetError(
        Object.assign(new Error('ECONNRESET'), { name: 'AbortError' })
      )
    ).toBe(false);
    expect(Base.isRetryableBodyResetError(new Error('400 Bad Request'))).toBe(
      false
    );
    expect(Base.isRetryableBodyResetError(null)).toBe(false);
    expect(Base.isRetryableBodyResetError('ECONNRESET')).toBe(false);
  });
});

describe('P1-1：非流式重试一次', () => {
  it('首次重置、第二次成功 ⇒ 返回结果（共请求 2 次）', async () => {
    let calls = 0;
    const result = await Base.measureChat('P1-1-Test', async () => {
      calls++;
      if (calls === 1) throw resetError();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('连续两次重置 ⇒ 抛出（有界，第三次请求不会发生）', async () => {
    let calls = 0;
    await expect(
      Base.measureChat('P1-1-Test', async () => {
        calls++;
        throw socketError();
      })
    ).rejects.toThrow(/other side closed/);
    expect(calls).toBe(2);
  });

  it('非连接重置错误不重试（只调用一次）', async () => {
    let calls = 0;
    await expect(
      Base.measureChat('P1-1-Test', async () => {
        calls++;
        throw new Error('400 Bad Request');
      })
    ).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it('AbortError 不重试（用户中止必须立刻结束）', async () => {
    let calls = 0;
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    await expect(
      Base.measureChat('P1-1-Test', async () => {
        calls++;
        throw abort;
      })
    ).rejects.toThrow(/aborted/);
    expect(calls).toBe(1);
  });
});

describe('P1-1：流式仅在首包前重试', () => {
  it('首包前重置 ⇒ 重建流转发全部 chunk（工厂调用 2 次）', async () => {
    let factories = 0;
    const chunks: string[] = [];
    const stream = Base.wrapChatStreamMeasure('P1-1-Test', () => {
      factories++;
      if (factories === 1) {
        return (async function* () {
          throw resetError();
        })();
      }
      return genOf(['a', 'b']);
    });

    for await (const chunk of stream) chunks.push(chunk as string);
    expect(chunks).toEqual(['a', 'b']);
    expect(factories).toBe(2);
  });

  it('已产出 chunk 后重置 ⇒ 不重试，错误照常上抛', async () => {
    let factories = 0;
    const chunks: string[] = [];
    const stream = Base.wrapChatStreamMeasure('P1-1-Test', () => {
      factories++;
      return (async function* () {
        yield 'first';
        throw resetError();
      })();
    });

    const consume = async () => {
      for await (const chunk of stream) chunks.push(chunk as string);
    };
    await expect(consume()).rejects.toThrow(/ECONNRESET/);
    expect(chunks).toEqual(['first']);
    expect(factories).toBe(1);
  });

  it('首包前业务错误不重试（只建一条流）', async () => {
    let factories = 0;
    const stream = Base.wrapChatStreamMeasure('P1-1-Test', () => {
      factories++;
      return (async function* () {
        throw new Error('400 Bad Request');
      })();
    });
    await expect(
      (async () => {
        for await (const _ of stream) void _;
      })()
    ).rejects.toThrow(/400/);
    expect(factories).toBe(1);
  });
});
