/**
 * 退出链有界化（P0-2，2026-11-14）
 *
 * 重点：**永不 settle 的清理钩子不得让退出链无限挂起** —— 上界一到即记为超时并继续，
 * 其余钩子仍会执行；失败钩子同样只留痕、不阻断。
 */
import { describe, expect, it } from 'bun:test';

import {
  runShutdownHooks,
  SHUTDOWN_HOOK_TIMEOUT_MS,
} from '../../src/bootstrap/shutdownHooks.js';

const HOOK_TIMEOUT_MS = 20;

describe('runShutdownHooks', () => {
  it('默认上界为 8s', () => {
    expect(SHUTDOWN_HOOK_TIMEOUT_MS).toBe(8_000);
  });

  it('永不 resolve 的钩子 ⇒ 超时点名，且不阻塞其余钩子', async () => {
    const ran: string[] = [];
    const result = await runShutdownHooks(
      [
        { name: 'stuck', run: () => new Promise<never>(() => {}) },
        {
          name: 'healthy',
          run: async () => {
            ran.push('healthy');
          },
        },
      ],
      { timeoutMs: HOOK_TIMEOUT_MS }
    );

    expect(result.timedOut).toEqual(['stuck']);
    expect(result.failed).toEqual([]);
    expect(ran).toEqual(['healthy']);
  });

  it('钩子 reject ⇒ 记入 failed，不抛错', async () => {
    const result = await runShutdownHooks(
      [
        {
          name: 'boom',
          run: () => Promise.reject(new Error('boom')),
        },
      ],
      { timeoutMs: HOOK_TIMEOUT_MS }
    );

    expect(result).toEqual({ timedOut: [], failed: ['boom'] });
  });

  it('全部成功 ⇒ 两张名单皆空', async () => {
    const result = await runShutdownHooks(
      [
        { name: 'a', run: async () => 1 },
        { name: 'b', run: async () => undefined },
      ],
      { timeoutMs: HOOK_TIMEOUT_MS }
    );

    expect(result).toEqual({ timedOut: [], failed: [] });
  });
});
