/**
 * USD 档位观测一致性（2026-10-19）：
 * USD 记账本身必须触发档位跨越观测，不能等下一次 `getMode()`。
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globalEventBus } from '../../src/core/events/EventBus';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

const dataDir = mkdtempSync(join(tmpdir(), 'budget-usd-observe-'));
process.env.LIRI_DATA_DIR = dataDir;

type AlertPayload = { code?: string; module?: string };

let events: AlertPayload[] = [];
let subscription: { unsubscribe(): void } | null = null;

beforeEach(() => {
  resetDailyBudgetForTest();
  events = [];
  subscription = globalEventBus.subscribe('alert:triggered', (payload) => {
    events.push(payload as AlertPayload);
  });
});

afterEach(() => {
  subscription?.unsubscribe();
  subscription = null;
  resetDailyBudgetForTest();
});

afterAll(() => {
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    /* 清理失败不影响测试结论 */
  }
});

describe('USD 记账触发档位观测', () => {
  it('越界记账 ⇒ 立即发 DAILY_BUDGET_LOCKED（无需调用 getMode）', () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(10);
    budget.recordUsdUsage(11);

    expect(events.filter((e) => e.code === 'DAILY_BUDGET_LOCKED')).toHaveLength(
      1
    );
  });

  it('未越界（10%）⇒ 不产生告警事件', () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(10);
    budget.recordUsdUsage(1);

    expect(events).toHaveLength(0);
  });

  it('先进入 80% 告警区、再越界 ⇒ 只在 locked 时发一次事件', () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(10);
    budget.recordUsdUsage(8.5); // report_only（仅日志）
    expect(events).toHaveLength(0);

    budget.recordUsdUsage(2); // locked
    budget.recordUsdUsage(1); // 仍 locked，去重
    expect(events.filter((e) => e.code === 'DAILY_BUDGET_LOCKED')).toHaveLength(
      1
    );
  });
});
