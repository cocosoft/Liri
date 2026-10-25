// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// macOS 兜底沙箱：门控判据 + `sandbox-exec` argv 形状（2026-10-26，方案 §5）
//
// 重点锁「开启即真受限」：macOS 上能力不可用必须 refuse（不得降级为 plain），
// 且 linux / 其他平台的原判据零变更（回归）。
import { describe, expect, it } from 'bun:test';
import { decideBashLandlockGate } from '../../src/tools/bash/bashLandlockExec';
import { buildSandboxExecArgv } from '../../src/sandbox/darwin/runWithSandboxExec';
import type { LandlockConfig } from '../../src/sandbox/landlock/config';
import type { LandlockCapability } from '../../src/sandbox/landlock/types';

const onConfig: LandlockConfig = {
  enabled: true,
  failClosed: false,
  bashEnabled: true,
  bashExtraWritablePaths: [],
};

const linuxCapability: LandlockCapability = {
  available: true,
  abi: 6,
} as LandlockCapability;

const macAvailable = {
  available: true,
  path: '/usr/bin/sandbox-exec',
};
const macUnavailable = {
  available: false,
  reason: '未找到 /usr/bin/sandbox-exec（系统未提供 Seatbelt 工具）',
};

describe('decideBashLandlockGate — macOS 分支', () => {
  it('darwin + 开关开 + 能力可用 ⇒ sandbox-exec', () => {
    expect(
      decideBashLandlockGate({
        config: onConfig,
        platform: 'darwin',
        capability: null,
        macCapability: macAvailable,
      })
    ).toEqual({ mode: 'sandbox-exec', reason: 'macos-enabled' });
  });

  it('darwin + 能力不可用 ⇒ refuse（fail-closed，不降级 plain）', () => {
    const gate = decideBashLandlockGate({
      config: onConfig,
      platform: 'darwin',
      capability: null,
      macCapability: macUnavailable,
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.reason).toBe('macos-capability-unavailable');
    expect(gate.message).toContain('/usr/bin/sandbox-exec');
  });

  it('darwin + 未传能力 ⇒ 按不可用处理（缺省不等于放行）', () => {
    const gate = decideBashLandlockGate({
      config: onConfig,
      platform: 'darwin',
      capability: null,
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.reason).toBe('macos-capability-unavailable');
  });

  it('darwin + bashEnabled=false ⇒ plain（默认零变更）', () => {
    expect(
      decideBashLandlockGate({
        config: { ...onConfig, bashEnabled: false },
        platform: 'darwin',
        capability: null,
        macCapability: macAvailable,
      })
    ).toEqual({ mode: 'plain', reason: 'switch-off' });
  });

  it('darwin + 总开关关 ⇒ plain/master-off（先于平台判断）', () => {
    expect(
      decideBashLandlockGate({
        config: { ...onConfig, enabled: false },
        platform: 'darwin',
        capability: null,
        macCapability: macAvailable,
      })
    ).toEqual({ mode: 'plain', reason: 'master-off' });
  });
});

describe('decideBashLandlockGate — 其他平台回归', () => {
  it('linux + 能力可用 ⇒ landlock（未受 macOS 分支影响）', () => {
    expect(
      decideBashLandlockGate({
        config: onConfig,
        platform: 'linux',
        capability: linuxCapability,
      })
    ).toEqual({ mode: 'landlock', reason: 'enabled' });
  });

  it('linux + 能力不可用 ⇒ refuse/capability-unavailable', () => {
    const gate = decideBashLandlockGate({
      config: onConfig,
      platform: 'linux',
      capability: {
        available: false,
        reason: 'helper-missing',
        abi: 0,
      },
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.reason).toBe('capability-unavailable');
  });

  it('win32 + 开关开 ⇒ refuse/platform-unsupported（Windows 仍无兜底）', () => {
    const gate = decideBashLandlockGate({
      config: onConfig,
      platform: 'win32',
      capability: null,
      macCapability: macAvailable,
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.reason).toBe('platform-unsupported');
  });

  it('eval-forced 语义不变（评测期回退 plain）', () => {
    expect(
      decideBashLandlockGate({
        config: onConfig,
        platform: 'darwin',
        capability: null,
        macCapability: macAvailable,
        evalForced: true,
      })
    ).toEqual({ mode: 'plain', reason: 'eval-forced-fallback' });
  });
});

describe('buildSandboxExecArgv', () => {
  it('形状：[-p, <profile>, --, <shell>, -c, <command>]', () => {
    expect(
      buildSandboxExecArgv({ profile: '(deny default)', command: 'echo hi' })
    ).toEqual(['-p', '(deny default)', '--', '/bin/bash', '-c', 'echo hi']);
  });

  it('shell 可注入（用 /bin/sh 时不得仍写死 bash）', () => {
    expect(
      buildSandboxExecArgv({
        profile: 'p',
        command: 'x',
        shell: '/bin/sh',
      })[3]
    ).toBe('/bin/sh');
  });
});
