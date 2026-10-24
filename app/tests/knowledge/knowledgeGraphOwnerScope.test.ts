// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * 租户级 DB 期 3：`KnowledgeGraph` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 单表 `kg_edges`：主键 `(edge_id, owner_key)`；查询 / 统计 / 悬挂边清理都按 owner 收口。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { KnowledgeGraph } from '../../src/knowledge/graph/KnowledgeGraph';
import type { Principal } from '@openliri/kernel/identity/principal';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const graph = new KnowledgeGraph(':memory:');

beforeAll(async () => {
  await graph.init();
});

afterAll(async () => {
  await graph.close();
});

describe('KnowledgeGraph：行级隔离', () => {
  it('边 / 统计 / 单查只覆盖自己的行', async () => {
    const aliceEdge = await runWithPrincipal(ALICE, () =>
      graph.addEdge({ from: 'a:kind:1', to: 'b:kind:2', type: 'rel' })
    );
    await runWithPrincipal(BOB, () =>
      graph.addEdge({ from: 'x:kind:1', to: 'y:kind:2', type: 'rel' })
    );

    expect(
      (await runWithPrincipal(ALICE, () => graph.queryEdges({}))).map(
        (e) => e.from
      )
    ).toEqual(['a:kind:1']);
    expect(
      (await runWithPrincipal(BOB, () => graph.queryEdges({}))).map(
        (e) => e.from
      )
    ).toEqual(['x:kind:1']);

    expect(
      await runWithPrincipal(BOB, () => graph.getEdge(aliceEdge.id))
    ).toBeNull();

    const stats = await runWithPrincipal(ALICE, () => graph.getStats());
    expect(stats.totalEdges).toBe(1);
    expect(stats.byType['rel']).toBe(1);
    expect(stats.totalEntities).toBe(2);
  });

  it('删除不波及他人', async () => {
    const [aliceEdge] = await runWithPrincipal(ALICE, () =>
      graph.queryEdges({})
    );
    await runWithPrincipal(BOB, () => graph.deleteEdge(aliceEdge.id));
    expect(
      await runWithPrincipal(BOB, () => graph.getEdge(aliceEdge.id))
    ).toBeNull();
    expect(
      (await runWithPrincipal(ALICE, () => graph.getEdge(aliceEdge.id)))?.id
    ).toBe(aliceEdge.id);
  });

  it('悬挂边清理只清自己的', async () => {
    // ALICE 的边 to 端不在有效集合内 ⇒ 1 条悬挂；BOB 的边不应被 ALICE 的清理波及
    const removed = await runWithPrincipal(ALICE, () =>
      graph.cleanupOrphans(new Set(['a:kind:1']))
    );
    expect(removed).toBe(1);

    expect(await runWithPrincipal(ALICE, () => graph.queryEdges({}))).toEqual(
      []
    );
    expect(
      (await runWithPrincipal(BOB, () => graph.queryEdges({}))).map(
        (e) => e.from
      )
    ).toEqual(['x:kind:1']);
  });
});

describe('门禁：KnowledgeGraph 的读写 SQL 不许漏 owner_key', () => {
  it('除动态 WHERE 外，每条读写 SQL 都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/knowledge/graph/KnowledgeGraph.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(/`[^`]*\$\{KG_EDGES_TABLE\}[^`]*`/g),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(sql)
    );

    // 现状 9 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(9);

    const dynamic = rowSql.filter(
      (sql) => sql.includes('${whereClause}') || sql.includes('${wherePrefix}')
    );
    expect(dynamic).toHaveLength(2);

    for (const sql of rowSql.filter((s) => !dynamic.includes(s))) {
      expect(sql).toContain('owner_key');
    }

    // 动态 WHERE 的归属条件必须是起手条件（两处：queryEdges / cleanupOrphans）
    expect(
      src.match(/const conditions: string\[\] = \['owner_key = \?'\];/g)?.length
    ).toBe(2);
    expect(src).toContain('PRIMARY KEY (edge_id, owner_key)');
  });
});
