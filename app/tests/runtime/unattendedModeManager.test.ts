// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F11（2026-11-22）：无人值守开关必须走运行时求值。
 *
 * 背景（二次复查）：`isUnattended()` 直接读静态 `FEATURE_FLAGS.UNATTENDED_MODE`
 * ⇒ `FEATURE_UNATTENDED_MODE` 环境变量不生效。现改为 `feature('UNATTENDED_MODE')`
 * （env > 变体 > 静态默认），运行时 `setEnabled` 覆盖优先。
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { unattendedMode } from '@openliri/service/runtime/UnattendedModeManager';

afterEach(() => {
  unattendedMode.setEnabled(false);
});

describe('F11：无人值守开关', () => {
  it('默认关闭（测试环境静态默认 false）', () => {
    expect(unattendedMode.isUnattended()).toBe(false);
  });

  it('运行时覆盖优先', () => {
    unattendedMode.setEnabled(true);
    expect(unattendedMode.isUnattended()).toBe(true);

    unattendedMode.setEnabled(false);
    expect(unattendedMode.isUnattended()).toBe(false);
  });
});
