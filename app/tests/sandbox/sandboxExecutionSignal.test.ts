// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-3a：沙箱上下文信号（`sandbox/sandboxExecutionSignal`）单测。
 *
 * 覆盖三件事：
 * ① 权限位解析与**默认值 `standard`**（2026-10-23 拍板，Q-30）—— 防止被改回 `full`；
 * ② 模式推导**只用配置/平台事实**，无隔离证据一律 `none`（fail-closed）；
 * ③ `isSandboxSignalUsable` 对"缺失/`none`"返回 false ⇒ 将来豁免判定不会把缺失当放行。
 */

import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_SANDBOX_PERMISSION_LEVEL,
  isSandboxSignalUsable,
  resolveSandboxExecutionSignal,
  resolveSandboxPermissionLevel,
} from '../../src/sandbox/sandboxExecutionSignal.js';

describe('PR-3a 沙箱权限位解析', () => {
  it('未配置 ⇒ 默认 standard（不是 full）', () => {
    expect(DEFAULT_SANDBOX_PERMISSION_LEVEL).toBe('standard');
    expect(resolveSandboxPermissionLevel(undefined, undefined)).toBe(
      'standard'
    );
  });

  it('配置优先于环境变量', () => {
    expect(resolveSandboxPermissionLevel('readonly', 'full')).toBe('readonly');
    expect(resolveSandboxPermissionLevel('full', 'readonly')).toBe('full');
  });

  it('配置为空串 ⇒ 回退环境变量', () => {
    expect(resolveSandboxPermissionLevel('   ', 'readonly')).toBe('readonly');
  });

  it('非法取值 ⇒ 回到默认 standard（fail-safe，不放宽到 full）', () => {
    expect(resolveSandboxPermissionLevel('FULLL', undefined)).toBe('standard');
    expect(resolveSandboxPermissionLevel(123, undefined)).toBe('standard');
  });

  it('大小写与空白归一', () => {
    expect(resolveSandboxPermissionLevel('  FULL ', undefined)).toBe('full');
  });
});

describe('PR-3a 沙箱模式推导', () => {
  it('沙箱关闭 ⇒ none（即使给了 landlock 开关）', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: false,
        landlockEnabled: true,
        platform: 'linux',
        permissionLevel: 'standard',
        fileIoIsolated: false,
        fileIoRoots: [],
      })
    ).toEqual({
      mode: 'none',
      permissionLevel: 'standard',
      fileIoIsolated: false,
      fileIoRoots: [],
    });
  });

  it('沙箱关闭 ⇒ modeHint 也不生效（不让提示绕过总开关）', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: false,
        modeHint: 'container',
        permissionLevel: 'full',
      }).mode
    ).toBe('none');
  });

  it('启用 + Landlock 开 + Linux + **能力探测通过** ⇒ landlock', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: true,
        landlockEnabled: true,
        platform: 'linux',
        landlockAvailable: true,
        permissionLevel: 'standard',
        fileIoIsolated: false,
        fileIoRoots: [],
      })
    ).toEqual({
      mode: 'landlock',
      permissionLevel: 'standard',
      fileIoIsolated: false,
      fileIoRoots: [],
    });
  });

  it('启用 + Landlock 开 + Linux，但**能力探测未通过** ⇒ none（配置不等于隔离）', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: true,
        landlockEnabled: true,
        platform: 'linux',
        landlockAvailable: false,
        permissionLevel: 'standard',
      }).mode
    ).toBe('none');
  });

  it('启用但平台不支持 Landlock ⇒ none（无隔离证据）', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: true,
        landlockEnabled: true,
        platform: 'win32',
        landlockAvailable: true,
        permissionLevel: 'standard',
      }).mode
    ).toBe('none');
  });

  it('启用但 Landlock 关闭 ⇒ none', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: true,
        landlockEnabled: false,
        platform: 'linux',
        landlockAvailable: true,
        permissionLevel: 'standard',
      }).mode
    ).toBe('none');
  });

  it('执行入口给 modeHint ⇒ 采用（容器/SSH/PTY 由适配器上报）', () => {
    expect(
      resolveSandboxExecutionSignal({
        enabled: true,
        landlockEnabled: false,
        platform: 'win32',
        modeHint: 'ssh',
        permissionLevel: 'readonly',
        fileIoIsolated: false,
        fileIoRoots: [],
      })
    ).toEqual({
      mode: 'ssh',
      permissionLevel: 'readonly',
      fileIoIsolated: false,
      fileIoRoots: [],
    });
  });
});

describe('PR-3a 豁免可用性（fail-closed）', () => {
  it('字段缺失 ⇒ 不可用', () => {
    expect(isSandboxSignalUsable(undefined)).toBe(false);
  });

  it("mode='none' ⇒ 不可用", () => {
    expect(
      isSandboxSignalUsable({ mode: 'none', permissionLevel: 'full' })
    ).toBe(false);
  });

  it('有隔离模式 ⇒ 可用（权限位仍需 PR-3b 的 S2/S3 复核）', () => {
    expect(
      isSandboxSignalUsable({ mode: 'landlock', permissionLevel: 'readonly' })
    ).toBe(true);
  });
});
