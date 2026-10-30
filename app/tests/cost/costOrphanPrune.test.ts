// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * #24（2026-10-30）：`CostRecordRepository.findOrphanSessions` / `pruneOrphanSessions`
 *
 * 真机证据：`session_cost_summaries` 404 行 ≫ 磁盘 32 个会话。历史删除会话时并非所有
 * 路径都调了 `deleteSessionRecords`，孤儿行只增不减。
 *
 * 契约：
 * - `findOrphanSessions` **只读**（dry-run 可安全调用，行数不变）；
 * - `pruneOrphanSessions` 只删给定 id 的行，现存会话的成本痕迹必须原样保留。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { CostRecordRepository } from '../../src/cost/CostRecordRepository';

const repo = new CostRecordRepository(':memory:');

afterAll(async () => {
  await repo.close();
});

const cost = (sessionId: string) => ({
  model: 'm',
  inputTokens: 10,
  outputTokens: 5,
  costUSD: 0.25,
  sessionId,
});

describe('CostRecordRepository：孤儿成本痕迹清理（#24）', () => {
  it('findOrphanSessions 只读：列出孤儿但一行不删', async () => {
    await repo.recordCost(cost('s-keep'));
    await repo.recordCost(cost('s-orphan-1'));
    await repo.recordCost(cost('s-orphan-2'));
    const before = await repo.countSessionSummaries();

    const plan = await repo.findOrphanSessions(new Set(['s-keep']));

    expect(plan.orphanSessionIds).toEqual(['s-orphan-1', 's-orphan-2']);
    expect(plan.withSummary).toBe(2);
    expect(plan.withRecords).toBe(2);
    // dry-run 语义：行数不变
    expect(await repo.countSessionSummaries()).toBe(before);
  });

  it('pruneOrphanSessions 只删孤儿，现存会话的摘要与明细保留', async () => {
    const removed = await repo.pruneOrphanSessions([
      's-orphan-1',
      's-orphan-2',
    ]);

    expect(removed).toBe(2);
    expect(await repo.countSessionSummaries()).toBe(1);

    const kept = await repo.getCostRecords({ sessionId: 's-keep' });
    expect(kept.length).toBe(1);
    expect(await repo.getCostRecords({ sessionId: 's-orphan-1' })).toEqual([]);

    // 幂等：再查一次没有孤儿
    expect(
      (await repo.findOrphanSessions(new Set(['s-keep']))).orphanSessionIds
    ).toEqual([]);
  });

  it('空清单调用是安全的（不动任何行）', async () => {
    expect(await repo.pruneOrphanSessions([])).toBe(0);
    expect(await repo.countSessionSummaries()).toBe(1);
  });
});
