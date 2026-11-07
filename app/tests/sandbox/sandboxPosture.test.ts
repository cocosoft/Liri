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
      // P2（2026-11-07）：姿态现在区分平台；本用例固定 linux 以断言"开关未开"分支
      platform: 'linux',
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
    // A5-①：语言中立编码与 openRisks 一一对应（前端按编码取 i18n 文案）
    expect(posture.openRiskCodes).toEqual([
      'mode-none',
      'landlock-fail-open',
      'landlock-bash-disabled',
    ]);
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
    expect(posture.openRiskCodes).toEqual([]);
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
    expect(posture.openRiskCodes).toEqual(['landlock-fail-open']);
  });

  test('未注入 overrides ⇒ 返回结构完整且可序列化（读真实配置）', () => {
    const posture = describeSandboxPosture();

    expect(['none', 'landlock', 'container', 'ssh', 'pty']).toContain(
      posture.mode
    );
    expect([
      'enforced',
      'windows-enforced',
      'switch-off',
      'windows-switch-off',
    ]).toContain(posture.bashSandboxReason);
    expect(typeof posture.landlock.enabled).toBe('boolean');
    expect(typeof posture.landlock.bashEnabled).toBe('boolean');
    expect(typeof posture.landlock.failClosed).toBe('boolean');
    expect(typeof posture.landlock.available).toBe('boolean');
    expect(Array.isArray(posture.openRisks)).toBe(true);
    expect(posture.openRiskCodes).toHaveLength(posture.openRisks.length);
    // 可 JSON 序列化（启动日志会原样落盘）
    expect(() => JSON.stringify(posture)).not.toThrow();
  });

  test('Windows + bashEnabled=false ⇒ 标注"默认不隔离、可显式开启"（不是平台做不到）', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      platform: 'win32',
      landlock: {
        enabled: true,
        bashEnabled: false,
        failClosed: true,
        available: false,
      },
    });

    expect(posture.bashSandboxReason).toBe('windows-switch-off');
    expect(posture.openRiskCodes).toContain('bash-sandbox-windows-opt-in');
    // 不能同时报"开关没开"（Windows 有专门文案，需要说明"开了也会临时改标签"）
    expect(posture.openRiskCodes).not.toContain('landlock-bash-disabled');
    expect(posture.openRisks.join('\n')).toContain('完整性标签');
  });

  test('Windows 但 bashEnabled=true ⇒ windows-enforced（已隔离）', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      platform: 'win32',
      landlock: {
        enabled: true,
        bashEnabled: true,
        failClosed: true,
        available: true,
      },
    });
    expect(posture.bashSandboxReason).toBe('windows-enforced');
    expect(posture.openRiskCodes).not.toContain('bash-sandbox-windows-opt-in');
  });
});
