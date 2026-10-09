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
 * PR5-S1 — ExecutionStore 持久化测试（2026-10-09）
 *
 * 覆盖 `.trae/specs/durable-execution.md` §5-S1：
 * upsert 幂等 / listActive / maxGeneration / 事件 seq / tool_calls / markStale / purgeOlderThan。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync, existsSync } from 'fs';
import { ExecutionStore } from '../../src/execution/index.js';
import type {
  ExecutionGeneration,
  ExecutionId,
  ExecutionStatus,
} from '../../src/execution/types.js';

const dbPath = join(
  tmpdir(),
  `liri-exec-store-test-${Date.now()}-${Math.floor(performance.now())}.db`
);
const store = new ExecutionStore(dbPath);

const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

interface RecOverrides {
  sessionId?: string;
  generation?: ExecutionGeneration;
  status?: ExecutionStatus;
  startedAt?: number;
  updatedAt?: number;
  heartbeatAt?: number;
}

function rec(executionId: string, o: RecOverrides = {}) {
  const now = Date.now();
  return {
    executionId: eid(executionId),
    sessionId: o.sessionId ?? 's1',
    generation: o.generation ?? gen(1),
    status: o.status ?? 'RUNNING',
    startedAt: o.startedAt ?? now,
    updatedAt: o.updatedAt ?? now,
    heartbeatAt: o.heartbeatAt ?? now,
  };
}

afterAll(() => {
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
});

describe('PR5-S1 ExecutionStore', () => {
  it('upsert + get 往返；同 id upsert 幂等更新状态', async () => {
    await store.upsertExecution(rec('exec-a', { status: 'RUNNING' }));
    const got = await store.getExecution(eid('exec-a'));
    expect(got?.status).toBe('RUNNING');
    expect(got?.sessionId).toBe('s1');

    await store.upsertExecution(rec('exec-a', { status: 'COMPLETED' }));
    const after = await store.getExecution(eid('exec-a'));
    expect(after?.status).toBe('COMPLETED');
  });

  it('getExecution 不存在 ⇒ null', async () => {
    expect(await store.getExecution(eid('nope'))).toBeNull();
  });

  it('listActive 仅返回占用中（RUNNING/WAITING_USER/CANCEL_REQUESTED）', async () => {
    await store.upsertExecution(rec('a-run', { status: 'RUNNING' }));
    await store.upsertExecution(
      rec('a-cancel', { status: 'CANCEL_REQUESTED' })
    );
    await store.upsertExecution(rec('a-done', { status: 'COMPLETED' }));
    await store.upsertExecution(rec('a-stale', { status: 'STALE' }));
    const ids = (await store.listActive()).map((r) => r.executionId);
    expect(ids).toContain('a-run');
    expect(ids).toContain('a-cancel');
    expect(ids).not.toContain('a-done');
    expect(ids).not.toContain('a-stale');
  });

  it('maxGeneration 返回该 session 的最大代次', async () => {
    await store.upsertExecution(
      rec('g1', { sessionId: 'sg', generation: gen(3) })
    );
    await store.upsertExecution(
      rec('g2', { sessionId: 'sg', generation: gen(7) })
    );
    expect(await store.maxGeneration('sg')).toBe(7);
    expect(await store.maxGeneration('other')).toBe(0);
  });

  it('appendEvent：seq 自增 + payload 往返', async () => {
    const id = eid('ev-1');
    const s1 = await store.appendEvent(id, 'execution/status_changed', {
      from: 'RUNNING',
      to: 'COMPLETED',
    });
    const s2 = await store.appendEvent(id, 'execution/recovery', {
      action: 'kept',
    });
    expect(s1).toBe(1);
    expect(s2).toBe(2);
    const events = await store.listEvents(id);
    expect(events.length).toBe(2);
    expect(events[1].type).toBe('execution/recovery');
    expect((events[0].payload as { from: string }).from).toBe('RUNNING');
  });

  it('tool_calls：记录 + 结算（二次结算不再命中）', async () => {
    const id = eid('tc-1');
    await store.recordToolCall(id, 'call-1', 'BashTool');
    const running = await store.listToolCalls(id);
    expect(running[0].status).toBe('running');
    expect(running[0].endedAt).toBeUndefined();

    expect(await store.finishToolCall(id, 'call-1', 'completed')).toBe(true);
    const done = await store.listToolCalls(id);
    expect(done[0].status).toBe('completed');
    expect(typeof done[0].endedAt).toBe('number');

    // 已结算 ⇒ 不再命中
    expect(await store.finishToolCall(id, 'call-1', 'failed')).toBe(false);
  });

  it('tool_calls：recordToolCall 幂等（重复 running 不新增行）', async () => {
    const id = eid('tc-idem');
    await store.recordToolCall(id, 'c', 'T');
    await store.recordToolCall(id, 'c', 'T');
    const rows = await store.listToolCalls(id);
    expect(rows.length).toBe(1);
  });

  it('tool_calls：settleToolCall 无先记录也能结算', async () => {
    const id = eid('tc-settle');
    await store.settleToolCall(id, 'only-end', 'T', 'failed', 'boom');
    const rows = await store.listToolCalls(id);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBe('boom');
    expect(typeof rows[0].endedAt).toBe('number');
  });

  it('markStale：占用中 → STALE 且提升代次；终态不被改写', async () => {
    await store.upsertExecution(
      rec('st-1', { status: 'RUNNING', generation: gen(2) })
    );
    expect(await store.markStale(eid('st-1'), gen(3))).toBe(true);
    const row = await store.getExecution(eid('st-1'));
    expect(row?.status).toBe('STALE');
    expect(row?.generation).toBe(3);

    // 终态：markStale 不命中
    expect(await store.markStale(eid('st-1'), gen(4))).toBe(false);
  });

  it('purgeOlderThan：仅清理终态且超期记录', async () => {
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await store.upsertExecution(
      rec('p-old-terminal', { status: 'COMPLETED', updatedAt: old })
    );
    await store.upsertExecution(
      rec('p-old-active', { status: 'RUNNING', updatedAt: old })
    );
    const removed = await store.purgeOlderThan(7 * 24 * 60 * 60 * 1000);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await store.getExecution(eid('p-old-terminal'))).toBeNull();
    expect(await store.getExecution(eid('p-old-active'))).not.toBeNull();
  });
});
