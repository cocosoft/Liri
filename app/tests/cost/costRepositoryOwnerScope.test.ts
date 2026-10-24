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
 * 租户级 DB 期 3：`CostRecordRepository` 的**行级隔离**（基础设施专项 §6.1）。
 *
 * 两张表（cost_records / session_cost_summaries）+ 一处跨表对账（model_usage_logs）
 * 都必须带 owner 过滤；静态门禁扫源码，行为测试验隔离。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostRecordRepository } from '../../src/cost/CostRecordRepository';
import { openBunDatabase } from '@openliri/kernel/external/sqlite3';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'acme', userId: 'bob', roles: ['user'] };

const repo = new CostRecordRepository(':memory:');

afterAll(async () => {
  await repo.close();
});

const cost = (over: {
  sessionId: string;
  costUSD: number;
  requestId?: string;
}) => ({
  model: 'm',
  inputTokens: 10,
  outputTokens: 5,
  costUSD: over.costUSD,
  sessionId: over.sessionId,
  requestId: over.requestId,
});

describe('CostRecordRepository：行级隔离', () => {
  it('cost_records：只看得见自己的行', async () => {
    await runWithPrincipal(ALICE, () =>
      repo.recordCost(cost({ sessionId: 's-a', costUSD: 0.5 }))
    );
    await runWithPrincipal(BOB, () =>
      repo.recordCost(cost({ sessionId: 's-b', costUSD: 0.7 }))
    );

    const aliceRows = await runWithPrincipal(ALICE, () =>
      repo.getCostRecords({})
    );
    const bobRows = await runWithPrincipal(BOB, () => repo.getCostRecords({}));
    expect(aliceRows.map((r) => r.sessionId)).toEqual(['s-a']);
    expect(bobRows.map((r) => r.sessionId)).toEqual(['s-b']);
  });

  it('session_cost_summaries：摘要与计数各算各的', async () => {
    const aliceSummary = await runWithPrincipal(ALICE, () =>
      repo.getSessionSummary('s-a')
    );
    expect(aliceSummary?.totalCostUSD).toBeCloseTo(0.5, 6);
    expect(aliceSummary?.totalRequests).toBe(1);

    // BOB 看 ALICE 的摘要 ⇒ 看不到
    const bobPeek = await runWithPrincipal(BOB, () =>
      repo.getSessionSummary('s-a')
    );
    expect(bobPeek).toBeNull();

    expect(
      await runWithPrincipal(ALICE, () => repo.countSessionSummaries())
    ).toBe(1);
    expect(
      await runWithPrincipal(BOB, () => repo.countSessionSummaries())
    ).toBe(1);
    expect(
      await runWithPrincipal(ALICE, () => repo.getAllSessionSummaries())
    ).toHaveLength(1);
  });

  it('聚合：SUM/COUNT 只覆盖自己的行', async () => {
    const alice = await runWithPrincipal(ALICE, () =>
      repo.getAggregatedCosts({})
    );
    expect(alice.totalCostUSD).toBeCloseTo(0.5, 6);
    expect(alice.totalRequests).toBe(1);

    const daily = await runWithPrincipal(ALICE, () =>
      repo.getDailyAggregatedCosts()
    );
    expect(daily).toHaveLength(1);
    expect(daily[0]?.requests).toBe(1);
  });

  it('删除/结束会话：不波及别人的同名 sessionId', async () => {
    // 让 ALICE 也有一条同名会话 s-shared，BOB 同样一条
    await runWithPrincipal(ALICE, () =>
      repo.recordCost(cost({ sessionId: 's-shared', costUSD: 0.1 }))
    );
    await runWithPrincipal(BOB, () =>
      repo.recordCost(cost({ sessionId: 's-shared', costUSD: 0.2 }))
    );

    await runWithPrincipal(ALICE, () => repo.deleteSessionRecords('s-shared'));
    await runWithPrincipal(ALICE, () => repo.endSession('s-shared'));

    const bobRows = await runWithPrincipal(BOB, () =>
      repo.getSessionCostRecords('s-shared')
    );
    expect(bobRows).toHaveLength(1);
    const bobSummary = await runWithPrincipal(BOB, () =>
      repo.getSessionSummary('s-shared')
    );
    expect(bobSummary?.endedAt).toBeUndefined();
  });
});

describe('CostRecordRepository：对账查询（跨表也带 owner）', () => {
  it('只对账自己的 model_usage_logs 行与自己的 cost_records 行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cost-reconcile-'));
    const dbPath = join(dir, 'app.db');
    const scopedRepo = new CostRecordRepository(dbPath);
    await scopedRepo.initDatabase();

    const raw = openBunDatabase(dbPath);
    raw.run(
      `CREATE TABLE IF NOT EXISTS model_usage_logs (
         request_id TEXT, model TEXT, cost_usd REAL,
         status_code INTEGER, timestamp INTEGER, owner_key TEXT)`
    );
    const ts = Math.floor(Date.now() / 1000);
    raw.run(
      `INSERT INTO model_usage_logs (request_id, model, cost_usd, status_code, timestamp, owner_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['req-a', 'm', 0.5, 200, ts, 'acme:alice']
    );
    raw.run(
      `INSERT INTO model_usage_logs (request_id, model, cost_usd, status_code, timestamp, owner_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['req-b', 'm', 0.7, 200, ts, 'acme:bob']
    );
    raw.close();

    await runWithPrincipal(ALICE, () =>
      scopedRepo.recordCost({
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        costUSD: 0.4,
        sessionId: 's-a',
        requestId: 'req-a',
      })
    );
    await runWithPrincipal(BOB, () =>
      scopedRepo.recordCost({
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        costUSD: 0.7,
        sessionId: 's-b',
        requestId: 'req-b',
      })
    );

    const alice = await runWithPrincipal(ALICE, () =>
      scopedRepo.reconcileUsageAndCost()
    );
    // ALICE：两侧都有 req-a（matched=1），但金额 0.5 vs 0.4 ⇒ 一条差异
    expect(alice.matched).toBe(1);
    expect(alice.onlyInUsage).toBe(0);
    expect(alice.onlyInCost).toBe(0);
    expect(alice.costDiffs).toHaveLength(1);
    expect(alice.costDiffs[0]?.requestId).toBe('req-a');

    const bob = await runWithPrincipal(BOB, () =>
      scopedRepo.reconcileUsageAndCost()
    );
    expect(bob.matched).toBe(1);
    expect(bob.costDiffs).toEqual([]);
    expect(bob.onlyInUsage).toBe(0);
    expect(bob.onlyInCost).toBe(0);

    await scopedRepo.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows：句柄释放滞后 ⇒ 交给系统临时目录清理
    }
  });
});

describe('门禁：CostRecordRepository 的读写 SQL 不许漏 owner_key', () => {
  it('两张表的读写 SQL + 对账的字面 cost_records 都必须带 owner_key', () => {
    const src = readFileSync(
      new URL('../../src/cost/CostRecordRepository.ts', import.meta.url),
      'utf8'
    );
    const templates = [
      ...src.matchAll(
        /`[^`]*\$\{(COST_RECORDS_TABLE|COST_SESSION_SUMMARY_TABLE)\}[^`]*`/g
      ),
    ].map((m) => m[0]);
    const rowSql = templates.filter((sql) =>
      /\b(SELECT|INSERT|DELETE|UPDATE)\b/.test(sql)
    );

    // 现状 ≥12 条；少于它说明扫描本身失效
    expect(rowSql.length).toBeGreaterThanOrEqual(12);

    // 静态 SQL：字面量里必须直接写 owner_key
    for (const sql of rowSql.filter((s) => !s.includes('${whereClause}'))) {
      expect(sql).toContain('owner_key');
    }

    // 动态 WHERE 分支：getCostRecords ×1 + getAggregatedCosts ×2 + getDailyAggregatedCosts ×1
    expect(rowSql.filter((s) => s.includes('${whereClause}'))).toHaveLength(4);
    expect(src).toMatch(/conditions:\s*string\[\]\s*=\s*\['owner_key = \?'\]/);

    // 对账 SQL 用**字面表名**（不走常量）⇒ 断言每个 `cost_records c` 引用都配了 c.owner_key 过滤
    const literalRefs = src.match(/\bcost_records c\b/g) ?? [];
    const costOwnerFilters = src.match(/c\.owner_key = \?/g) ?? [];
    expect(literalRefs.length).toBeGreaterThanOrEqual(2);
    expect(costOwnerFilters.length).toBeGreaterThanOrEqual(literalRefs.length);
  });
});
