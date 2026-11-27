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
import { describeSandboxPosture } from '@modules/sandbox/sandboxPosture';

describe('describeSandboxPosture（#7 沙箱姿态可读化）', () => {
  test('mode=none + 两个 fail-open 默认 ⇒ 三条风险全部列出', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      permissionLevel: 'standard',
      // P2（2026-11-07）：姿态现在区分平台；本用例固定 linux 以断言"开关未开"分支
      platform: 'linux',
      // 2026-11-26：本机写隔离未生效（显式注入，避免依赖真实平台能力探测）
      shellWriteIsolated: false,
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
    // 2026-11-26：第三条的含义换成"非只读命令的写隔离没生效 ⇒ 降级普通执行"
    expect(posture.openRisks.join('\n')).toContain('写隔离未生效');
    // A5-①：语言中立编码与 openRisks 一一对应（前端按编码取 i18n 文案）
    expect(posture.openRiskCodes).toEqual([
      'mode-none',
      'landlock-fail-open',
      'landlock-bash-disabled',
    ]);
    expect(posture.shellWriteIsolated).toBe(false);
  });

  test('landlock 生效 + failClosed=true + bashEnabled=true ⇒ 零风险（不刷警告）', () => {
    const posture = describeSandboxPosture({
      mode: 'landlock',
      permissionLevel: 'standard',
      shellWriteIsolated: true,
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
      shellWriteIsolated: true,
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
    expect(typeof posture.shellWriteIsolated).toBe('boolean');
    // 2026-11-27（A 组）：写隔离后端名（none ⇔ 未生效），供状态页如实展示
    expect(['landlock', 'sandbox-exec', 'windows-low-il', 'none']).toContain(
      posture.shellWriteIsolation
    );
    expect(posture.shellWriteIsolation === 'none').toBe(
      posture.shellWriteIsolated === false
    );
    expect(Array.isArray(posture.openRisks)).toBe(true);
    expect(posture.openRiskCodes).toHaveLength(posture.openRisks.length);
    // 可 JSON 序列化（启动日志会原样落盘）
    expect(() => JSON.stringify(posture)).not.toThrow();
  });

  // 2026-11-26（用户裁定「非只读命令强制沙箱」）：姿态改报"写隔离是否真的生效"
  test('Windows + bashEnabled=false + 写隔离已生效 ⇒ 不报风险（非只读命令仍被隔离）', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      platform: 'win32',
      shellWriteIsolated: true,
      landlock: {
        enabled: true,
        bashEnabled: false,
        failClosed: true,
        available: false,
      },
    });

    expect(posture.bashSandboxReason).toBe('windows-switch-off');
    expect(posture.shellWriteIsolated).toBe(true);
    expect(posture.openRiskCodes).not.toContain('landlock-bash-disabled');
    expect(posture.openRisks.join('\n')).not.toContain('写隔离未生效');
  });

  test('写隔离未生效（能力未就绪 / 总开关关闭）⇒ 如实报"降级普通执行"', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      platform: 'win32',
      shellWriteIsolated: false,
      landlock: {
        enabled: true,
        bashEnabled: false,
        failClosed: true,
        available: false,
      },
    });

    expect(posture.shellWriteIsolated).toBe(false);
    expect(posture.openRiskCodes).toContain('landlock-bash-disabled');
    expect(posture.openRisks.join('\n')).toContain('写隔离未生效');
  });

  test('Windows 且 bashEnabled=true ⇒ bashSandboxReason=windows-enforced（开关口径保留）', () => {
    const posture = describeSandboxPosture({
      mode: 'none',
      platform: 'win32',
      shellWriteIsolated: true,
      landlock: {
        enabled: true,
        bashEnabled: true,
        failClosed: true,
        available: true,
      },
    });
    expect(posture.bashSandboxReason).toBe('windows-enforced');
  });
});
