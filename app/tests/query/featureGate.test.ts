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
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

import { resolveFeatureGate } from '@modules/query/featureGate';

const FLAG = 'SELF_VERIFY_PATTERN' as const;

/**
 * 本文件断言的开关环境变量。
 *
 * ⚠️ 2026-11-21（seed=11 取证）：`feature()` 的 env 层**最高优先**，而 env 可能是**宿主继承**来的
 * （实测本机 User 级作用域残留 `FEATURE_COMPETITIVE_STRATEGY=true`）⇒ 若"未设置回落默认"用例
 * 恰是本文件**第一个执行**的，`afterEach` 还没跑过 ⇒ 读到 env=true 而假红。
 * 隔离口径：每例开始**先清**这两个键（本文件语义就是"无 env"面），例末再清一次不回污他人。
 */
const ENV_KEYS = [
  'FEATURE_SELF_VERIFY_PATTERN',
  'FEATURE_COMPETITIVE_STRATEGY',
] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
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

  it('无 env + 用户未设置 ⇒ 回落静态默认（2026-11-16 起 SELF_VERIFY_PATTERN 默认 true）', () => {
    expect(resolveFeatureGate(FLAG, () => undefined)).toBe(true);
  });

  it('翻转为默认开后，用户显式关闭仍生效（回退路径）', () => {
    expect(resolveFeatureGate(FLAG, () => false)).toBe(false);
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

  // 2026-11-16：21 模式翻转后登记为「用户可关」的回退路径（env 之外的第二条路）
  it('TOOL_DISCLOSURE_STRICT / SWARM_VERIFY_RETRY 已登记 ⇒ 用户可关；未设置回落默认 true', () => {
    expect(resolveFeatureGate('TOOL_DISCLOSURE_STRICT', () => false)).toBe(
      false
    );
    expect(resolveFeatureGate('TOOL_DISCLOSURE_STRICT', () => undefined)).toBe(
      true
    );
    expect(resolveFeatureGate('SWARM_VERIFY_RETRY', () => false)).toBe(false);
    expect(resolveFeatureGate('SWARM_VERIFY_RETRY', () => undefined)).toBe(
      true
    );
  });

  it('env 对上述两项仍最高优先（运维可强制开启/关闭）', () => {
    process.env['FEATURE_TOOL_DISCLOSURE_STRICT'] = 'false';
    process.env['FEATURE_SWARM_VERIFY_RETRY'] = 'false';
    try {
      expect(resolveFeatureGate('TOOL_DISCLOSURE_STRICT', () => true)).toBe(
        false
      );
      expect(resolveFeatureGate('SWARM_VERIFY_RETRY', () => true)).toBe(false);
    } finally {
      delete process.env['FEATURE_TOOL_DISCLOSURE_STRICT'];
      delete process.env['FEATURE_SWARM_VERIFY_RETRY'];
    }
  });

  // 2026-11-16：启动期续跑三项同为「用户可关」回退路径
  it('PLAN_STARTUP_RESUME / PLAN_SYSTEM_RESUME / GOAL_STARTUP_RESUME 已登记 ⇒ 用户可关；未设置回落默认 true', () => {
    const flags = [
      'PLAN_STARTUP_RESUME',
      'PLAN_SYSTEM_RESUME',
      'GOAL_STARTUP_RESUME',
    ] as const;
    for (const flag of flags) {
      expect(resolveFeatureGate(flag, () => false)).toBe(false);
      expect(resolveFeatureGate(flag, () => undefined)).toBe(true);
    }
  });
});
