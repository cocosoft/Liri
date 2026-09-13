// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * LandlockPolicyBuilder 单测（P1，2026-08-25）
 * 纯函数，任意平台可跑。
 */
import { describe, expect, test } from 'bun:test';
import { SandboxConfigBuilder } from '../../SandboxConfigBuilder';
import {
  clampAccessByAbi,
  LandlockPolicyBuilder,
  MAX_SUPPORTED_ABI,
  NET_TCP_ABI,
} from '../LandlockPolicyBuilder';
import { DEFAULT_LANDLOCK_CONFIG, resolveLandlockConfig } from '../config';
import { buildLandlockArgv } from '../runWithLandlock';
import type { LandlockFsAccess } from '../types';

describe('LandlockPolicyBuilder', () => {
  test('terminalTool → fs 映射：cwd 读写执行 + 系统路径只读', () => {
    const perms = SandboxConfigBuilder.terminalTool('/workspace');
    const policy = LandlockPolicyBuilder.build(perms, {
      cwd: '/workspace',
      abi: MAX_SUPPORTED_ABI,
    });

    expect(policy.cwd).toBe('/workspace');
    expect(policy.abi).toBe(MAX_SUPPORTED_ABI);

    const cwdRule = policy.fs.find((r) => r.path === '/workspace');
    expect(cwdRule).toBeDefined();
    expect(cwdRule?.allow).toContain('read');
    expect(cwdRule?.allow).toContain('write');
    expect(cwdRule?.allow).toContain('execute');
    // write 拆分为 make_dir/make_reg/remove（§4.2(2)）
    expect(cwdRule?.allow).toContain('make_dir');
    expect(cwdRule?.allow).toContain('make_reg');
    expect(cwdRule?.allow).toContain('remove');

    const usrRule = policy.fs.find((r) => r.path === '/usr');
    expect(usrRule?.allow).toEqual(['read']);
  });

  test('network 工具在 ABI≥4 时生成 connect_tcp 网络规则', () => {
    const perms = SandboxConfigBuilder.networkTool();
    const policy = LandlockPolicyBuilder.build(perms, {
      abi: MAX_SUPPORTED_ABI,
    });
    expect(policy.net).toEqual({ allow: ['connect_tcp'], denyBind: true });
  });

  test('ABI<4 时不生成网络规则（best-effort 裁剪）', () => {
    const perms = SandboxConfigBuilder.networkTool();
    const policy = LandlockPolicyBuilder.build(perms, { abi: 1 });
    expect(policy.net).toBeUndefined();
  });

  test('defaultTool → 空 fs、无网络', () => {
    const policy = LandlockPolicyBuilder.build(
      SandboxConfigBuilder.defaultTool(),
      {
        cwd: '/tmp',
      }
    );
    expect(policy.fs).toEqual([]);
    expect(policy.net).toBeUndefined();
  });

  test('clampAccessByAbi：refer 在 ABI<2 时被裁剪', () => {
    const all: LandlockFsAccess[] = [
      'read',
      'write',
      'execute',
      'make_dir',
      'make_reg',
      'remove',
      'refer',
    ];
    expect(clampAccessByAbi(all, 1)).not.toContain('refer');
    expect(clampAccessByAbi(all, 2)).toContain('refer');
    // ABI ≥ MAX_SUPPORTED_ABI 时原样返回
    expect(clampAccessByAbi(all, MAX_SUPPORTED_ABI)).toEqual(all);
  });
});

describe('LandlockConfig（P2）', () => {
  test('默认配置 = 兼容优先（enabled=true, failClosed=false）', () => {
    expect(DEFAULT_LANDLOCK_CONFIG).toEqual({
      enabled: true,
      failClosed: false,
    });
  });

  test('resolveLandlockConfig：空输入应用默认值', () => {
    expect(resolveLandlockConfig(undefined)).toEqual(DEFAULT_LANDLOCK_CONFIG);
    expect(resolveLandlockConfig({})).toEqual(DEFAULT_LANDLOCK_CONFIG);
  });

  test('resolveLandlockConfig：部分覆盖保留默认', () => {
    expect(resolveLandlockConfig({ enabled: false })).toEqual({
      enabled: false,
      failClosed: false,
    });
    expect(resolveLandlockConfig({ failClosed: true })).toEqual({
      enabled: true,
      failClosed: true,
    });
  });
});

describe('buildLandlockArgv（CLI 映射）', () => {
  test('写规则 → --rw，只读规则 → --ro', () => {
    const policy = LandlockPolicyBuilder.build(
      SandboxConfigBuilder.terminalTool('/workspace'),
      { cwd: '/workspace', abi: MAX_SUPPORTED_ABI }
    );
    const argv = buildLandlockArgv(policy);
    expect(argv).toContain('--rw');
    expect(argv).toContain('/workspace');
    expect(argv).toContain('--ro');
    expect(argv).toContain('/usr');
  });

  test('网络规则 → --net-connect tcp', () => {
    const policy = LandlockPolicyBuilder.build(
      SandboxConfigBuilder.networkTool(),
      { abi: MAX_SUPPORTED_ABI }
    );
    expect(buildLandlockArgv(policy)).toEqual(['--net-connect', 'tcp']);
  });

  test('无网络规则 → 不生成 --net-connect', () => {
    const policy = LandlockPolicyBuilder.build(
      SandboxConfigBuilder.defaultTool(),
      { cwd: '/tmp' }
    );
    expect(buildLandlockArgv(policy)).toEqual([]);
  });
});
