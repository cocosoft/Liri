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
 * 第九轮审查「专项 B」执行生命周期加固 回归测试（2026-10-09）
 *
 * 覆盖 B-01..B-05（依据 `dev_docs/20261009/openai 建议.md` §十一–§十六 / §十七 修复顺序）：
 * - **B-01** 恢复后重建"外部占用"（不并存第二个 RUNNING）；STALE 时解除占用
 * - **B-02** 恢复顺序：**先标 unknown、再置 STALE**（闭合二次崩溃窗口）
 * - **B-03** 并发 `appendEvent` ⇒ `seq` 唯一且连续（进程内串行化）
 * - **B-04** `QUEUED` 走统一取消入口 ⇒ 直接 `CANCELLED`（不再恒返回 false）
 * - **B-05** `beginToolCall` **可等待**：未接入 store ⇒ true；落盘失败 ⇒ false
 */

import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ExecutionManager, ExecutionStore } from '../../src/execution/index.js';
import type {
  ExecutionGeneration,
  ExecutionId,
  ExecutionStatus,
} from '../../src/execution/types.js';

const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

const createdDbs: string[] = [];
function mkTmp(): string {
  const p = join(
    tmpdir(),
    `liri-exec-b-${Date.now()}-${Math.floor(performance.now())}.db`
  );
  createdDbs.push(p);
  return p;
}

function rec(
  executionId: string,
  o: {
    sessionId?: string;
    status?: ExecutionStatus;
    heartbeatAt?: number;
  } = {}
) {
  const now = Date.now();
  return {
    executionId: eid(executionId),
    sessionId: o.sessionId ?? 's1',
    generation: gen(1),
    status: o.status ?? 'RUNNING',
    startedAt: now,
    updatedAt: now,
    heartbeatAt: o.heartbeatAt ?? now,
  };
}

afterAll(() => {
  for (const dbPath of createdDbs) {
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          // @ignore-catch — 测试清理：Windows 下可能仍被占用
        }
      }
    }
  }
});

describe('B-01 恢复后重建外部占用（不并存第二个 RUNNING）', () => {
  it('kept（心跳新鲜）⇒ 该 session 的 acquire 只发 QUEUED', async () => {
    const store = new ExecutionStore(mkTmp());
    await store.upsertExecution(
      rec('exec-kept', {
        sessionId: 's-kept',
        status: 'RUNNING',
        heartbeatAt: Date.now(),
      })
    );
    const mgr = new ExecutionManager();
    mgr.attachStore(store);

    const r = await mgr.recover();
    expect(r.kept).toBe(1);

    const lease = mgr.acquire('s-kept');
    expect(mgr.get(lease.executionId)?.status).toBe('QUEUED');
    store.close();
  });

  it('stale（心跳陈旧）⇒ 置 STALE 并解除占用（下个 acquire 可为 RUNNING）', async () => {
    const store = new ExecutionStore(mkTmp());
    await store.upsertExecution(
      rec('exec-stale', {
        sessionId: 's-stale',
        status: 'RUNNING',
        heartbeatAt: Date.now() - 10 * 60_000,
      })
    );
    const mgr = new ExecutionManager();
    mgr.attachStore(store);

    const r = await mgr.recover({ staleMs: 60_000 });
    expect(r.recovered).toBe(1);

    const lease = mgr.acquire('s-stale');
    expect(mgr.get(lease.executionId)?.status).toBe('RUNNING');
    store.close();
  });
});

describe('B-02 恢复顺序：先 unknown 再 STALE', () => {
  it('调用顺序 = [markUnsettledToolCallsUnknown, markStale]', async () => {
    const store = new ExecutionStore(mkTmp());
    await store.upsertExecution(
      rec('exec-o', {
        sessionId: 's-o',
        status: 'RUNNING',
        heartbeatAt: Date.now() - 10 * 60_000,
      })
    );
    const order: string[] = [];
    const s1 = spyOn(store, 'markUnsettledToolCallsUnknown').mockImplementation(
      (async () => {
        order.push('unknown');
        return 1;
      }) as unknown as typeof store.markUnsettledToolCallsUnknown
    );
    const s2 = spyOn(store, 'markStale').mockImplementation((async () => {
      order.push('stale');
      return true;
    }) as unknown as typeof store.markStale);

    const mgr = new ExecutionManager();
    mgr.attachStore(store);
    await mgr.recover({ staleMs: 60_000 });

    expect(order).toEqual(['unknown', 'stale']);
    s1.mockRestore();
    s2.mockRestore();
    store.close();
  });
});

describe('B-03 appendEvent 并发串行化', () => {
  it('同一 executionId 并发 20 次 ⇒ seq 唯一且为 1..20', async () => {
    const store = new ExecutionStore(mkTmp());
    const seqs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.appendEvent(eid('exec-c'), 'execution/test', { i })
      )
    );
    expect(new Set(seqs).size).toBe(20);
    expect([...seqs].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    store.close();
  });
});

describe('B-04 统一取消入口覆盖 QUEUED', () => {
  it('QUEUED ⇒ requestCancel 直接 CANCELLED；RUNNING ⇒ CANCEL_REQUESTED（既有语义不变）', () => {
    const mgr = new ExecutionManager();
    const l1 = mgr.acquire('s-b4'); // RUNNING（取得所有权）
    const l2 = mgr.acquire('s-b4'); // QUEUED（被占用）
    expect(mgr.get(l2.executionId)?.status).toBe('QUEUED');

    expect(mgr.requestCancel(l2.executionId, 'user')).toBe(true);
    expect(mgr.get(l2.executionId)?.status).toBe('CANCELLED');

    expect(mgr.requestCancel(l1.executionId, 'user')).toBe(true);
    expect(mgr.get(l1.executionId)?.status).toBe('CANCEL_REQUESTED');
  });
});

describe('B-05 beginToolCall 可等待', () => {
  it('未接入 store ⇒ true（纯内存，与 opt-in 语义一致）', async () => {
    const mgr = new ExecutionManager();
    expect(await mgr.beginToolCall(eid('e'), 'tc', 'BashTool')).toBe(true);
  });

  it('落盘失败 ⇒ false（调用方据此拒绝"已记账"保证）', async () => {
    const store = new ExecutionStore(mkTmp());
    const mgr = new ExecutionManager();
    mgr.attachStore(store);
    const spy = spyOn(store, 'recordToolCall').mockImplementation((async () => {
      throw new Error('disk full');
    }) as unknown as typeof store.recordToolCall);

    expect(await mgr.beginToolCall(eid('e'), 'tc', 'BashTool')).toBe(false);
    spy.mockRestore();
    store.close();
  });
});
