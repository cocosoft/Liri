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
    ).toEqual({ backend: 'none', effective: false });
  });

  it('Linux：Landlock 已证实可用 ⇒ landlock；未证实 ⇒ none', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: true,
      })
    ).toEqual({ backend: 'landlock', effective: true });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'linux',
        landlockAvailable: false,
      })
    ).toEqual({ backend: 'none', effective: false });
  });

  it('macOS：Seatbelt 可用 ⇒ sandbox-exec；缺失 ⇒ none', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'darwin',
        macAvailable: true,
      })
    ).toEqual({ backend: 'sandbox-exec', effective: true });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'darwin',
        macAvailable: false,
      })
    ).toEqual({ backend: 'none', effective: false });
  });

  it('Windows：helper 可用 ⇒ windows-low-il；缺失 ⇒ none', () => {
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'win32',
        winAvailable: true,
      })
    ).toEqual({ backend: 'windows-low-il', effective: true });
    expect(
      resolveShellWriteIsolationBackend({
        enabled: true,
        platform: 'win32',
        winAvailable: false,
      })
    ).toEqual({ backend: 'none', effective: false });
  });

  it('不支持的平台 ⇒ none（不猜）', () => {
    expect(
      resolveShellWriteIsolationBackend({ enabled: true, platform: 'aix' })
    ).toEqual({ backend: 'none', effective: false });
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
