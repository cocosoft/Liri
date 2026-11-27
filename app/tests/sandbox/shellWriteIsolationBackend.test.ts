/**
 * 命令写隔离的**后端判据**（2026-11-27，A 组）
 *
 * 为什么单独测：`GET /v1/sandbox/status` 的 `posture.shellWriteIsolation` 与
 * `SandboxExecutionSignal` 都吃这一份判据 —— 它必须**与执行门控同源**（不能按工具名猜），
 * 且 macOS/Windows 不能因为 `mode` 恒 `none` 就看起来"没隔离"。
 *
 * 注意：本模块只提供**观测/展示**事实；`mode`（沙箱豁免 S1 的判据）刻意保持不变。
 */
import { describe, expect, it } from 'bun:test';

import {
  isShellWriteIsolationEffective,
  resolveShellWriteIsolationBackend,
  shellWriteIsolationBackendForPlatform,
} from '@modules/sandbox';

describe('resolveShellWriteIsolationBackend：总开关与平台', () => {
  it('总开关关闭 ⇒ none / 未生效（即便平台能力可用）', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: false,
        platform: 'linux',
        landlockAvailable: true,
      })
    ).toMatchObject({ backend: 'none', effective: false });
  });

  it('Linux：Landlock 已证实可用 ⇒ landlock；未证实 ⇒ none', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: true,
      })
    ).toMatchObject({ backend: 'landlock', effective: true });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: false,
      })
    ).toMatchObject({ backend: 'none', effective: false });
  });

  it('macOS：Seatbelt 可用 ⇒ sandbox-exec；缺失 ⇒ none', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'darwin',
        macAvailable: true,
      })
    ).toMatchObject({ backend: 'sandbox-exec', effective: true });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'darwin',
        macAvailable: false,
      })
    ).toMatchObject({ backend: 'none', effective: false });
  });

  it('Windows：helper 可用 ⇒ windows-low-il；缺失 ⇒ none', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'win32',
        winAvailable: true,
      })
    ).toMatchObject({ backend: 'windows-low-il', effective: true });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'win32',
        winAvailable: false,
      })
    ).toMatchObject({ backend: 'none', effective: false });
  });

  it('不支持的平台 ⇒ none（不猜）', () => {
    expect(
      resolveShellWriteIsolationBackend({ enabled: true, platform: 'aix' })
    ).toMatchObject({ backend: 'none', effective: false });
  });

  it('布尔判据与后端名同源（none ⇔ 未生效）', () => {
    expect(
      isShellWriteIsolationEffective({
        enabled: true,
        platform: 'win32',
        winAvailable: true,
      })
    ).toBe(true);
    expect(
      isShellWriteIsolationEffective({
        enabled: true,
        platform: 'win32',
        winAvailable: false,
      })
    ).toBe(false);
  });
});

describe('能力探测细节（capability）：回答"为什么没隔离"', () => {
  it('Linux：可用 ⇒ 无 reasonCode；未证实 ⇒ reasonCode=not-probed', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: true,
      }).capability
    ).toEqual({ platform: 'linux', available: true });

    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: false,
      }).capability
    ).toMatchObject({ platform: 'linux', available: false });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: false,
      }).capability.reasonCode
    ).toBeTruthy();
  });

  it('macOS：缺失 ⇒ reasonCode=sandbox-exec-missing（探测器的硬事实）', () => {
    const capability = resolveShellWriteIsolationBackend({
      enabled: true,
      platform: 'darwin',
      macAvailable: false,
    }).capability;
    expect(capability.available).toBe(false);
    expect(capability.reasonCode).toBe('sandbox-exec-missing');
  });

  it('Windows：带出 `runnable`（--probe 实测）与 reasonCode', () => {
    const capability = resolveShellWriteIsolationBackend({
      enabled: true,
      platform: 'win32',
      winAvailable: false,
      winRunnable: false,
    }).capability;
    expect(capability).toMatchObject({
      platform: 'win32',
      available: false,
      runnable: false,
    });
    expect(capability.reasonCode).toBeTruthy();
  });

  it('能力细节**不看总开关**（开关关了，能力仍如实报）', () => {
    const state = resolveShellWriteIsolationBackend({
      enabled: false,
      platform: 'linux',
      landlockAvailable: true,
    });
    expect(state.backend).toBe('none');
    expect(state.effective).toBe(false);
    expect(state.capability).toMatchObject({
      platform: 'linux',
      available: true,
    });
  });

  it('不支持的平台 ⇒ reasonCode=platform-unsupported', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'aix',
      }).capability
    ).toMatchObject({
      platform: 'aix',
      available: false,
      reasonCode: 'platform-unsupported',
    });
  });
});

describe('shellWriteIsolationBackendForPlatform：展示用映射', () => {
  it('三平台各归其后端，其余 none', () => {
    expect(shellWriteIsolationBackendForPlatform('linux')).toBe('landlock');
    expect(shellWriteIsolationBackendForPlatform('darwin')).toBe(
      'sandbox-exec'
    );
    expect(shellWriteIsolationBackendForPlatform('win32')).toBe(
      'windows-low-il'
    );
    expect(shellWriteIsolationBackendForPlatform('freebsd')).toBe('none');
  });
});
