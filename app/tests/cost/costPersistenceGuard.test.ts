// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 附录 B2「成本表测试数据」收口：`COST_RECORDED` 订阅者的**测试来源护栏**。
 *
 * 背景（实测）：`cost_records` 曾出现 `zzz-unknown-test-model` **1 次 $18** 与 `test-model` 10 次
 * —— 单测只 fake 了 provider，落库这一段没 fake 也没隔离数据目录，于是写进 `~/.pyapp/data/app.db`；
 * 而 `dailyBudgetGate` 以 USD 为唯一硬闸 ⇒ 一条 $18 的测试行足以吃掉当日额度。
 *
 * 判据（与 `UsageTracker.shouldSkipUsagePersistence` 逐字对齐）：测试环境 **且** 调用方未显式
 * 隔离数据目录（`setUserDataDirOverride` / `LIRI_DATA_DIR` / `LIRI_HOME`）⇒ 跳过落库。
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { shouldSkipCostEventPersistence } from '@openliri/infra/cost/costPersistenceGuard';

const COST_INDEX_SRC = readFileSync(
  new URL('../../../packages/infra/src/cost/index.ts', import.meta.url),
  'utf8'
);

describe('shouldSkipCostEventPersistence：判据', () => {
  it('测试环境 + 完全未隔离 ⇒ 跳过（污染生产库的唯一入口）', () => {
    expect(shouldSkipCostEventPersistence({ NODE_ENV: 'test' }, null)).toBe(
      true
    );
  });

  it('测试环境 + LIRI_DATA_DIR / LIRI_HOME / 显式 override 任一存在 ⇒ 不跳过', () => {
    expect(
      shouldSkipCostEventPersistence(
        { NODE_ENV: 'test', LIRI_DATA_DIR: '/tmp/liri-cost-test' },
        null
      )
    ).toBe(false);
    expect(
      shouldSkipCostEventPersistence(
        { NODE_ENV: 'test', LIRI_HOME: '/tmp/liri-home' },
        null
      )
    ).toBe(false);
    expect(
      shouldSkipCostEventPersistence({ NODE_ENV: 'test' }, '/tmp/liri-override')
    ).toBe(false);
  });

  it('空串 / 全空白的隔离变量不算隔离（不能靠空值绕过护栏）', () => {
    expect(
      shouldSkipCostEventPersistence(
        { NODE_ENV: 'test', LIRI_DATA_DIR: '', LIRI_HOME: '   ' },
        null
      )
    ).toBe(true);
  });

  it('非测试环境一律不跳过（生产 / 开发 / 未设置）', () => {
    expect(
      shouldSkipCostEventPersistence({ NODE_ENV: 'production' }, null)
    ).toBe(false);
    expect(
      shouldSkipCostEventPersistence({ NODE_ENV: 'development' }, null)
    ).toBe(false);
    expect(shouldSkipCostEventPersistence({}, null)).toBe(false);
  });
});

describe('接线：护栏必须挡在落库之前（且不影响同订阅里的其它副作用）', () => {
  it('`recordCost` 位于 `else` 分支内，护栏判定在其之前', () => {
    const guardIdx = COST_INDEX_SRC.indexOf(
      'if (shouldSkipCostEventPersistence())'
    );
    const persistIdx = COST_INDEX_SRC.indexOf('await eventRepo.recordCost({');

    expect(guardIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(persistIdx);

    // 跳过时不得静默吞掉「落库以外的」副作用开关：落库必须挂在 guard 的 else 分支
    const between = COST_INDEX_SRC.slice(guardIdx, persistIdx);
    expect(between).toContain('} else {');
  });

  it('订阅者仍保留 OTel 指标 / 预算告警 / 缓存失效（护栏只挡落库这一段）', () => {
    expect(COST_INDEX_SRC).toContain('getBridge().record(');
    expect(COST_INDEX_SRC).toContain('recordCost(event.costUSD');
    expect(COST_INDEX_SRC).toContain('getDailyCostCache().invalidate()');
  });
});
