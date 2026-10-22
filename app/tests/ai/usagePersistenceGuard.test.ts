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
import { shouldSkipUsagePersistence } from '../../src/ai/UsageTracker.js';

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
