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
 * 专项 C —— **事件持久化 / 会话一致性 / 事件回放** 回归测试清单（2026-10-10）。
 *
 * 对应 `dev_docs/20261009/openai 建议.md` §「专项 C 测试清单」8 项：
 *  ① 并发事件追加        ② 恢复阶段崩溃注入（另见 `recoveryFaultInjection.test.ts`）
 *  ③ 工具执行前写入失败  ④ 消息与事件交叉故障      ⑤ 重复回放
 *  ⑥ 未知调用恢复        ⑦ 会话隔离                ⑧ 旧数据兼容
 *
 * 说明（**诚实边界**）：
 *  - ③ 已在 `chatManagerToolLedgerFailClosed.test.ts`（执行者侧）与
 *    `executionReviewBatchB.test.ts` B-05 覆盖，本文件补**存储层**独立视角。
 *  - ④ 的**完整**"会话消息历史 ↔ 执行事件"一致性（C-04）涉及更广的会话存储面，本文件
 *    覆盖可确证的一轴：**执行记录 ↔ 执行事件**的交叉故障与孤立记录处理，并如实标注。
 *  - ⑤⑥⑦ 为**设计不变量**（未知结果不得盲目重放；不得跨会话串扰），非确认缺陷。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@modules/core/external/sqlite3';
import {
  ExecutionManager,
  ExecutionStore,
  EXECUTION_EVENTS_TABLE,
  EXECUTIONS_TABLE,
  TOOL_CALLS_TABLE,
} from '../../src/execution/index.js';
import type {
  ExecutionGeneration,
  ExecutionId,
} from '../../src/execution/types.js';

const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

const roots: string[] = [];
const stores: ExecutionStore[] = [];

function makeDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-special-c-'));
  roots.push(root);
  return join(root, 'exec.db');
}

function openStore(dbPath: string): ExecutionStore {
  const store = new ExecutionStore(dbPath);
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length > 0) stores.pop()!.close();
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // @ignore-catch — Windows 下 sqlite 句柄可能尚未释放
    }
  }
});

/** 原始库执行（预置"旧数据/孤立记录"用） */
async function rawRun(
  dbPath: string,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  const db = await new Promise<Database>((resolve, reject) => {
    const d = new Database(dbPath, (err: Error | null) =>
      err ? reject(err) : resolve(d)
    );
  });
  await new Promise<void>((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => (err ? reject(err) : resolve()));
  });
  db.close();
}

async function seedExec(
  store: ExecutionStore,
  execId: string,
  sessionId: string,
  o: { status?: string; generation?: number; heartbeatAgeMs?: number } = {}
): Promise<void> {
  const now = Date.now();
  const hb = now - (o.heartbeatAgeMs ?? 0);
  await store.upsertExecution({
    executionId: eid(execId),
    sessionId,
    generation: gen(o.generation ?? 1),
    status: (o.status ?? 'RUNNING') as never,
    startedAt: hb,
    updatedAt: hb,
    heartbeatAt: hb,
  });
}

// ─────────────────────────────────────────────────────────────
// ① 并发事件追加
// ─────────────────────────────────────────────────────────────

describe('专项 C-① 并发事件追加：唯一 + 可读回 + 有序', () => {
  it('同一 executionId 并发 100 次 appendEvent ⇒ seq 唯一、连续、全部可读回', async () => {
    const store = openStore(makeDbPath());
    const exec = eid('exec-c1');

    const seqs = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        store.appendEvent(exec, 'execution/test', { i })
      )
    );

    // 唯一
    expect(new Set(seqs).size).toBe(100);
    // 连续 1..100
    expect([...seqs].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1)
    );
    // 全部可读回且按 seq 升序
    const events = await store.listEvents(exec);
    expect(events.length).toBe(100);
    expect(events.map((e) => e.seq)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1)
    );
  });
});

// ─────────────────────────────────────────────────────────────
// ② 恢复阶段崩溃注入（紧凑版；完整矩阵见 recoveryFaultInjection.test.ts）
// ─────────────────────────────────────────────────────────────

describe('专项 C-② 恢复阶段崩溃注入：重启后终态一致', () => {
  it('崩溃于 markStale 之后 ⇒ 重启收敛为 STALE，工具调用不为 running', async () => {
    const dbPath = makeDbPath();
    {
      const s = openStore(dbPath);
      await seedExec(s, 'exec-c2', 's-c2', { heartbeatAgeMs: 600_000 });
      await s.recordToolCall(eid('exec-c2'), 'tc', 'BashTool');
      s.close();
    }
    {
      const s = openStore(dbPath);
      const spy = spyOn(s, 'markStale').mockImplementation((async () => {
        throw new Error('SIMULATED_CRASH_AFTER:markStale');
      }) as unknown as typeof s.markStale);
      const m = new ExecutionManager();
      m.attachStore(s);
      await expect(m.recover({ staleMs: 90_000 })).rejects.toThrow(
        'SIMULATED_CRASH'
      );
      // 注意：此处 mock 未执行真实 markStale ⇒ 执行仍 active，等价"崩溃于 markStale 提交前"
      spy.mockRestore();
      s.close();
    }
    const s2 = openStore(dbPath);
    const m2 = new ExecutionManager();
    m2.attachStore(s2);
    await m2.recover({ staleMs: 90_000 });
    const row = await s2.getExecution(eid('exec-c2'));
    const tools = await s2.listToolCalls(eid('exec-c2'));
    expect(row?.status).toBe('STALE');
    expect(tools.map((t) => t.status)).not.toContain('running');
    s2.close();
  });
});

// ─────────────────────────────────────────────────────────────
// ③ 工具执行前写入失败
// ─────────────────────────────────────────────────────────────

describe('专项 C-③ 工具执行前写入失败 ⇒ 不得在无可靠记录时执行', () => {
  it('recordToolCall 落盘失败 ⇒ beginToolCall=false（调用方据此拒绝执行）', async () => {
    const store = openStore(makeDbPath());
    const spy = spyOn(store, 'recordToolCall').mockImplementation((async () => {
      throw new Error('disk full');
    }) as unknown as typeof store.recordToolCall);
    const m = new ExecutionManager();
    m.attachStore(store);

    expect(await m.beginToolCall(eid('e'), 'tc', 'BashTool')).toBe(false);
    spy.mockRestore();
    store.close();
  });

  it('落盘成功 ⇒ beginToolCall=true 且记录真实存在（running）', async () => {
    const store = openStore(makeDbPath());
    const m = new ExecutionManager();
    m.attachStore(store);

    expect(await m.beginToolCall(eid('e'), 'tc', 'BashTool')).toBe(true);
    const tools = await store.listToolCalls(eid('e'));
    expect(tools.length).toBe(1);
    expect(tools[0].status).toBe('running');
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────
// ④ 消息与事件交叉故障（执行记录 ↔ 执行事件轴）
// ─────────────────────────────────────────────────────────────

describe('专项 C-④ 记录 ↔ 事件交叉故障', () => {
  it('事件写入失败、执行记录写入成功 ⇒ 状态不丢（记录权威），恢复可收敛', async () => {
    const dbPath = makeDbPath();
    const store = openStore(dbPath);
    await seedExec(store, 'exec-c4a', 's-c4a', { heartbeatAgeMs: 600_000 });
    // 事件面永久失败
    const spy = spyOn(store, 'appendEvent').mockImplementation((async () => {
      throw new Error('event store unavailable');
    }) as unknown as typeof store.appendEvent);
    const m = new ExecutionManager();
    m.attachStore(store);
    await expect(m.recover({ staleMs: 90_000 })).rejects.toThrow(
      'event store unavailable'
    );
    // 关键：**执行记录**（状态权威）已落 STALE，事件（观测面）失败不改变状态
    const row = await store.getExecution(eid('exec-c4a'));
    expect(row?.status).toBe('STALE');
    spy.mockRestore();
    store.close();

    // 重启后：listActive 不含 STALE ⇒ 恢复不再处理，不抛错
    const s2 = openStore(dbPath);
    const m2 = new ExecutionManager();
    m2.attachStore(s2);
    await expect(m2.recover({ staleMs: 90_000 })).resolves.toEqual({
      recovered: 0,
      kept: 0,
      unknownToolCalls: [],
    });
    s2.close();
  });

  it('孤立事件（有事件、无执行记录）⇒ 恢复不崩溃、不凭空造执行', async () => {
    const dbPath = makeDbPath();
    {
      const s = openStore(dbPath);
      await s.appendEvent(eid('orphan-event-exec'), 'execution/test', {
        note: 'no execution row',
      });
      s.close();
    }
    const s2 = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(s2);
    await expect(m.recover({ staleMs: 90_000 })).resolves.toEqual({
      recovered: 0,
      kept: 0,
      unknownToolCalls: [],
    });
    // 不凭空造执行
    expect(await s2.getExecution(eid('orphan-event-exec'))).toBeNull();
    expect(await s2.listActive()).toEqual([]);
    s2.close();
  });
});

// ─────────────────────────────────────────────────────────────
// ⑤ 重复回放
// ─────────────────────────────────────────────────────────────

describe('专项 C-⑤ 重复回放：幂等，不重复抬升/执行', () => {
  it('同一恢复流程重复执行 5 次 ⇒ 状态与代次稳定', async () => {
    const dbPath = makeDbPath();
    const store = openStore(dbPath);
    await seedExec(store, 'exec-c5', 's-c5', {
      heartbeatAgeMs: 600_000,
      generation: 7,
    });
    const m = new ExecutionManager();
    m.attachStore(store);

    const all = [] as Array<{
      recovered: number;
      kept: number;
      unknownToolCalls: unknown[];
    }>;
    for (let i = 0; i < 5; i++) all.push(await m.recover({ staleMs: 90_000 }));

    // 仅第一次有效（后续已不在 listActive）
    expect(all[0]).toEqual({
      recovered: 1,
      kept: 0,
      unknownToolCalls: [],
    });
    expect(all.slice(1)).toEqual(
      Array.from({ length: 4 }, () => ({
        recovered: 0,
        kept: 0,
        unknownToolCalls: [],
      }))
    );
    const row = await store.getExecution(eid('exec-c5'));
    expect(row?.status).toBe('STALE');
    expect(row?.generation).toBe(8); // 只抬升一次
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────
// ⑥ 未知调用恢复
// ─────────────────────────────────────────────────────────────

describe('专项 C-⑥ 未知调用恢复：结果未知 ≠ 失败/成功（不得盲目重放）', () => {
  it('崩溃后未结算工具调用标 unknown（既不判成功也不判失败，不自动重放）', async () => {
    const dbPath = makeDbPath();
    const store = openStore(dbPath);
    await seedExec(store, 'exec-c6', 's-c6', { heartbeatAgeMs: 600_000 });
    await store.recordToolCall(eid('exec-c6'), 'tc-unknown', 'WriteFileTool');
    const m = new ExecutionManager();
    m.attachStore(store);
    await m.recover({ staleMs: 90_000 });

    const tools = await store.listToolCalls(eid('exec-c6'));
    expect(tools.length).toBe(1);
    // 核心不变量：既不是 completed 也不是 failed —— 而是"不可知"
    expect(tools[0].status).toBe('unknown');
    expect(tools[0].status).not.toBe('completed');
    expect(tools[0].status).not.toBe('failed');
    // 已结算（endedAt 有值）⇒ 不会在后续恢复中被再次扫描/重放
    expect(tools[0].endedAt).toBeDefined();
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────
// ⑦ 会话隔离
// ─────────────────────────────────────────────────────────────

describe('专项 C-⑦ 会话隔离：并发会话不串线', () => {
  it('两个会话各自恢复：状态/事件/工具调用互不串线；占用独立', async () => {
    const dbPath = makeDbPath();
    const store = openStore(dbPath);
    // A：陈旧孤儿（应 STALE）；B：心跳新鲜（应 kept、占用）
    await seedExec(store, 'exec-A', 'sess-A', { heartbeatAgeMs: 600_000 });
    await store.recordToolCall(eid('exec-A'), 'tc-A', 'BashTool');
    await seedExec(store, 'exec-B', 'sess-B', {});
    await store.recordToolCall(eid('exec-B'), 'tc-B', 'BashTool');

    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });
    expect(report).toEqual({
      recovered: 1,
      kept: 1,
      // A 的未结算工具调用被判 unknown（B 为 kept ⇒ 其工具仍 running，不入列）
      unknownToolCalls: [
        { executionId: 'exec-A', sessionId: 'sess-A', toolName: 'BashTool' },
      ],
    });

    // A 被 STALE、工具 unknown；B 保持 RUNNING、工具仍 running（未被误伤）
    expect((await store.getExecution(eid('exec-A')))?.status).toBe('STALE');
    expect((await store.getExecution(eid('exec-B')))?.status).toBe('RUNNING');
    expect((await store.listToolCalls(eid('exec-A')))[0].status).toBe(
      'unknown'
    );
    expect((await store.listToolCalls(eid('exec-B')))[0].status).toBe(
      'running'
    );

    // 事件按 executionId 隔离
    const evA = await store.listEvents(eid('exec-A'));
    const evB = await store.listEvents(eid('exec-B'));
    expect(evA.every((e) => e.executionId === 'exec-A')).toBe(true);
    expect(evB.every((e) => e.executionId === 'exec-B')).toBe(true);

    // 占用独立：A 已释放 ⇒ acquire 得 RUNNING；B 外部占用 ⇒ 仅 QUEUED
    expect(m.get(m.acquire('sess-A').executionId)?.status).toBe('RUNNING');
    expect(m.get(m.acquire('sess-B').executionId)?.status).toBe('QUEUED');
    // 等待 acquire 的 best-effort 写穿落盘后再关库（避免"Database not initialized"噪声）
    await new Promise((r) => setTimeout(r, 20));
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────
// ⑧ 旧数据兼容
// ─────────────────────────────────────────────────────────────

describe('专项 C-⑧ 旧数据兼容：迁移/恢复不崩、可安全处理', () => {
  it('历史重复 (execution_id, seq) ⇒ init 不阻断（唯一索引 best-effort），新写入仍唯一', async () => {
    const dbPath = makeDbPath();
    // 手工构造"旧版"库：建表**但不建唯一索引**，并写入重复 seq（模拟旧版无约束数据）
    await rawRun(
      dbPath,
      `CREATE TABLE ${EXECUTION_EVENTS_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT,
        created_at INTEGER NOT NULL
      )`
    );
    await rawRun(
      dbPath,
      `INSERT INTO ${EXECUTION_EVENTS_TABLE}
        (execution_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['exec-legacy', 1, 'legacy/a', null, Date.now()]
    );
    await rawRun(
      dbPath,
      `INSERT INTO ${EXECUTION_EVENTS_TABLE}
        (execution_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['exec-legacy', 1, 'legacy/dup', null, Date.now()]
    );

    // init 必须不抛（CREATE UNIQUE INDEX 因历史重复失败 ⇒ 被捕获为 best-effort）
    const s2 = openStore(dbPath);
    await expect(s2.init()).resolves.toBeUndefined();
    // 新增事件仍取 MAX(seq)+1 ⇒ 不与历史冲突
    const seq = await s2.appendEvent(eid('exec-legacy'), 'legacy/c');
    expect(seq).toBe(2);
    s2.close();
  });

  it('未知/历史状态值 ⇒ 恢复安全忽略（不误判为活跃、不崩溃）', async () => {
    const dbPath = makeDbPath();
    {
      const s = openStore(dbPath);
      await seedExec(s, 'exec-legacy-status', 's-legacy');
      s.close();
    }
    await rawRun(
      dbPath,
      `UPDATE ${EXECUTIONS_TABLE} SET status = ? WHERE execution_id = ?`,
      ['LEGACY_RUNNING', 'exec-legacy-status']
    );

    const s2 = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(s2);
    // 未知状态不在 ACTIVE_STATUSES ⇒ 不参与恢复，也不报错
    await expect(m.recover({ staleMs: 90_000 })).resolves.toEqual({
      recovered: 0,
      kept: 0,
      unknownToolCalls: [],
    });
    expect((await s2.getExecution(eid('exec-legacy-status')))?.status).toBe(
      'LEGACY_RUNNING'
    );
    s2.close();
  });

  it('旧数据中带 running 工具调用的陈旧 RUNNING ⇒ fencing 仍生效（STALE + 代次抬升）', async () => {
    const dbPath = makeDbPath();
    const s = openStore(dbPath);
    await seedExec(s, 'exec-legacy-orphan', 's-legacy-orphan', {
      heartbeatAgeMs: 600_000,
      generation: 1,
    });
    await s.recordToolCall(eid('exec-legacy-orphan'), 'tc-legacy', 'BashTool');

    const m = new ExecutionManager();
    m.attachStore(s);
    const report = await m.recover({ staleMs: 90_000 });
    expect(report.recovered).toBe(1);
    const row = await s.getExecution(eid('exec-legacy-orphan'));
    expect(row?.status).toBe('STALE');
    expect(row?.generation).toBe(2);
    expect((await s.listToolCalls(eid('exec-legacy-orphan')))[0].status).toBe(
      'unknown'
    );
    s.close();
  });
});
