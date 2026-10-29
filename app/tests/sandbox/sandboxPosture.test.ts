// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `describeSandboxPosture` 单测（issue #7，2026-10-29）
 *
 * 目标：让「本次执行是否受内核级约束」有**可断言**的载体 —— 两个默认 fail-open
 * （`sandbox.landlock.failClosed` / `bashEnabled` 均默认 false）必须在 `openRisks` 里
 * 如实出现，且**只在风险实际存在时**出现（不无脑刷警告）。
 *
 * 说明：全部用例用 overrides 注入，不读真实配置/探测缓存（零环境依赖）。
 */

import { describe, expect, test } from 'bun:test';
import { describeSandboxPosture } from '../../src/sandbox/sandboxPosture';

describe('describeSandboxPosture（#7 沙箱姿态可读化）', () => {
  test('mode=none + 两个 fail-open 默认 ⇒ 三条风险全部列出', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      permissionLevel: 'standard',
      landlock: {
        enabled: true,
        bashEnabled: false,
        failClosed: false,
        available: false,
      },
    });

    expect(posture.mode).toBe('none');
    expect(posture.landlock).toEqual({
      enabled: true,
      bashEnabled: false,
      failClosed: false,
      available: false,
    });
    expect(posture.openRisks).toHaveLength(3);
    expect(posture.openRisks.join('\n')).toContain('mode=none');
    expect(posture.openRisks.join('\n')).toContain('failClosed=false');
    expect(posture.openRisks.join('\n')).toContain('bashEnabled=false');
  });

  test('landlock 生效 + failClosed=true + bashEnabled=true ⇒ 零风险（不刷警告）', () => {
    const posture = describeSandboxPosture({
      mode: 'landlock',
      permissionLevel: 'standard',
      landlock: {
        enabled: true,
        bashEnabled: true,
        failClosed: true,
        available: true,
      },
    });

    expect(posture.openRisks).toEqual([]);
  });

  test('只有 failClosed=false ⇒ 只报一条（不牵连其他项）', () => {
    const posture = describeSandboxPosture({
      mode: 'landlock',
      landlock: {
        enabled: true,
        bashEnabled: true,
        failClosed: false,
        available: true,
      },
    });

    expect(posture.openRisks).toHaveLength(1);
    expect(posture.openRisks[0]).toContain('failClosed=false');
  });

  test('未注入 overrides ⇒ 返回结构完整且可序列化（读真实配置）', () => {
    const posture = describeSandboxPosture();

    expect(['none', 'landlock', 'container', 'ssh', 'pty']).toContain(
      posture.mode
    );
    expect(typeof posture.landlock.enabled).toBe('boolean');
    expect(typeof posture.landlock.bashEnabled).toBe('boolean');
    expect(typeof posture.landlock.failClosed).toBe('boolean');
    expect(typeof posture.landlock.available).toBe('boolean');
    expect(Array.isArray(posture.openRisks)).toBe(true);
    // 可 JSON 序列化（启动日志会原样落盘）
    expect(() => JSON.stringify(posture)).not.toThrow();
  });
});
