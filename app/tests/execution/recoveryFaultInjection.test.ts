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
 * 专项 B §十七-5 —— **恢复阶段故障注入**（2026-10-10）。
 *
 * 审查原文：*"在恢复的每个数据库操作之后模拟进程退出，重新启动并检查状态、所有权、
 * 工具调用记录和事件序号"*。
 *
 * 做法：在 `ExecutionManager.recover()` 的**每个持久化步骤之后**注入"进程退出"（方法真实
 * 执行、随后抛出 ⇒ 模拟"该 DB 操作已提交、进程随即崩溃"），再用**同一库文件**重开
 * store + manager（模拟重启）并再次 `recover()`，断言收敛不变量：
 *  - 未结算工具调用**绝不永久停在 `running`**（终态为 `unknown`）；
 *  - 孤儿执行最终 `STALE` 且 `generation` 抬升（跨重启 fencing 不回退）；
 *  - 该 session 不再被占用（`listActive` 中无残留）；
 *  - 事件序号**唯一**且可读回；
 *  - **重复 `recover()` 幂等**（可反复执行，不产生新活跃记录、不重复抬升代次）。
 *
 * 依据：`dev_docs/20261009/openai 建议.md` §十一–§十七（尤其 §十七-5）。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionManager, ExecutionStore } from '../../src/execution/index.js';
import type {
  ExecutionGeneration,
  ExecutionId,
} from '../../src/execution/types.js';

const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

const roots: string[] = [];
const stores: ExecutionStore[] = [];

function makeDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-recovery-fi-'));
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

/** 预置现场：一条**心跳陈旧**的 RUNNING 执行 + 一个**未结算**（running）工具调用 */
async function seedStale(
  dbPath: string,
  execId: string,
  sessionId: string,
  generation = 3
): Promise<void> {
  const store = openStore(dbPath);
  const stale = Date.now() - 10 * 60_000;
  await store.upsertExecution({
    executionId: eid(execId),
    sessionId,
    generation: gen(generation),
    status: 'RUNNING',
    startedAt: stale,
    updatedAt: stale,
    heartbeatAt: stale,
  });
  await store.recordToolCall(eid(execId), 'tc-1', 'BashTool', stale);
  store.close();
}

/** 预置现场：一条**心跳新鲜**的 RUNNING 执行（kept 分支） */
async function seedFresh(
  dbPath: string,
  execId: string,
  sessionId: string,
  generation = 2
): Promise<void> {
  const store = openStore(dbPath);
  const now = Date.now();
  await store.upsertExecution({
    executionId: eid(execId),
    sessionId,
    generation: gen(generation),
    status: 'RUNNING',
    startedAt: now,
    updatedAt: now,
    heartbeatAt: now,
  });
  store.close();
}

/**
 * 在 `store[method]` **真实执行后**注入崩溃（throw）。
 * @returns 恢复函数
 */
function crashAfter(
  store: ExecutionStore,
  method: 'markUnsettledToolCallsUnknown' | 'markStale' | 'appendEvent'
): () => void {
  const original = store[method] as (...args: unknown[]) => unknown;
  const spy = spyOn(store, method).mockImplementation((async (
    ...args: unknown[]
  ) => {
    await original.apply(store, args);
    throw new Error(`SIMULATED_CRASH_AFTER:${method}`);
  }) as never);
  return () => spy.mockRestore();
}

/** 跑一次 recover，吞掉注入的崩溃（模拟"进程退出"） */
async function recoverExpectingCrash(
  dbPath: string,
  method: Parameters<typeof crashAfter>[1]
): Promise<void> {
  const store = openStore(dbPath);
  const restore = crashAfter(store, method);
  const mgr = new ExecutionManager();
  mgr.attachStore(store);
  let threw = false;
  try {
    await mgr.recover({ staleMs: 90_000 });
  } catch (err) {
    threw = true;
    expect(String(err)).toContain('SIMULATED_CRASH');
  } finally {
    restore();
    store.close();
  }
  expect(threw).toBe(true);
}

/** "重启后用干净路径收敛"：新 store + 新 manager，重复 recover 直到稳定 */
async function recoverClean(
  dbPath: string,
  execId: string,
  sessionId: string
): Promise<{
  status: string;
  generation: number;
  toolStatuses: string[];
  seqs: number[];
  activeAfter: number;
}> {
  const store = openStore(dbPath);
  const mgr = new ExecutionManager();
  mgr.attachStore(store);

  // 第一次恢复
  await mgr.recover({ staleMs: 90_000 });
  // 再跑一次（幂等性：不应报错、不应新增活跃记录）
  await mgr.recover({ staleMs: 90_000 });

  const row = await store.getExecution(eid(execId));
  const tools = await store.listToolCalls(eid(execId));
  const events = await store.listEvents(eid(execId));
  const active = await store.listActive();
  const activeAfter = active.filter((r) => r.sessionId === sessionId).length;
  const result = {
    status: row?.status ?? '(none)',
    generation: row?.generation ?? -1,
    toolStatuses: tools.map((t) => t.status),
    seqs: events.map((e) => e.seq),
    activeAfter,
  };
  store.close();
  return result;
}

describe('专项 B §十七-5 恢复故障注入：陈旧孤儿', () => {
  const SESSION = 's-fi-stale';
  const EXEC = 'exec-fi-stale';

  it('崩溃于 markUnsettledToolCallsUnknown 之后 ⇒ 重启收敛（工具不永久 running）', async () => {
    const dbPath = makeDbPath();
    await seedStale(dbPath, EXEC, SESSION, 3);

    await recoverExpectingCrash(dbPath, 'markUnsettledToolCallsUnknown');
    const r = await recoverClean(dbPath, EXEC, SESSION);

    // 未结算工具调用不得永久停在 running
    expect(r.toolStatuses).toContain('unknown');
    expect(r.toolStatuses).not.toContain('running');
    // 孤儿最终 STALE + 代次抬升 + 不再占用
    expect(r.status).toBe('STALE');
    expect(r.generation).toBeGreaterThan(3);
    expect(r.activeAfter).toBe(0);
  });

  it('崩溃于 markStale 之后 ⇒ 重启收敛（B-02 倒序保证工具已先标 unknown）', async () => {
    const dbPath = makeDbPath();
    await seedStale(dbPath, EXEC, SESSION, 3);

    await recoverExpectingCrash(dbPath, 'markStale');
    const r = await recoverClean(dbPath, EXEC, SESSION);

    // 关键不变量：崩溃在 markStale 之后时，工具在崩溃前**已**被标 unknown
    expect(r.toolStatuses).toContain('unknown');
    expect(r.toolStatuses).not.toContain('running');
    expect(r.status).toBe('STALE');
    expect(r.activeAfter).toBe(0);
  });

  it('崩溃于恢复事件写入之后 ⇒ 重启收敛且事件序号唯一', async () => {
    const dbPath = makeDbPath();
    await seedStale(dbPath, EXEC, SESSION, 3);

    await recoverExpectingCrash(dbPath, 'appendEvent');
    const r = await recoverClean(dbPath, EXEC, SESSION);

    expect(r.status).toBe('STALE');
    expect(r.activeAfter).toBe(0);
    // 事件序号唯一（B-03 串行化 + 唯一索引）
    expect(new Set(r.seqs).size).toBe(r.seqs.length);
    expect(r.seqs.length).toBeGreaterThan(0);
  });
});

describe('专项 B §十七-5 恢复故障注入：心跳新鲜（kept）', () => {
  const SESSION = 's-fi-kept';
  const EXEC = 'exec-fi-kept';

  it('崩溃于 kept 事件写入之后 ⇒ 重启仍可收敛且事件序号唯一', async () => {
    const dbPath = makeDbPath();
    await seedFresh(dbPath, EXEC, SESSION, 2);

    await recoverExpectingCrash(dbPath, 'appendEvent');
    const r = await recoverClean(dbPath, EXEC, SESSION);

    // 心跳新鲜 ⇒ 判定 kept（不误杀），执行保持占用语义（不外泄为 STALE）
    expect(r.status).toBe('RUNNING');
    expect(new Set(r.seqs).size).toBe(r.seqs.length);
  });
});

describe('专项 B §十七-5 反复恢复幂等（无崩溃的重复执行）', () => {
  it('对同一陈旧孤儿连续 recover 三次 ⇒ 状态稳定、代次不再变化', async () => {
    const dbPath = makeDbPath();
    await seedStale(dbPath, 'exec-idem', 's-idem', 4);

    const store = openStore(dbPath);
    const mgr = new ExecutionManager();
    mgr.attachStore(store);

    await mgr.recover({ staleMs: 90_000 });
    const after1 = await store.getExecution(eid('exec-idem'));
    await mgr.recover({ staleMs: 90_000 });
    await mgr.recover({ staleMs: 90_000 });
    const after3 = await store.getExecution(eid('exec-idem'));

    expect(after1?.status).toBe('STALE');
    expect(after3?.status).toBe('STALE');
    // 已 STALE 的记录不在 listActive ⇒ 后续 recover 不再重复抬升代次
    expect(after3?.generation).toBe(after1?.generation);
    store.close();
  });
});
