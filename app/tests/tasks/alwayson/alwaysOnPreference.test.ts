/**
 * 「自主执行模式」开关的生效口径（2026-11-03）
 *
 * 缺陷背景：设置页的开关写配置（`PUT /v1/config/features` ⇒ `features.alwaysOn`），
 * 而后端 `startAlwaysOn()` 此前只调 `feature('ALWAYSON')`（只看 env / 变体层 / 静态默认）
 * ⇒ 用户关掉开关对后端无效（死开关）。
 *
 * 口径：`FEATURE_ALWAYSON` env（运维/灰度，最高）> 用户设置 > `feature()`（变体层 / 静态默认）。
 *
 * 说明：用**桩替换** `configManager.getConfigValue`（同 `PermissionCheckerInbox.test.ts` 的做法），
 * 不落盘 —— 避免测试污染真实配置文件。
 */
import { describe, it, expect, afterEach } from 'bun:test';

import { configManager } from '@openliri/infra/config';
import {
  readAlwaysOnPreference,
  resolveAlwaysOnEnabled,
} from '../../../src/entrypoints/alwaysOnEntry.js';

const originalGetConfigValue = configManager.getConfigValue;

/** 让 `getConfigValue('features')` 返回指定值（其它键保持原实现） */
function stubFeatures(value: unknown): void {
  const stub = (key: string) =>
    key === 'features'
      ? value
      : originalGetConfigValue.call(configManager, key);
  configManager.getConfigValue = stub as typeof configManager.getConfigValue;
}

afterEach(() => {
  configManager.getConfigValue = originalGetConfigValue;
  delete process.env.FEATURE_ALWAYSON;
});

describe('readAlwaysOnPreference', () => {
  it('缺失 / 非布尔 ⇒ undefined（不干预，回落默认）', () => {
    stubFeatures(undefined);
    expect(readAlwaysOnPreference()).toBeUndefined();

    stubFeatures({ alwaysOn: 'false' });
    expect(readAlwaysOnPreference()).toBeUndefined();
  });

  it('布尔值原样返回', () => {
    stubFeatures({ alwaysOn: false });
    expect(readAlwaysOnPreference()).toBe(false);

    stubFeatures({ alwaysOn: true });
    expect(readAlwaysOnPreference()).toBe(true);
  });
});

describe('resolveAlwaysOnEnabled：用户设置 → 后端生效', () => {
  it('无用户设置 ⇒ 回落静态默认（ALWAYSON 默认开）', () => {
    stubFeatures(undefined);
    expect(resolveAlwaysOnEnabled()).toBe(true);
  });

  it('用户关闭 ⇒ 生效为 false（修复死开关）', () => {
    stubFeatures({ alwaysOn: false });
    expect(resolveAlwaysOnEnabled()).toBe(false);
  });

  it('env 优先于用户设置（运维可强制关闭用户的开启）', () => {
    stubFeatures({ alwaysOn: true });
    process.env.FEATURE_ALWAYSON = 'false';
    expect(resolveAlwaysOnEnabled()).toBe(false);
  });
});
