/**
 * 自主执行运行预算（2026-11-03 P0）
 *
 * 口径：持久化在 `autonomy.limits`；缺失/脏值逐字段回落默认；局部更新保留其余字段。
 * 默认值由 20/200/4/60 放宽为 45/400/8/30（长程任务跑不到进度就被停的根因之一）。
 *
 * 说明：桩替换 `configManager` 读写（同 `projectAutonomy.test.ts`），不落盘。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { configManager } from '@openliri/infra/config';
import {
  AUTONOMY_LIMITS_CONFIG_KEY,
  DEFAULT_AUTONOMY_LIMITS,
  readAutonomyLimits,
  setAutonomyLimits,
} from '@openliri/infra/config';

const originalGet = configManager.getConfigValue;
const originalSet = configManager.setConfigValue;

let stored: unknown;

beforeEach(() => {
  stored = undefined;
  const stubGet = (key: string) =>
    key === AUTONOMY_LIMITS_CONFIG_KEY
      ? stored
      : originalGet.call(configManager, key);
  configManager.getConfigValue = stubGet as typeof configManager.getConfigValue;
  configManager.setConfigValue = ((key: string, value: unknown) => {
    if (key === AUTONOMY_LIMITS_CONFIG_KEY) stored = value;
  }) as typeof configManager.setConfigValue;
});

afterEach(() => {
  configManager.getConfigValue = originalGet;
  configManager.setConfigValue = originalSet;
});

describe('readAutonomyLimits', () => {
  it('无配置 ⇒ 放宽后的默认值', () => {
    expect(readAutonomyLimits()).toEqual(DEFAULT_AUTONOMY_LIMITS);
    expect(DEFAULT_AUTONOMY_LIMITS).toEqual({
      timeoutMinutes: 45,
      maxToolCalls: 400,
      dailyBudget: 8,
      cooldownMinutes: 30,
    });
  });

  it('脏值 / 越界 / 非数字 ⇒ 逐字段回落默认（不整体失效）', () => {
    stored = {
      timeoutMinutes: 'abc',
      maxToolCalls: 0, // 低于下限
      dailyBudget: 999, // 高于上限
      cooldownMinutes: 15,
    };
    expect(readAutonomyLimits()).toEqual({
      timeoutMinutes: DEFAULT_AUTONOMY_LIMITS.timeoutMinutes,
      maxToolCalls: DEFAULT_AUTONOMY_LIMITS.maxToolCalls,
      dailyBudget: DEFAULT_AUTONOMY_LIMITS.dailyBudget,
      cooldownMinutes: 15,
    });
  });

  it('非对象值 ⇒ 默认值（不抛错）', () => {
    stored = 'oops';
    expect(readAutonomyLimits()).toEqual(DEFAULT_AUTONOMY_LIMITS);
  });
});

describe('setAutonomyLimits', () => {
  it('局部更新保留其余字段，并写入完整对象', () => {
    setAutonomyLimits({ dailyBudget: 12 });
    expect(readAutonomyLimits()).toEqual({
      ...DEFAULT_AUTONOMY_LIMITS,
      dailyBudget: 12,
    });

    setAutonomyLimits({ timeoutMinutes: 90, cooldownMinutes: 10 });
    expect(readAutonomyLimits()).toEqual({
      timeoutMinutes: 90,
      maxToolCalls: DEFAULT_AUTONOMY_LIMITS.maxToolCalls,
      dailyBudget: 12,
      cooldownMinutes: 10,
    });
    expect(stored).toEqual(readAutonomyLimits());
  });

  it('越界值不写入（回落默认）', () => {
    setAutonomyLimits({ dailyBudget: 200 });
    expect(readAutonomyLimits().dailyBudget).toBe(
      DEFAULT_AUTONOMY_LIMITS.dailyBudget
    );
  });
});
