/**
 * BUG-06（2026-10-22 前端巡检）：测试期用量落盘护栏
 *
 * 回归的是"单测写生产库"：大量 fake 了 provider 的用例仍会走真实 `trackUsage()`，
 * 而 `model_usage_logs` / `cost_records` 落在 `resolveDbPath()` ⇒ 真实
 * `~/.pyapp/data/app.db` 出现 `fake-model / test-provider / mock` 记录，
 * 前端「用量总览」把它们当真实用量展示。
 *
 * 护栏判据（见 `shouldSkipUsagePersistence`）：测试环境 **且** 调用方未显式隔离
 * 数据目录时才跳过 —— 显式隔离的用例（如 `usageTrackerIdentity.test.ts`）行为不变。
 */
import { describe, it, expect } from 'bun:test';
import {
  shouldSkipUsagePersistence,
  shouldSkipUsageStatsWrite,
} from '../../src/ai/UsageTracker.js';

describe('UsageTracker：测试期落盘护栏', () => {
  it('测试环境 + 未隔离数据目录 ⇒ 跳过落盘', () => {
    expect(shouldSkipUsagePersistence({ NODE_ENV: 'test' }, null)).toBe(true);
  });

  it('测试环境 + setUserDataDirOverride ⇒ 正常落盘（保留可断言的真实写入）', () => {
    expect(
      shouldSkipUsagePersistence({ NODE_ENV: 'test' }, '/tmp/liri-usage-test')
    ).toBe(false);
  });

  it('测试环境 + LIRI_HOME / LIRI_DATA_DIR ⇒ 正常落盘（临时根由用例接管）', () => {
    expect(
      shouldSkipUsagePersistence(
        { NODE_ENV: 'test', LIRI_HOME: '/tmp/x' },
        null
      )
    ).toBe(false);
    expect(
      shouldSkipUsagePersistence(
        { NODE_ENV: 'test', LIRI_DATA_DIR: '/tmp/x/data' },
        null
      )
    ).toBe(false);
  });

  it('非测试环境 ⇒ 永不跳过（生产/开发行为零变更）', () => {
    expect(shouldSkipUsagePersistence({ NODE_ENV: 'production' }, null)).toBe(
      false
    );
    expect(shouldSkipUsagePersistence({ NODE_ENV: 'development' }, null)).toBe(
      false
    );
    expect(shouldSkipUsagePersistence({}, null)).toBe(false);
  });
});

/**
 * 第二道护栏（实测残留 4 行/轮）：`UsageStatsService` 单例在首次 import 时把库路径
 * 固化为实例字段 —— 测试期"先绑真实库、后换临时根"时第一道护栏会放行，写入仍落真实库。
 */
describe('UsageTracker：用量库路径漂移护栏', () => {
  it('测试环境 + 实例路径 ≠ 当前解析路径 ⇒ 跳过', () => {
    expect(
      shouldSkipUsageStatsWrite(
        '/home/u/.pyapp/data/app.db',
        { NODE_ENV: 'test' },
        '/tmp/liri-test/data/app.db'
      )
    ).toBe(true);
  });

  it('测试环境 + 实例路径 = 当前解析路径 ⇒ 放行（正常隔离写入）', () => {
    expect(
      shouldSkipUsageStatsWrite(
        '/tmp/liri-test/data/app.db',
        { NODE_ENV: 'test' },
        '/tmp/liri-test/data/app.db'
      )
    ).toBe(false);
  });

  it('非测试环境 ⇒ 永不跳过（即便路径不一致，生产也不静默丢账）', () => {
    expect(
      shouldSkipUsageStatsWrite(
        '/a/app.db',
        { NODE_ENV: 'production' },
        '/b/app.db'
      )
    ).toBe(false);
  });
});
