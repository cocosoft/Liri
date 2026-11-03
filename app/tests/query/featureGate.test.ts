// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 用户可配门控解析单测（2026-11-03）
 *
 * 背景：`feature()` 只读 env → 构建变体 → 静态默认，不看用户配置；设置页写的是
 * `config.features.<key>` ⇒ 只在设置里打开的开关是**死开关**（AlwaysOn 已踩过一次）。
 * 本组钉住 `resolveFeatureGate` 的优先级：env > 用户设置 > `feature()`，
 * 且**未登记**的开关逐字走 `feature()`（零行为变化）。
 */
import { describe, expect, it, afterEach } from 'bun:test';

import { resolveFeatureGate } from '../../src/query/featureGate';

const FLAG = 'SELF_VERIFY_PATTERN' as const;

afterEach(() => {
  delete process.env['FEATURE_SELF_VERIFY_PATTERN'];
  delete process.env['FEATURE_COMPETITIVE_STRATEGY'];
});

describe('resolveFeatureGate：env > 用户设置 > feature()', () => {
  it('env 显式 true ⇒ 忽略用户设置（运维/灰度优先）', () => {
    process.env['FEATURE_SELF_VERIFY_PATTERN'] = 'true';
    expect(resolveFeatureGate(FLAG, () => false)).toBe(true);
  });

  it('env 显式 false ⇒ 即使设置里开启也保持关闭', () => {
    process.env['FEATURE_SELF_VERIFY_PATTERN'] = 'false';
    expect(resolveFeatureGate(FLAG, () => true)).toBe(false);
  });

  it('无 env + 用户开启 ⇒ 生效（本片修复的正是这条：设置页开关不再是死开关）', () => {
    expect(resolveFeatureGate(FLAG, () => true)).toBe(true);
  });

  it('无 env + 用户未设置 ⇒ 回落静态默认（SELF_VERIFY_PATTERN 默认 false）', () => {
    expect(resolveFeatureGate(FLAG, () => undefined)).toBe(false);
  });

  it('未登记开关 ⇒ 不读用户设置（零行为变化）', () => {
    // `PRO_SECURITY_SUITE` 未登记 ⇒ 即使读取器返回 true 也不采纳，仍取静态默认 false
    expect(resolveFeatureGate('PRO_SECURITY_SUITE', () => true)).toBe(false);
  });

  // 2026-11-03（缺口 #3）：研究编排门控同属"桌面默认不可达"，一并登记
  it('COMPETITIVE_STRATEGY 已登记 ⇒ 用户设置可开启；未设置回落默认 false', () => {
    expect(resolveFeatureGate('COMPETITIVE_STRATEGY', () => true)).toBe(true);
    expect(resolveFeatureGate('COMPETITIVE_STRATEGY', () => undefined)).toBe(
      false
    );
  });
});
