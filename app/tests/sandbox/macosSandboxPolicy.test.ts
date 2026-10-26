// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// macOS 兜底沙箱：SBPL 策略生成 + seatbelt 能力探测（2026-10-26，方案 §5）
//
// 覆盖**纯函数**（三平台都跑）；真机行为由 `verify:sandbox-macos` 在 CI 的 macos-latest 上验证
// （2026-10-26 起已接入 `.github/workflows/ci.yml`）。
import { beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  MACOS_SANDBOX_EXEC_PATH,
  buildMacOSSandboxProfile,
  clearMacOSSandboxCapabilityCache,
  detectMacOSSandboxCapability,
  escapeSbplString,
  toKernelPath,
} from '../../src/sandbox/darwin';

describe('buildMacOSSandboxProfile', () => {
  it('默认拒绝 + 读/进程放行 + 写仅白名单', () => {
    // 用**必然不存在**的路径：`toKernelPath` 对不存在的路径原样保留，
    // 否则 `/tmp` 之类在宿主上真实存在，会被 realpath 改写成另一条路径导致断言不稳定。
    const profile = buildMacOSSandboxProfile({
      writablePaths: ['/liri-test/work', '/liri-test/tmp'],
    });

    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(allow file-read*)');
    expect(profile).toContain('(allow process*)');
    expect(profile).toContain('(subpath "/liri-test/work")');
    expect(profile).toContain('(subpath "/liri-test/tmp")');
    expect(profile).toContain('(allow network*)');
  });

  it('白名单去重、丢空串；写规则是闭合块', () => {
    const profile = buildMacOSSandboxProfile({
      writablePaths: ['/liri-test/a', '/liri-test/a', '   ', '/liri-test/b'],
    });

    expect(profile.match(/\(subpath "\/liri-test\/a"\)/g)?.length).toBe(1);
    expect(profile).toContain('(subpath "/liri-test/b")');
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

describe('toKernelPath（SBPL 按内核解析后的路径匹配）', () => {
  it('不存在的路径原样保留（profile 可先于目录创建）', () => {
    const missing = join(tmpdir(), 'liri-kp-not-exist-9f8e7d', 'x');
    expect(toKernelPath(missing)).toBe(missing);
  });

  it('存在的目录 ⇒ 返回绝对路径且可解析（符号链接被展开）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-kp-'));
    const resolved = toKernelPath(dir);
    expect(isAbsolute(resolved)).toBe(true);
    expect(existsSync(resolved)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('白名单里的真实目录先归一再进 profile（macOS `/var` → `/private/var`）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-kp-'));
    const profile = buildMacOSSandboxProfile({ writablePaths: [dir] });
    expect(profile).toContain(
      `(subpath "${escapeSbplString(toKernelPath(dir))}")`
    );
    rmSync(dir, { recursive: true, force: true });
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
