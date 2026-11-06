// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 通知落库护栏（2026-11-06）
 *
 * 判据与 `shouldSkipCostEventPersistence` / `shouldSkipUsagePersistence` 逐字对齐：
 * 测试环境 **且** 未显式隔离数据目录 **且** 未显式传 dbPath ⇒ 跳过落库。
 */
import { describe, expect, it } from 'bun:test';
import { shouldSkipNotificationPersistence } from '@openliri/service/runtime/notificationPersistenceGuard';

describe('shouldSkipNotificationPersistence：判据', () => {
  it('测试环境 + 未隔离数据目录 ⇒ 跳过', () => {
    expect(shouldSkipNotificationPersistence({ NODE_ENV: 'test' }, null)).toBe(
      true
    );
  });

  it('显式隔离数据目录（LIRI_DATA_DIR / LIRI_HOME）⇒ 不跳过', () => {
    expect(
      shouldSkipNotificationPersistence(
        { NODE_ENV: 'test', LIRI_DATA_DIR: '/tmp/liri-notify' },
        null
      )
    ).toBe(false);
    expect(
      shouldSkipNotificationPersistence(
        { NODE_ENV: 'test', LIRI_HOME: '/tmp/liri-home' },
        null
      )
    ).toBe(false);
  });

  it('setUserDataDirOverride 已设置 ⇒ 不跳过', () => {
    expect(
      shouldSkipNotificationPersistence(
        { NODE_ENV: 'test' },
        '/tmp/liri-override'
      )
    ).toBe(false);
  });

  it('实例显式传 dbPath（单测自带临时库）⇒ 不跳过', () => {
    expect(
      shouldSkipNotificationPersistence({ NODE_ENV: 'test' }, null, true)
    ).toBe(false);
  });

  it('非测试环境 ⇒ 不跳过（生产行为不变）', () => {
    expect(
      shouldSkipNotificationPersistence({ NODE_ENV: 'production' }, null)
    ).toBe(false);
    expect(
      shouldSkipNotificationPersistence({ NODE_ENV: 'development' }, null)
    ).toBe(false);
    expect(shouldSkipNotificationPersistence({}, null)).toBe(false);
  });
});
