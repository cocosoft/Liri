/**
 * 预算档位跨越 → 通知端口（2026-10-19）。
 *
 * 覆盖：80% 与 100% 各通知一次、locked 期间不重复、未接管持久化（测试/临时实例）不通知。
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
import {
  getDailyBudget,
  resetDailyBudgetForTest,
  setBudgetAlertNotifier,
  type BudgetAlertEvent,
} from '../../src/query/DailyBudgetManager';

const dataDir = mkdtempSync(join(tmpdir(), 'budget-alert-notify-'));
process.env.LIRI_DATA_DIR = dataDir;

let events: BudgetAlertEvent[] = [];

beforeEach(() => {
  resetDailyBudgetForTest();
  events = [];
  setBudgetAlertNotifier((event) => {
    events.push(event);
  });
});

afterEach(async () => {
  await getDailyBudget().persistNow();
  setBudgetAlertNotifier(null);
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

function readyBudget(limitUsd: number) {
  const budget = getDailyBudget();
  budget.enablePersistence();
  budget.setLimitUsd(limitUsd);
  return budget;
}

describe('预算告警通知端口', () => {
  it('进入 80% 告警区 ⇒ 通知一次（report_only）', () => {
    const budget = readyBudget(10);
    budget.recordUsdUsage(8.5);

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe('report_only');
    expect(events[0]?.title).toContain('告警区');
    expect(events[0]?.sourceRef.startsWith('budget:')).toBe(true);
  });

  it('越界 ⇒ 通知 locked（urgent 级别的标题文案）', () => {
    const budget = readyBudget(10);
    budget.recordUsdUsage(11);

    expect(events).toHaveLength(1);
    expect(events[0]?.mode).toBe('locked');
    expect(events[0]?.title).toContain('已用尽');
    expect(events[0]?.content).toContain('后续模型调用将被拒绝');
  });

  it('locked 期间继续记账 ⇒ 不重复通知', () => {
    const budget = readyBudget(10);
    budget.recordUsdUsage(11);
    budget.recordUsdUsage(1);

    expect(events).toHaveLength(1);
  });

  it('未接管持久化（未 enablePersistence）⇒ 不通知', () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(10);
    budget.recordUsdUsage(11);

    expect(events).toHaveLength(0);
  });
});
