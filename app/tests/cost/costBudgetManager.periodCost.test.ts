/**
 * CostBudgetManager 周期成本口径修正（P7 / 阶段 5，2026-10-11）回归测试
 *
 * 背景：`getPeriodCost` 原实现**忽略 `periodStart`**，直接返回
 * `costTracker.getTotalCostUSD()`（**全时累计**）⇒ daily/weekly/monthly 三档恒等且随总成本
 * 上升，`currentCost/percentageUsed/status` 失真。现改为按 `periodStart` 查
 * `CostRecordRepository.getAggregatedCosts({ startTime })`。
 *
 * 判定性：注入了**内存累计成本**（旧实现的返回值）。若仍是旧实现，则"未来周期起点"的预算
 * 也会返回该内存累计（≠0）⇒ 断言必然失败；新实现按 DB 聚合（未来起点无记录）⇒ 0。
 *
 * 隔离：`LIRI_DATA_DIR` + `setUserDataDirOverride` 同指临时目录（前者**优先于**后者，见
 * `core/paths.resolveDataDir` ⇒ 二者都设才不被同进程其他用例的 env 泄漏影响）；
 * 写库只用**直接构造**的临时仓库实例（不经单例），避免污染。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setUserDataDirOverride } from '@openliri/kernel/paths';
import { CostRecordRepository } from '../../src/cost/CostRecordRepository';
import { costBudgetManager } from '../../src/cost/CostBudgetManager';
import { costTracker } from '../../src/cost/CostTracker';

const dataDir = mkdtempSync(join(tmpdir(), 'cost-budget-period-'));

let prevDataDir: string | undefined;

const addedBudgetIds: string[] = [];

function addCustomBudget(id: string, customPeriodStart: Date): void {
  costBudgetManager.addBudget({
    id,
    name: id,
    period: 'custom',
    limit: 100,
    warningThreshold: 0.8,
    hardLimit: false,
    enabled: true,
    customPeriodStart,
  });
  addedBudgetIds.push(id);
}

beforeAll(() => {
  // 必须早于本文件内任何 `resolveDbPath()` 求值（仓库单例的构造期默认参数）
  prevDataDir = process.env.LIRI_DATA_DIR;
  process.env.LIRI_DATA_DIR = dataDir;
  setUserDataDirOverride(dataDir);
});

afterAll(() => {
  for (const id of addedBudgetIds) costBudgetManager.removeBudget(id);
  setUserDataDirOverride(null);
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  // 尽力清理：仓库单例仍持有 SQLite 句柄（Windows 下会 EBUSY）⇒ 失败不影响断言
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch — 临时目录清理为 best-effort（句柄由进程退出释放）
  }
});

describe('CostRecordRepository.getAggregatedCosts 的 startTime 过滤（修正所依赖的查询语义）', () => {
  test('startTime 之前/之后的记录被正确包含与排除', async () => {
    const repo = new CostRecordRepository(join(dataDir, 'period-semantics.db'));
    await repo.initDatabase();
    try {
      await repo.recordCost({
        model: 'zzz-unknown-test-model',
        inputTokens: 1,
        outputTokens: 1,
        costUSD: 1.5,
      });

      const all = await repo.getAggregatedCosts({});
      expect(all.totalCostUSD).toBeCloseTo(1.5, 6);

      const future = await repo.getAggregatedCosts({
        startTime: Date.now() + 86_400_000,
      });
      expect(future.totalCostUSD).toBe(0);

      const past = await repo.getAggregatedCosts({ startTime: 0 });
      expect(past.totalCostUSD).toBeCloseTo(1.5, 6);
    } finally {
      await repo.close();
    }
  });
});

describe('CostBudgetManager.getBudgetStatus 周期成本（P7 修正）', () => {
  // 注入"内存累计成本"= 旧实现的返回值（未知模型走默认定价 3+15 USD/M ⇒ 明确非 0）
  costTracker.addCost('zzz-unknown-test-model', 1_000_000, 1_000_000);

  test('未来周期起点 ⇒ currentCost 为 0（旧实现会返回内存累计，必然非 0）', async () => {
    const inMemory = costTracker.getTotalCostUSD();
    expect(inMemory).toBeGreaterThan(0); // 前提：内存累计确实非 0，测试才有判定性

    const id = `custom-future-${Date.now()}`;
    addCustomBudget(id, new Date(Date.now() + 86_400_000));
    const status = await costBudgetManager.getBudgetStatus(id);

    expect(status).toBeDefined();
    expect(status!.currentCost).toBe(0);
    expect(status!.percentageUsed).toBe(0);
    expect(status!.status).toBe('ok');
    // 决定性对照：新实现不再等于内存累计
    expect(status!.currentCost).not.toBe(inMemory);
  });

  test('起点=纪元 ⇒ 取 DB 聚合值（不改用内存累计）', async () => {
    const inMemory = costTracker.getTotalCostUSD();
    const id = `custom-epoch-${Date.now()}`;
    addCustomBudget(id, new Date(0));
    const status = await costBudgetManager.getBudgetStatus(id);

    expect(status).toBeDefined();
    // DB 为空（临时目录）⇒ 0；无论如何都不应等于内存累计
    expect(status!.currentCost).toBeGreaterThanOrEqual(0);
    expect(status!.currentCost).toBeLessThan(inMemory);
  });
});
