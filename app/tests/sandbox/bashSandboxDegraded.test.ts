// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2（2026-11-07）：bash 在 Windows 上"不隔离"必须**可查**。
 *
 * 背景：`win-sandbox-run.exe` 只做 Low IL + Job Object，Low IL 默认写不了用户仓库
 * ⇒ 让 bash 真隔离必须给仓库改 ACL（v1 明确不做，用户 2026-11-07 拍板「保持不沙箱 +
 * 补齐可观测」）。本用例锁：Windows 恰告警一次、非 Windows 不告警、告警出口异常不反噬。
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  judgeBashSandboxDegraded,
  reportBashSandboxDegradedOnce,
  resetBashSandboxDegradedReported,
} from '../../src/tools/bash/bashSandboxDegraded';

beforeEach(() => {
  resetBashSandboxDegradedReported();
});

describe('P2：bash 未隔离的可观测信号', () => {
  it('Windows ⇒ 提示（reason=windows-unsupported）', () => {
    expect(
      judgeBashSandboxDegraded({ platform: 'win32', alreadyReported: false })
    ).toEqual({ report: true, reason: 'windows-unsupported' });
  });

  it('非 Windows ⇒ 不提示（Linux/macOS 有各自沙箱路径）', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      expect(
        judgeBashSandboxDegraded({ platform, alreadyReported: false })
      ).toEqual({ report: false, reason: 'not-windows' });
    }
  });

  it('已提示过 ⇒ 不再提示', () => {
    expect(
      judgeBashSandboxDegraded({ platform: 'win32', alreadyReported: true })
    ).toEqual({ report: false, reason: 'already-reported' });
  });

  it('全进程只告警一次，且带可归因字段（reason / why / ref）', () => {
    const calls: Array<{ message: string; meta?: Record<string, unknown> }> =
      [];
    const warn = (message: string, meta?: Record<string, unknown>) => {
      calls.push({ message, meta });
    };

    const first = reportBashSandboxDegradedOnce({ platform: 'win32', warn });
    const second = reportBashSandboxDegradedOnce({ platform: 'win32', warn });

    expect(first.report).toBe(true);
    expect(second).toEqual({ report: false, reason: 'already-reported' });
    expect(calls).toHaveLength(1);
    expect(calls[0].message).toContain('sandbox_degraded');
    expect(calls[0].meta?.reason).toBe('platform-unsupported');
    expect(calls[0].meta?.mode).toBe('plain');
    expect(calls[0].meta?.writablePolicy).toBe('unrestricted');
    expect(String(calls[0].meta?.ref)).toContain('windows-sandbox.md');
  });

  it('非 Windows 零 IO、零告警', () => {
    const calls: unknown[] = [];
    const verdict = reportBashSandboxDegradedOnce({
      platform: 'linux',
      warn: (message, meta) => calls.push({ message, meta }),
    });
    expect(verdict).toEqual({ report: false, reason: 'not-windows' });
    expect(calls).toEqual([]);
  });

  it('告警出口抛错 ⇒ 不反噬执行路径', () => {
    expect(() =>
      reportBashSandboxDegradedOnce({
        platform: 'win32',
        warn: () => {
          throw new Error('logger 通道异常（模拟）');
        },
      })
    ).not.toThrow();
  });
});
