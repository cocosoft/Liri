// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * A3-a（2026-09-26，《Liri 优化方案》）：沙箱获取策略与 attempt 生命周期的契约。
 *
 * 方案 A3-a 的验收是"`n=2` 时**沙箱启动次数 = 2**（可断言/日志可证）"。本文件用**假沙箱**
 * 离线断言这条契约 —— 不需要真实 daemon / DB 快照 / 模型：
 *  - `fresh` ⇒ `create` 调用次数 = attempt 数、每次结束后恰好 `stop()` 一次（**含异常路径**）；
 *  - `shared` ⇒ 不创建、不销毁（沿用改造前行为，由 `cli.ts` 统一收尾）。
 */
import { describe, expect, it } from 'bun:test';
import {
  forEachAttemptSandbox,
  forEachItemWithFreshSandbox,
  freshSandbox,
  sharedSandbox,
} from '../../src/evals/sandboxStrategy';
import type { EvalSandbox } from '../../src/evals/sandbox';

/** 假沙箱 + 记录 stop 调用（`id` 用于区分"是否重建"） */
function makeSandboxFactory(stops: number[]) {
  let created = 0;
  const create = async (): Promise<EvalSandbox> => {
    created += 1;
    const id = created;
    return {
      root: `/tmp/fake-${id}`,
      home: `/tmp/fake-${id}/home`,
      dataDir: `/tmp/fake-${id}/data`,
      workspace: `/tmp/fake-${id}/workspace`,
      port: 20_000 + id,
      baseUrl: `http://127.0.0.1:${20_000 + id}`,
      logFile: `/tmp/fake-${id}/backend.log`,
      hasCredentials: true,
      // A7 防泄题：本夹具不涉及屏蔽（真实注入见 evals/sandbox.ts）
      shieldedPaths: [],
      stop: async () => {
        stops.push(id);
      },
    };
  };
  return { create, createdCount: () => created };
}

describe('A3-a: SandboxStrategy 契约', () => {
  it('shared：全部 attempt 复用同一实例，不创建（starts 恒 0）、不销毁', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    const base = await create();
    const strategy = sharedSandbox(base);

    expect(await strategy.acquire()).toBe(base);
    expect(await strategy.acquire()).toBe(base);
    expect(strategy.starts).toBe(0);
    expect(strategy.disposeAfterAttempt).toBe(false);
    expect(createdCount()).toBe(1); // 只建了那个 base
    expect(stops).toEqual([]);
  });

  it('fresh：每次 acquire 都新建实例（starts 递增）、标记为用完即销毁', async () => {
    const stops: number[] = [];
    const { create } = makeSandboxFactory(stops);
    const strategy = freshSandbox(create);

    const first = await strategy.acquire();
    const second = await strategy.acquire();
    expect(first).not.toBe(second);
    expect(first.root).toBe('/tmp/fake-1');
    expect(second.root).toBe('/tmp/fake-2');
    expect(strategy.starts).toBe(2);
    expect(strategy.disposeAfterAttempt).toBe(true);
  });
});

describe('A3-a: forEachAttemptSandbox —— "n 次尝试 = n 次沙箱启动"（方案验收点）', () => {
  it('fresh + n=2 ⇒ 启动 2 次、各销毁 1 次、序号 1..2', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    const strategy = freshSandbox(create);

    const seen: Array<{ index: number; root: string }> = [];
    const results = await forEachAttemptSandbox(strategy, 2, async (sb, index) => {
      seen.push({ index, root: sb.root });
      return index * 10;
    });

    expect(createdCount()).toBe(2);
    expect(stops).toEqual([1, 2]);
    expect(seen).toEqual([
      { index: 1, root: '/tmp/fake-1' },
      { index: 2, root: '/tmp/fake-2' },
    ]);
    expect(results).toEqual([10, 20]);
  });

  it('shared + n=2 ⇒ 不创建、不销毁，且两次拿到同一实例', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    const base = await create();
    const strategy = sharedSandbox(base);

    const roots: string[] = [];
    await forEachAttemptSandbox(strategy, 2, async (sb) => {
      roots.push(sb.root);
    });

    expect(createdCount()).toBe(1);
    expect(stops).toEqual([]);
    expect(roots).toEqual(['/tmp/fake-1', '/tmp/fake-1']);
  });

  it('fresh + 客户端抛错 ⇒ **仍然销毁**该 attempt 的沙箱，且不继续后续 attempt', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    const strategy = freshSandbox(create);

    let calls = 0;
    await expect(
      forEachAttemptSandbox(strategy, 3, async () => {
        calls += 1;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(calls).toBe(1);
    expect(createdCount()).toBe(1);
    expect(stops).toEqual([1]); // 异常路径也销毁（否则会留下 daemon 与临时目录）
  });

  it('n=0 ⇒ 不创建任何沙箱（空跑）', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    const results = await forEachAttemptSandbox(freshSandbox(create), 0, async () => 1);
    expect(results).toEqual([]);
    expect(createdCount()).toBe(0);
    expect(stops).toEqual([]);
  });
});

describe('A3-b: forEachItemWithFreshSandbox —— "每任务一份沙箱"（任务级隔离）', () => {
  it('3 个任务 ⇒ 新建 3 次、销毁 3 次；**任务内**多次 acquire 复用同一实例', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    const rootsPerItem: string[][] = [];

    const results = await forEachItemWithFreshSandbox(
      ['task-a', 'task-b', 'task-c'],
      create,
      async (item, strategy) => {
        // 任务内的多次 attempt 必须拿到**同一个**沙箱
        const first = await strategy.acquire();
        const second = await strategy.acquire();
        rootsPerItem.push([first.root, second.root]);
        expect(strategy.disposeAfterAttempt).toBe(false); // 由本函数在任务边界销毁
        return item.toUpperCase();
      }
    );

    expect(results).toEqual(['TASK-A', 'TASK-B', 'TASK-C']);
    expect(createdCount()).toBe(3);
    expect(stops).toEqual([1, 2, 3]);
    expect(rootsPerItem).toEqual([
      ['/tmp/fake-1', '/tmp/fake-1'],
      ['/tmp/fake-2', '/tmp/fake-2'],
      ['/tmp/fake-3', '/tmp/fake-3'],
    ]);
  });

  it('任务抛错 ⇒ 该任务的沙箱仍被销毁，且不继续后续任务', async () => {
    const stops: number[] = [];
    const { create, createdCount } = makeSandboxFactory(stops);
    let calls = 0;

    await expect(
      forEachItemWithFreshSandbox(['a', 'b', 'c'], create, async () => {
        calls += 1;
        throw new Error('task boom');
      })
    ).rejects.toThrow('task boom');

    expect(calls).toBe(1);
    expect(createdCount()).toBe(1);
    expect(stops).toEqual([1]); // 异常路径也销毁（防 daemon/临时目录/凭据副本残留）
  });

  it('onCreated 逐次登记沙箱（供 CLI 收尾统一清理）', async () => {
    const stops: number[] = [];
    const { create } = makeSandboxFactory(stops);
    const registered: string[] = [];

    await forEachItemWithFreshSandbox(['a', 'b'], create, async () => null, (sb) => {
      registered.push(sb.root);
    });

    expect(registered).toEqual(['/tmp/fake-1', '/tmp/fake-2']);
  });
});
