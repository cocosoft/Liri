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
 * PR5-S2 — ExecutionManager 写穿 + `recover()` 测试（2026-10-09）
 *
 * 覆盖 `.trae/specs/durable-execution.md` §5-⑩：
 * 重启后 RUNNING + 陈旧心跳 ⇒ STALE + generation++，且同 session 新 acquire 得 RUNNING
 * （不被孤儿阻塞）；心跳不陈旧 ⇒ 保留。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync, existsSync } from 'fs';
import { ExecutionManager } from '../../src/execution/ExecutionManager.js';
import { ExecutionStore } from '../../src/execution/ExecutionStore.js';
import type {
  ExecutionGeneration,
  ExecutionId,
} from '../../src/execution/types.js';

let dbSeq = 0;
const open: Array<{ store: ExecutionStore; dbPath: string }> = [];

/** 每个用例独立库（避免跨用例 listActive 串扰） */
function makeStore(): ExecutionStore {
  const dbPath = join(
    tmpdir(),
    `liri-exec-recover-${Date.now()}-${dbSeq++}.db`
  );
  const store = new ExecutionStore(dbPath);
  open.push({ store, dbPath });
  return store;
}

const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

/** 等待写穿（best-effort fire-and-forget）落盘 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

afterAll(() => {
  for (const { store, dbPath } of open) {
    store.close();
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

describe('PR5-S2 写穿', () => {
  it('acquire/heartbeat/complete 写穿到 store', async () => {
    const store = makeStore();
    const m = new ExecutionManager();
    m.attachStore(store);

    const lease = m.acquire('s1', 'm1');
    await flush();
    let row = await store.getExecution(lease.executionId);
    expect(row?.status).toBe('RUNNING');
    expect(row?.sessionId).toBe('s1');

    const before = row?.heartbeatAt ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    m.heartbeat(lease.executionId);
    await flush();
    row = await store.getExecution(lease.executionId);
    expect(row?.heartbeatAt ?? 0).toBeGreaterThanOrEqual(before);

    m.complete(lease.executionId);
    await flush();
    row = await store.getExecution(lease.executionId);
    expect(row?.status).toBe('COMPLETED');
  });

  it('未接入 store ⇒ recover 为 no-op', async () => {
    const m = new ExecutionManager();
    expect(await m.recover()).toEqual({ recovered: 0, kept: 0 });
  });
});

describe('PR5-S2 启动期恢复（⑩）', () => {
  it('陈旧心跳 ⇒ STALE + generation++，且同 session 新 acquire 得 RUNNING', async () => {
    const store = makeStore();
    const old = Date.now() - 10 * 60 * 1000;
    await store.upsertExecution({
      executionId: eid('orphan-1'),
      sessionId: 's-recover',
      generation: gen(5),
      status: 'RUNNING',
      startedAt: old,
      updatedAt: old,
      heartbeatAt: old,
    });

    // 模拟"重启"：新 manager + 同一 store
    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });

    expect(report.recovered).toBe(1);
    expect(report.kept).toBe(0);
    const row = await store.getExecution(eid('orphan-1'));
    expect(row?.status).toBe('STALE');
    expect(row?.generation).toBe(6);

    // 该 session 未被孤儿阻塞 ⇒ 新执行 RUNNING，且代次严格大于孤儿（6）
    const lease = m.acquire('s-recover', 'm2');
    expect(m.get(lease.executionId)?.status).toBe('RUNNING');
    expect(lease.generation).toBeGreaterThan(6);
  });

  it('心跳不陈旧 ⇒ 保留（kept，不改状态）', async () => {
    const store = makeStore();
    const now = Date.now();
    await store.upsertExecution({
      executionId: eid('fresh-1'),
      sessionId: 's-keep',
      generation: gen(2),
      status: 'RUNNING',
      startedAt: now,
      updatedAt: now,
      heartbeatAt: now,
    });

    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });

    expect(report.recovered).toBe(0);
    expect(report.kept).toBe(1);
    const row = await store.getExecution(eid('fresh-1'));
    expect(row?.status).toBe('RUNNING');
    expect(row?.generation).toBe(2);
  });

  it('恢复写入 execution_events 审计（action=stale）', async () => {
    const store = makeStore();
    const old = Date.now() - 10 * 60 * 1000;
    await store.upsertExecution({
      executionId: eid('orphan-ev'),
      sessionId: 's-ev',
      generation: gen(1),
      status: 'CANCEL_REQUESTED',
      startedAt: old,
      updatedAt: old,
      heartbeatAt: old,
    });
    const m = new ExecutionManager();
    m.attachStore(store);
    await m.recover({ staleMs: 90_000 });

    const events = await store.listEvents(eid('orphan-ev'));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('execution/recovery');
    expect((events[0].payload as { action: string }).action).toBe('stale');
  });
});

describe('R3（第九轮 §2.2）崩溃窗口：未知执行结果留痕', () => {
  it('恢复为 STALE ⇒ 未结算工具调用标 `unknown`，已结算不受影响', async () => {
    const store = makeStore();
    const old = Date.now() - 10 * 60 * 1000;
    const orphan = eid('orphan-tc');
    await store.upsertExecution({
      executionId: orphan,
      sessionId: 's-tc',
      generation: gen(3),
      status: 'RUNNING',
      startedAt: old,
      updatedAt: old,
      heartbeatAt: old,
    });
    // 崩溃时点：一次"已开始未结算"（外部副作用是否完成**不可知**）
    await store.recordToolCall(orphan, 'tc-unsettled', 'bash', old);
    // 对照：一次**已结算** ⇒ 不应被改
    await store.recordToolCall(orphan, 'tc-done', 'bash', old);
    await store.settleToolCall(
      orphan,
      'tc-done',
      'bash',
      'completed',
      undefined,
      old + 1
    );

    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });
    expect(report.recovered).toBe(1);

    const calls = await store.listToolCalls(orphan);
    const byId = new Map(calls.map((c) => [c.toolCallId, c]));
    expect(byId.get('tc-unsettled')?.status).toBe('unknown');
    expect(byId.get('tc-unsettled')?.endedAt).toBeGreaterThan(0);
    expect(byId.get('tc-done')?.status).toBe('completed');

    // 审计事件带 unsettledToolCalls=1（恢复侧据此**不盲目重放不可逆操作**）
    const events = await store.listEvents(orphan);
    const stale = events.find(
      (e) => (e.payload as { action?: string }).action === 'stale'
    );
    expect(
      (stale?.payload as { unsettledToolCalls?: number }).unsettledToolCalls
    ).toBe(1);
  });

  it('无未结算工具调用 ⇒ unsettledToolCalls=0（不误标）', async () => {
    const store = makeStore();
    const old = Date.now() - 10 * 60 * 1000;
    const orphan = eid('orphan-tc0');
    await store.upsertExecution({
      executionId: orphan,
      sessionId: 's-tc0',
      generation: gen(1),
      status: 'RUNNING',
      startedAt: old,
      updatedAt: old,
      heartbeatAt: old,
    });
    const m = new ExecutionManager();
    m.attachStore(store);
    await m.recover({ staleMs: 90_000 });

    const events = await store.listEvents(orphan);
    const stale = events.find(
      (e) => (e.payload as { action?: string }).action === 'stale'
    );
    expect(
      (stale?.payload as { unsettledToolCalls?: number }).unsettledToolCalls
    ).toBe(0);
  });
});
