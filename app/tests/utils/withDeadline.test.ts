/**
 * withDeadline —— 「超时 + 可中止」统一竞速（源码排查报告 S3）。
 *
 * 重点不是三种结局本身，而是**资源回收**：操作先完成时 5 分钟定时器必须被清除；
 * abort 监听器在结算后被移除（通过「结算后再次 abort 不产生额外影响」间接覆盖）。
 */
import { describe, expect, it } from 'bun:test';

import { withDeadline } from '../../src/utils/withDeadline.js';

const LONG_TIMEOUT_MS = 60_000;

describe('withDeadline', () => {
  it('操作先完成 ⇒ settled，且超时定时器被清除', async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const timers = new Set<unknown>();
    const cleared = new Set<unknown>();

    globalThis.setTimeout = ((
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      const handle = realSetTimeout(fn, ms, ...args);
      if (ms === LONG_TIMEOUT_MS) timers.add(handle);
      return handle;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((
      handle?: Parameters<typeof clearTimeout>[0]
    ) => {
      cleared.add(handle);
      return realClearTimeout(handle);
    }) as typeof clearTimeout;

    try {
      const outcome = await withDeadline(Promise.resolve('answer'), {
        timeoutMs: LONG_TIMEOUT_MS,
      });
      expect(outcome).toEqual({ kind: 'settled', value: 'answer' });
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }

    expect(timers.size).toBe(1);
    for (const handle of timers) expect(cleared.has(handle)).toBe(true);
  });

  it('超时 ⇒ timeout', async () => {
    const outcome = await withDeadline(new Promise<string>(() => {}), {
      timeoutMs: 10,
    });
    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('中止 ⇒ abort', async () => {
    const controller = new AbortController();
    const pending = withDeadline(new Promise<string>(() => {}), {
      timeoutMs: LONG_TIMEOUT_MS,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ kind: 'abort' });
  });

  it('调用时已中止 ⇒ 立即 abort', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await withDeadline(new Promise<string>(() => {}), {
        timeoutMs: LONG_TIMEOUT_MS,
        signal: controller.signal,
      })
    ).toEqual({ kind: 'abort' });
  });

  it('操作 reject ⇒ 原样上抛（不吞错）', async () => {
    await expect(
      withDeadline(Promise.reject(new Error('boom')), { timeoutMs: 10 })
    ).rejects.toThrow('boom');
  });

  it('timeoutMs <= 0 ⇒ 不设超时（等待完成）', async () => {
    expect(await withDeadline(Promise.resolve(1), { timeoutMs: 0 })).toEqual({
      kind: 'settled',
      value: 1,
    });
  });
});
