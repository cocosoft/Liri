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
import { Database } from '@openliri/kernel/external/sqlite3.js';
import {
  TOOL_CALL_STATUSES,
  TOOL_CALL_TERMINAL_STATUSES,
  canTransitionToolCall,
  isToolCallStatus,
} from '../../src/execution/types.js';
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

  it('G13：recordToolCall 跨结算仍幂等（同 (execution,toolCallId) 不新增行）', async () => {
    // 修复前：判据含 `ended_at IS NULL` ⇒ 结算后重放会插入第 2 行（ID 碰撞即错行结算的机制）
    const id = eid('tc-g13-idem');
    await store.recordToolCall(id, 'dup', 'T');
    await store.settleToolCall(id, 'dup', 'T', 'completed');
    await store.recordToolCall(id, 'dup', 'T'); // 重放
    const rows = await store.listToolCalls(id);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('completed'); // 已有终态不被重放改写
  });

  it('G13：tool_calls 唯一索引 (execution_id, tool_call_id) 已建立', async () => {
    // 触发建表 / 建索引
    await store.recordToolCall(eid('tc-g13-idx'), 'x', 'T');
    const db = await new Promise<Database>((resolve, reject) => {
      const d = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(d)
      );
    });
    const names = await new Promise<string[]>((resolve, reject) => {
      db.all(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='uq_tool_calls_exec_tcid'`,
        (err: Error | null, rows: Array<{ name: string }>) =>
          err ? reject(err) : resolve(rows.map((r) => r.name))
      );
    });
    db.close();
    expect(names).toContain('uq_tool_calls_exec_tcid');
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

describe('G14 工具调用状态语义化（S2-1）', () => {
  it('枚举 / 终态 / 转移表自洽（唯一事实源）', () => {
    expect([...TOOL_CALL_STATUSES]).toEqual([
      'running',
      'completed',
      'failed',
      'unknown',
    ]);
    expect([...TOOL_CALL_TERMINAL_STATUSES]).toEqual([
      'completed',
      'failed',
      'unknown',
    ]);
    // running 只可走向三个终态
    expect(canTransitionToolCall('running', 'completed')).toBe(true);
    expect(canTransitionToolCall('running', 'failed')).toBe(true);
    expect(canTransitionToolCall('running', 'unknown')).toBe(true);
    // 终态无出边
    expect(canTransitionToolCall('completed', 'running')).toBe(false);
    expect(canTransitionToolCall('unknown', 'completed')).toBe(false);
    // 自反为假
    expect(canTransitionToolCall('running', 'running')).toBe(false);
    // 运行期守卫（用于 DB 读回 / 外部入参）
    expect(isToolCallStatus('running')).toBe(true);
    expect(isToolCallStatus('bogus')).toBe(false);
  });

  it('非终态 status 不得经结算路径写入（finishToolCall 拒绝 running）', async () => {
    const id = eid('tc-g14-nonterminal');
    await store.recordToolCall(id, 'c', 'T');
    expect(await store.finishToolCall(id, 'c', 'running')).toBe(false);
    const rows = await store.listToolCalls(id);
    expect(rows[0].status).toBe('running');
    expect(rows[0].endedAt).toBeUndefined();
  });
});

/**
 * D6（2026-10-11 用户裁定「仅事务化」）：`ExecutionStore.transaction()` 原子性。
 *
 * 用途：崩溃恢复的"两步"（标 unknown → 置 STALE）同事务 —— 任一步失败 ⇒ **整体回滚**
 * （消除"只落其一"的残留窗口）。此处对事务原语本身做原子性验证。
 */
describe('D6 事务化（ExecutionStore.transaction）', () => {
  it('成功 ⇒ COMMIT（写入持久化）', async () => {
    const id = eid('tx-commit');
    await store.transaction(async () => {
      await store.upsertExecution(rec('tx-commit', { status: 'RUNNING' }));
    });
    expect((await store.getExecution(id))?.status).toBe('RUNNING');
  });

  it('fn 抛错 ⇒ ROLLBACK（事务内写入**不落盘**，且错误上抛）', async () => {
    const id = eid('tx-rollback');
    await expect(
      store.transaction(async () => {
        await store.upsertExecution(rec('tx-rollback', { status: 'RUNNING' }));
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // 回滚生效：该执行不存在（若只 COMMIT 一半则会读到 RUNNING）
    expect(await store.getExecution(id)).toBeNull();
  });
});
