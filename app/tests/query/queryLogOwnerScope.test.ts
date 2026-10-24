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
 * 租户级 DB 试点：`QueryLogStore` 的**行级隔离**（基础设施专项 §6.1 期 2）。
 *
 * 两件事必须同时成立，缺一不可：
 * 1. **行为**：同一租户库内，A 的行对 B 不可见（query / stats / toolStats / errorStats / prune）；
 * 2. **门禁**：源码里任何读写行的 SQL 都带 `owner_key` —— 新增查询时漏过滤会**当场红**，
 *    而不是等到某天发现跨用户越权。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { QueryLogStore } from '../../src/query/QueryLogStore';
import type { QueryLogEntry } from '../../src/query/QueryLogTypes';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const store = new QueryLogStore(':memory:');

const entry = (
  over: Partial<Omit<QueryLogEntry, 'id'>>
): Omit<QueryLogEntry, 'id'> => ({
  sessionId: 's',
  type: 'api_call',
  model: 'm',
  promptTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  durationMs: 10,
  success: true,
  timestamp: 1_000,
  ...over,
});

afterAll(async () => {
  await store.close();
});

describe('QueryLogStore：行级隔离（同租户不同用户）', () => {
  it('写入与查询：各看各的行', async () => {
    await runWithPrincipal(ALICE, () =>
      store.log(entry({ sessionId: 'a1', timestamp: 1_000 }))
    );
    await runWithPrincipal(BOB, () =>
      store.log(entry({ sessionId: 'b1', timestamp: 2_000 }))
    );

    const alice = await runWithPrincipal(ALICE, () => store.query());
    const bob = await runWithPrincipal(BOB, () => store.query());

    expect(alice.map((r) => r.sessionId)).toEqual(['a1']);
    expect(bob.map((r) => r.sessionId)).toEqual(['b1']);
  });

  it('统计：getStats / getToolStats / getErrorStats 只算自己的', async () => {
    await runWithPrincipal(ALICE, () =>
      store.log(
        entry({
          sessionId: 'a2',
          type: 'tool_call',
          toolName: 'grep',
          timestamp: 3_000,
        })
      )
    );
    await runWithPrincipal(BOB, () =>
      store.log(
        entry({
          sessionId: 'b2',
          type: 'tool_call',
          toolName: 'grep',
          success: false,
          error: 'boom',
          timestamp: 4_000,
        })
      )
    );

    const aliceStats = await runWithPrincipal(ALICE, () => store.getStats());
    const bobStats = await runWithPrincipal(BOB, () => store.getStats());
    expect(aliceStats.totalApiCalls).toBe(1); // 只有 a1
    expect(aliceStats.totalToolCalls).toBe(1); // 只有 a2
    expect(bobStats.totalApiCalls).toBe(1); // 只有 b1
    expect(bobStats.totalToolCalls).toBe(1); // 只有 b2

    const aliceTools = await runWithPrincipal(ALICE, () =>
      store.getToolStats()
    );
    const bobTools = await runWithPrincipal(BOB, () => store.getToolStats());
    expect(aliceTools.totalToolCalls).toBe(1);
    expect(aliceTools.topTools).toEqual([
      { name: 'grep', count: 1, successCount: 1, errorCount: 0 },
    ]);
    expect(bobTools.totalToolCalls).toBe(1);
    expect(bobTools.toolErrorCount).toBe(1);

    const aliceErrors = await runWithPrincipal(ALICE, () =>
      store.getErrorStats()
    );
    const bobErrors = await runWithPrincipal(BOB, () => store.getErrorStats());
    expect(aliceErrors.totalErrors).toBe(0);
    expect(bobErrors.totalErrors).toBe(1);
  });

  it('清理：prune 只删自己的行', async () => {
    const removed = await runWithPrincipal(ALICE, () => store.prune(3_500));
    expect(removed).toBe(2); // a1(1000) + a2(3000)

    const alice = await runWithPrincipal(ALICE, () => store.query());
    const bob = await runWithPrincipal(BOB, () => store.query());
    expect(alice).toEqual([]);
    expect(bob.map((r) => r.sessionId)).toEqual(['b2', 'b1']); // timestamp DESC
  });
});

describe('门禁：QueryLogStore 的读写 SQL 不许漏 owner_key', () => {
  it('每个含 SELECT/INSERT/DELETE/UPDATE 的 SQL 模板都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/query/QueryLogStore.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{QUERY_LOG_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|DELETE|UPDATE)\b/.test(sql)
    );

    // 现状 8 条（INSERT 1 / SELECT 5 / DELETE 1 / …）；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(8);

    // 静态 SQL：字面量里必须直接写 owner_key
    for (const sql of rowSql.filter((s) => !s.includes('${whereClause}'))) {
      expect(sql).toContain('owner_key');
    }

    // 动态 WHERE 分支（query()）：条件数组**必须**以 owner_key 起手 ——
    // 这条断言是"漏过滤"的真正闸门，改条件数组就会红。
    expect(rowSql.filter((s) => s.includes('${whereClause}'))).toHaveLength(1);
    expect(src).toMatch(/conditions:\s*string\[\]\s*=\s*\['owner_key = \?'\]/);
  });
});
