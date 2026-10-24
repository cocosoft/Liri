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
 * 租户级 DB 期 3：`ExecutionStore` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 三张表（executions / execution_events / tool_calls）都必须带 `owner_key`；
 * 静态门禁扫源码，行为测试验隔离（同租户不同用户）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ExecutionStore } from '../../src/execution/ExecutionStore';
import type {
  ExecutionId,
  ExecutionGeneration,
} from '../../src/execution/types';
import {
  runWithPrincipal,
  getRequestPrincipalKey,
} from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const store = new ExecutionStore(':memory:');

afterAll(() => store.close());

/** 品牌类型在测试里显式构造（运行期就是字符串/数字） */
const execId = (id: string): ExecutionId => id as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

const exec = (id: string) => ({
  executionId: execId(id),
  sessionId: 's1',
  generation: gen(1),
  status: 'RUNNING' as const,
  startedAt: 1,
  updatedAt: 1,
  heartbeatAt: 1,
});

describe('ExecutionStore：行级隔离（三张表）', () => {
  it('executions：各看各的（listActive / getExecution）', async () => {
    await runWithPrincipal(ALICE, () => store.upsertExecution(exec('a1')));
    await runWithPrincipal(BOB, () => store.upsertExecution(exec('b1')));

    const aliceActive = await runWithPrincipal(ALICE, () => store.listActive());
    expect(aliceActive.map((r) => r.executionId)).toEqual(['a1']);

    // 同 id 也不行：A 的执行对 B 不可见（owner 是过滤条件）
    const bobPeek = await runWithPrincipal(BOB, () =>
      store.getExecution(execId('a1'))
    );
    expect(bobPeek).toBeNull();
  });

  it('execution_events：seq 按各自的行推进，互不串号', async () => {
    const seqA = await runWithPrincipal(ALICE, () =>
      store.appendEvent(execId('a1'), 'started', { by: 'alice' })
    );
    const seqB = await runWithPrincipal(BOB, () =>
      store.appendEvent(execId('b1'), 'started', { by: 'bob' })
    );
    // 若事件表漏了 owner 过滤，BOB 会看到 A 的 seq 并拿到 2
    expect(seqA).toBe(1);
    expect(seqB).toBe(1);

    const eventsB = await runWithPrincipal(BOB, () =>
      store.listEvents(execId('a1'))
    );
    expect(eventsB).toEqual([]);
  });

  it('tool_calls：记录与结算只影响自己的行', async () => {
    await runWithPrincipal(ALICE, () =>
      store.recordToolCall(execId('a1'), 'call-1', 'grep', 10)
    );
    await runWithPrincipal(BOB, () =>
      store.recordToolCall(execId('b1'), 'call-1', 'grep', 10)
    );

    // BOB 结算自己的行，不应把 ALICE 的同名 toolCallId 一起改掉
    const settled = await runWithPrincipal(BOB, () =>
      store.finishToolCall(execId('b1'), 'call-1', 'completed', undefined, 20)
    );
    expect(settled).toBe(true);

    const aliceCalls = await runWithPrincipal(ALICE, () =>
      store.listToolCalls(execId('a1'))
    );
    expect(aliceCalls).toHaveLength(1);
    expect(aliceCalls[0]?.endedAt).toBeUndefined();
  });

  it('purgeOlderThan：只清自己的执行（及其事件/工具调用）', async () => {
    await runWithPrincipal(ALICE, () =>
      store.upsertExecution({
        ...exec('a-old'),
        status: 'COMPLETED',
        updatedAt: 1,
      })
    );
    await runWithPrincipal(BOB, () =>
      store.upsertExecution({
        ...exec('b-old'),
        status: 'COMPLETED',
        updatedAt: 1,
      })
    );

    const removed = await runWithPrincipal(ALICE, () =>
      store.purgeOlderThan(0, 10_000)
    );
    expect(removed).toBe(1);

    // BOB 的 COMPLETED 行仍存在（listActive 只列占用中状态，故用 getExecution 验在）
    const bobStillHasOld = await runWithPrincipal(BOB, () =>
      store.getExecution(execId('b-old'))
    );
    expect(bobStillHasOld).not.toBeNull();
  });

  it('本地身份（不在请求作用域）⇒ 归属键恒为 local:local', () => {
    expect(getRequestPrincipalKey()).toBe('local:local');
  });
});

describe('门禁：ExecutionStore 的读写 SQL 不许漏 owner_key', () => {
  it('三张表的每个 SELECT/INSERT/DELETE/UPDATE 模板都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/execution/ExecutionStore.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(
        /`[^`]*\$\{(EXECUTIONS_TABLE|EXECUTION_EVENTS_TABLE|TOOL_CALLS_TABLE)\}[^`]*`/g
      ),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|DELETE|UPDATE)\b/.test(sql)
    );

    // 现状 17 条；少于它说明扫描本身失效（不是"变干净了"）
    expect(rowSql.length).toBeGreaterThanOrEqual(15);
    for (const sql of rowSql) {
      expect(sql).toContain('owner_key');
    }
  });
});
