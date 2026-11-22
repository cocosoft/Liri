// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F5（2026-11-22）：工具执行统一超时 + 取消。
 *
 * 锁三件事：① 正常返回；② 超时 ⇒ abort 派生 controller 且抛 `TOOL_EXEC_TIMEOUT`；
 * ③ 父取消转发到派生 controller（不误取消父级 / 整轮）。
 */

import { describe, expect, it } from 'bun:test';

import { runWithToolDeadline } from '../../src/tools/utils/toolDeadline';

describe('F5：工具执行 deadline', () => {
  it('未超时 ⇒ 原样返回', async () => {
    await expect(
      runWithToolDeadline(async () => 42, { timeoutMs: 1_000 })
    ).resolves.toBe(42);
  });

  it('超时 ⇒ abort 派生 controller 并抛 TOOL_EXEC_TIMEOUT', async () => {
    let aborted = false;
    const pending = runWithToolDeadline(
      (controller) =>
        new Promise<void>((resolve) => {
          controller.signal.addEventListener('abort', () => {
            aborted = true;
          });
          setTimeout(resolve, 200);
        }),
      { timeoutMs: 20 }
    );

    await expect(pending).rejects.toThrow('工具执行超时');
    expect(aborted).toBe(true);
  });

  it('父取消 ⇒ 转发到派生 controller', async () => {
    const parent = new AbortController();
    let aborted = false;
    const pending = runWithToolDeadline(
      (controller) =>
        new Promise<void>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(new Error('parent aborted'));
            },
            { once: true }
          );
        }),
      { parentSignal: parent.signal, timeoutMs: 10_000 }
    );

    parent.abort();
    await expect(pending).rejects.toThrow('parent aborted');
    expect(aborted).toBe(true);
  });
});
