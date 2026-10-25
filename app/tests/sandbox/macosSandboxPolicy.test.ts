// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// macOS 兜底沙箱：SBPL 策略生成 + seatbelt 能力探测（2026-10-26，方案 §5）
//
// 只覆盖**纯函数**（CI 无 macOS 矩阵；真机验证是独立项，见方案 §5 末行）。
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  MACOS_SANDBOX_EXEC_PATH,
  buildMacOSSandboxProfile,
  clearMacOSSandboxCapabilityCache,
  detectMacOSSandboxCapability,
  escapeSbplString,
} from '../../src/sandbox/darwin';

describe('buildMacOSSandboxProfile', () => {
  it('默认拒绝 + 读/进程放行 + 写仅白名单', () => {
    const profile = buildMacOSSandboxProfile({
      writablePaths: ['/work', '/tmp'],
    });

    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(allow file-read*)');
    expect(profile).toContain('(allow process*)');
    expect(profile).toContain('(subpath "/work")');
    expect(profile).toContain('(subpath "/tmp")');
    expect(profile).toContain('(allow network*)');
  });

  it('白名单去重、丢空串；写规则是闭合块', () => {
    const profile = buildMacOSSandboxProfile({
      writablePaths: ['/a', '/a', '   ', '/b'],
    });

    expect(profile.match(/\(subpath "\/a"\)/g)?.length).toBe(1);
    expect(profile).toContain('(subpath "/b")');
    // `(allow file-write* ... )` 必须成对闭合，否则 sandbox-exec 直接报 profile 语法错
    expect(profile).toContain('(allow file-write*');
    expect(profile.trimEnd().endsWith(')')).toBe(true);
  });

  it('allowNetwork=false ⇒ 不出现网络放行', () => {
    const profile = buildMacOSSandboxProfile({
      writablePaths: ['/a'],
      allowNetwork: false,
    });
    expect(profile).not.toContain('(allow network*)');
  });

  it('无白名单 ⇒ 不生成空的写规则块', () => {
    const profile = buildMacOSSandboxProfile({ writablePaths: [] });
    expect(profile).not.toContain('(allow file-write*');
  });

  it('路径含引号/反斜杠 ⇒ 转义（不截断规则）', () => {
    expect(escapeSbplString('/a"b\\c')).toBe('/a\\"b\\\\c');
    expect(buildMacOSSandboxProfile({ writablePaths: ['/a"b'] })).toContain(
      '(subpath "/a\\"b")'
    );
  });
});

describe('detectMacOSSandboxCapability', () => {
  beforeEach(() => clearMacOSSandboxCapabilityCache());

  it('非 darwin ⇒ 不可用并给原因', () => {
    const cap = detectMacOSSandboxCapability({ platform: 'linux' });
    expect(cap.available).toBe(false);
    expect(cap.reason).toContain('非 macOS');
  });

  it('darwin + 工具存在 ⇒ 可用且给出绝对路径', () => {
    const cap = detectMacOSSandboxCapability({
      platform: 'darwin',
      pathExists: (path) => path === MACOS_SANDBOX_EXEC_PATH,
    });
    expect(cap).toEqual({ available: true, path: MACOS_SANDBOX_EXEC_PATH });
  });

  it('darwin + 工具缺失 ⇒ 不可用，且命中缓存（第二次不再查 fs）', () => {
    let calls = 0;
    const first = detectMacOSSandboxCapability({
      platform: 'darwin',
      pathExists: () => {
        calls += 1;
        return false;
      },
    });
    expect(first.available).toBe(false);
    expect(first.reason).toContain(MACOS_SANDBOX_EXEC_PATH);

    const second = detectMacOSSandboxCapability({
      platform: 'darwin',
      pathExists: () => {
        calls += 1;
        return true;
      },
    });
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });
});
