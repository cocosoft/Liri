/**
 * DailyCostCache（2026-11-26）
 *
 * 现场：该聚合在 263k 行表上走覆盖索引仍需 210–240ms **同步**执行（阻塞事件循环），
 * 而前端 Footer 每 5s 轮询 `/v1/usage/cost/summary`。旧 TTL=60s ⇒ 空闲时也每分钟
 * 重扫一次（`sqlite3:慢查询 all` 每分钟一条）。
 *
 * 锁两件事：
 *  ① TTL 内命中缓存（不重复查库）；
 *  ② 新鲜度靠写路径 `invalidate()`（`cost/index.ts` 在落库后调用）⇒ 有新成本立刻重算。
 */
import { describe, expect, it } from 'bun:test';

import { DailyCostCache } from '@openliri/infra/cost/DailyCostCache';
import type {
  CostRecordRepository,
  DailyModelCost,
} from '@openliri/infra/cost/CostRecordRepository';

const ROWS: DailyModelCost[] = [
  {
    dayIndex: 20_000,
    model: 'm1',
    cost: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requests: 1,
  },
];

function makeRepo(): {
  repo: CostRecordRepository;
  calls: () => number;
} {
  let calls = 0;
  const repo = {
    getDailyModelAggregatedCosts: async () => {
      calls += 1;
      return ROWS;
    },
  } as unknown as CostRecordRepository;
  return { repo, calls: () => calls };
}

describe('DailyCostCache：TTL 命中与写路径失效', () => {
  it('TTL 内多次读取只查库一次', async () => {
    const { repo, calls } = makeRepo();
    const cache = new DailyCostCache(60_000);

    expect(await cache.get(repo)).toEqual(ROWS);
    expect(await cache.get(repo)).toEqual(ROWS);
    expect(calls()).toBe(1);
  });

  it('invalidate 后立即重查（写路径保证新鲜度）', async () => {
    const { repo, calls } = makeRepo();
    const cache = new DailyCostCache(60_000);

    await cache.get(repo);
    cache.invalidate();
    await cache.get(repo);

    expect(calls()).toBe(2);
  });

  it('TTL 过期后重查（兜底绕过失效的写入面）', async () => {
    const { repo, calls } = makeRepo();
    const cache = new DailyCostCache(10);

    await cache.get(repo);
    await new Promise((r) => setTimeout(r, 25));
    await cache.get(repo);

    expect(calls()).toBe(2);
  });
});
