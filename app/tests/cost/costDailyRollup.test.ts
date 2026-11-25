/**
 * cost_daily_rollup（2026-11-26）：每日 × 模型预聚合
 *
 * 现场：真机 26.3 万行 `cost_records`，概览聚合走覆盖索引仍需 210–240ms **同步**执行；
 * 前端 Footer 每 5s 轮询，缓存一过期就阻塞事件循环。改为读预聚合小表：
 *  - 写入增量 upsert；
 *  - 删除置脏；
 *  - 首次 / 旧库 / 脏 ⇒ 从 `cost_records` 一次性重建。
 *
 * 本文件锁三件事：增量正确、删除后重建正确、旧库（无汇总表）升级后自动重建。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from '@openliri/infra/external';
import { CostRecordRepository } from '@openliri/infra/cost/CostRecordRepository';

const dirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cost-rollup-'));
  dirs.push(dir);
  return join(dir, 'cost.db');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

async function record(
  repo: CostRecordRepository,
  sessionId: string,
  model: string,
  costUSD: number,
  inputTokens = 100,
  outputTokens = 10
): Promise<void> {
  await repo.recordCost({
    model,
    inputTokens,
    outputTokens,
    costUSD,
    sessionId,
  });
}

describe('cost_daily_rollup：增量与重建', () => {
  it('同一天同模型两次写入 ⇒ 一行累加（requests=2）', async () => {
    const repo = new CostRecordRepository(':memory:');
    await record(repo, 's1', 'm1', 0.5, 100, 10);
    await record(repo, 's1', 'm1', 0.25, 200, 20);

    const rows = await repo.getDailyModelAggregatedCosts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe('m1');
    expect(rows[0]!.cost).toBeCloseTo(0.75, 10);
    expect(rows[0]!.inputTokens).toBe(300);
    expect(rows[0]!.outputTokens).toBe(30);
    expect(rows[0]!.requests).toBe(2);
    await repo.close();
  });

  it('删除会话后汇总随之回退（置脏 ⇒ 重建）', async () => {
    const repo = new CostRecordRepository(':memory:');
    await record(repo, 's1', 'm1', 1);
    await record(repo, 's2', 'm1', 2);
    expect((await repo.getDailyModelAggregatedCosts())[0]!.requests).toBe(2);

    await repo.deleteSessionRecords('s1');

    const rows = await repo.getDailyModelAggregatedCosts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost).toBeCloseTo(2, 10);
    expect(rows[0]!.requests).toBe(1);
    await repo.close();
  });

  it('旧库（没有汇总表）首次读取自动从 cost_records 重建', async () => {
    const dbPath = tempDbPath();

    // 1) 新版本写入两条（此时汇总表已存在）
    const first = new CostRecordRepository(dbPath);
    await record(first, 's1', 'm1', 1.5, 1000, 100);
    await record(first, 's1', 'm2', 0.5, 500, 50);
    await first.close();

    // 2) 模拟旧版本库：删掉汇总表与状态表（cost_records 原样保留）
    const raw = new Database(dbPath);
    raw.run('DROP TABLE IF EXISTS cost_daily_rollup');
    raw.run('DROP TABLE IF EXISTS cost_rollup_state');
    raw.close();

    // 3) 重新打开 ⇒ createTables 重建空汇总表；状态缺失 ⇒ 首次读取全量重建
    const upgraded = new CostRecordRepository(dbPath);
    const rows = await upgraded.getDailyModelAggregatedCosts();
    expect(rows).toHaveLength(2);
    const byModel = new Map(rows.map((r) => [r.model, r]));
    expect(byModel.get('m1')!.cost).toBeCloseTo(1.5, 10);
    expect(byModel.get('m1')!.inputTokens).toBe(1000);
    expect(byModel.get('m2')!.cost).toBeCloseTo(0.5, 10);
    // 重建只发生一次：再读一遍结果不变
    expect((await upgraded.getDailyModelAggregatedCosts()).length).toBe(2);
    await upgraded.close();
  });
});
