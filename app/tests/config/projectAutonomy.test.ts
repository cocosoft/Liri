/**
 * 按项目的「自主执行」开关（2026-11-03）
 *
 * 口径：持久化在配置 `autonomy.projects`（`{ [projectId]: { enabled } }`），**缺省 = 开**；
 * 只有显式 `enabled: false` 才暂停该项目。
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

describe('projectAutonomy：缺省开 / 显式关', () => {
  it('没有任何配置 ⇒ 空表且视为开启', () => {
    expect(readProjectAutonomyMap()).toEqual({});
    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(true);
  });

  it('非对象值（脏配置）⇒ 空表，不抛错', () => {
    stored = 'oops';
    expect(readProjectAutonomyMap()).toEqual({});
    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(true);
  });

  it('暂停某项目 ⇒ 该 false、其它仍 true；写入整表（含既有条目）', () => {
    setProjectAutonomyEnabled('proj_2_bb', false);
    setProjectAutonomyEnabled('proj_1_aa', false);

    expect(isProjectAutonomyEnabled('proj_1_aa')).toBe(false);
    expect(isProjectAutonomyEnabled('proj_2_bb')).toBe(false);
    expect(isProjectAutonomyEnabled('proj_3_cc')).toBe(true);
    expect(readProjectAutonomyMap()).toEqual({
      proj_2_bb: { enabled: false },
      proj_1_aa: { enabled: false },
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
