/**
 * 按项目的「自主执行」开关
 *
 * 口径（2026-11-05 起）：持久化在配置 `autonomy.projects`（`{ [projectId]: { enabled } }`），
 * **缺省 = 关**；只有显式 `enabled: true` 才允许该项目自主运行。
 * （变更原因：原「缺省开」使 14 个注册项目在启动后同时自动开工。）
 *
 * 说明：用**桩替换** `configManager` 的读写（同 `PermissionCheckerInbox.test.ts`），不落盘。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { configManager } from '@openliri/infra/config';
import {
  PROJECT_AUTONOMY_CONFIG_KEY,
  isProjectAutonomyEnabled,
  readProjectAutonomyMap,
  setProjectAutonomyEnabled,
} from '@openliri/infra/config';

const originalGet = configManager.getConfigValue;
const originalSet = configManager.setConfigValue;

let stored: unknown;

beforeEach(() => {
  stored = undefined;
  const stubGet = (key: string) =>
    key === PROJECT_AUTONOMY_CONFIG_KEY
      ? stored
      : originalGet.call(configManager, key);
  configManager.getConfigValue = stubGet as typeof configManager.getConfigValue;
  configManager.setConfigValue = ((key: string, value: unknown) => {
    if (key === PROJECT_AUTONOMY_CONFIG_KEY) stored = value;
  }) as typeof configManager.setConfigValue;
});

afterEach(() => {
  configManager.getConfigValue = originalGet;
  configManager.setConfigValue = originalSet;
});

describe('projectAutonomy：缺省关 / 显式开', () => {
  it('没有任何配置 ⇒ 空表且视为**关闭**（不再自动开工）', () => {
    expect(readProjectAutonomyMap()).toEqual({});
    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(false);
  });

  it('非对象值（脏配置）⇒ 空表，不抛错，且按关闭处理', () => {
    stored = 'oops';
    expect(readProjectAutonomyMap()).toEqual({});
    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(false);
  });

  it('只开启显式 enabled:true 的项目；未写条目 / 条目缺 enabled 均视为关闭', () => {
    setProjectAutonomyEnabled('proj_1_aa', true);
    stored = { proj_1_aa: { enabled: true }, proj_2_bb: {} };

    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(true);
    expect(isProjectAutonomyEnabled('proj_2_bb')).toBe(false);
    expect(isProjectAutonomyEnabled('proj_3_cc')).toBe(false);
  });

  it('暂停某项目 ⇒ 写 enabled:false；写入整表（含既有条目）', () => {
    setProjectAutonomyEnabled('proj_1_aa', true);
    setProjectAutonomyEnabled('proj_2_bb', false);

    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(true);
    expect(isProjectAutonomyEnabled('proj_2_bb')).toBe(false);
    expect(readProjectAutonomyMap()).toEqual({
      proj_1_aa: { enabled: true },
      proj_2_bb: { enabled: false },
    });
  });

  it('恢复某项目 ⇒ 回到 true（显式 enabled:true，不是删键）', () => {
    setProjectAutonomyEnabled('proj_1_aa', false);
    setProjectAutonomyEnabled('proj_1_aa', true);
    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(true);
    expect(readProjectAutonomyMap()).toEqual({
      proj_1_aa: { enabled: true },
    });
  });
});
