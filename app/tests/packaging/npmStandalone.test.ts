// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2 剩余五期：**npm standalone 变体**（按平台分包，去 bun 前置）的纯函数。
 *
 * 锁定的语义：
 * - 平台表唯一事实源 = `REQUIRED_STANDALONE_TARGETS`（启动器与平台包同源，不会漂移）；
 * - 主包零运行时依赖，靠 `optionalDependencies` 串联平台包；
 * - 平台包用 `os` / `cpu` 限定，npm 只会装匹配平台那一份；
 * - 启动器不支持当前平台或缺平台包时**如实报错退出 1**（不静默）。
 *
 * 真实二进制由 CI 矩阵产出；本机只验渲染。
 */

import { describe, expect, it } from 'bun:test';
import {
  NPM_STANDALONE_ROOT,
  npmPlatformTargets,
  renderNpmPlatformPackageJson,
  renderNpmStandaloneLauncher,
  renderNpmStandaloneRootPackageJson,
  renderNpmStandaloneTree,
} from '../../../scripts/gen-package-manifests';

const VERSION = '0.5.28';

describe('npm standalone 变体', () => {
  it('平台包清单：四个目标、名称/二进制名正确、排序确定', () => {
    const targets = npmPlatformTargets();
    expect(targets.map((t) => t.packageName)).toEqual([
      '@openliri/cli-darwin-arm64',
      '@openliri/cli-darwin-x64',
      '@openliri/cli-linux-x64',
      '@openliri/cli-win32-x64',
    ]);
    expect(targets.find((t) => t.platform === 'win32')?.binaryName).toBe(
      'liri.exe'
    );
    expect(targets.find((t) => t.platform === 'linux')?.binaryName).toBe(
      'liri'
    );
  });

  it('平台包 package.json：os / cpu 限定 + 只打包二进制', () => {
    const target = npmPlatformTargets().find(
      (t) => t.packageName === '@openliri/cli-darwin-arm64'
    );
    if (!target) throw new Error('未找到 darwin-arm64 平台目标');
    const pkg = JSON.parse(
      renderNpmPlatformPackageJson(VERSION, target)
    ) as Record<string, unknown>;
    expect(pkg['os']).toEqual(['darwin']);
    expect(pkg['cpu']).toEqual(['arm64']);
    expect(pkg['files']).toEqual(['liri']);
    expect(pkg['version']).toBe(VERSION);
  });

  it('主包 package.json：零 dependencies + optionalDependencies 串四个平台包', () => {
    const pkg = JSON.parse(
      renderNpmStandaloneRootPackageJson(VERSION)
    ) as Record<string, unknown>;
    expect(pkg['dependencies']).toBeUndefined();
    expect(pkg['bin']).toEqual({ Liri: 'bin/liri.js' });
    expect(pkg['files']).toEqual(['bin/liri.js']);
    expect(pkg['optionalDependencies']).toEqual({
      '@openliri/cli-darwin-arm64': VERSION,
      '@openliri/cli-darwin-x64': VERSION,
      '@openliri/cli-linux-x64': VERSION,
      '@openliri/cli-win32-x64': VERSION,
    });
    expect(pkg['engines']).toEqual({ node: '>=18' });
  });

  it('启动器：平台表与构建矩阵同源，且不含 bun 依赖', () => {
    const launcher = renderNpmStandaloneLauncher();
    expect(launcher.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(launcher).toContain(
      '"win32-x64": { pkg: "@openliri/cli-win32-x64", bin: "liri.exe" }'
    );
    expect(launcher).toContain(
      '"darwin-arm64": { pkg: "@openliri/cli-darwin-arm64", bin: "liri" }'
    );
    expect(launcher).toContain(
      '"linux-x64": { pkg: "@openliri/cli-linux-x64", bin: "liri" }'
    );
    expect(launcher).toContain('process.platform + "-" + process.arch');
    expect(launcher).toContain('不支持当前平台');
    expect(launcher).toContain('缺少平台包');
    expect(launcher).toContain('stdio: "inherit"');
    expect(launcher).not.toContain('bun');
  });

  it('包树：主包 + 启动器 + 四个平台包（路径确定）', () => {
    const tree = renderNpmStandaloneTree(VERSION);
    expect(Object.keys(tree).sort()).toEqual(
      [
        `${NPM_STANDALONE_ROOT}/package.json`,
        `${NPM_STANDALONE_ROOT}/bin/liri.js`,
        `${NPM_STANDALONE_ROOT}/packages/@openliri/cli-darwin-arm64/package.json`,
        `${NPM_STANDALONE_ROOT}/packages/@openliri/cli-darwin-x64/package.json`,
        `${NPM_STANDALONE_ROOT}/packages/@openliri/cli-linux-x64/package.json`,
        `${NPM_STANDALONE_ROOT}/packages/@openliri/cli-win32-x64/package.json`,
      ].sort()
    );
  });

  it('确定性：同版本两次渲染逐字相同', () => {
    expect(renderNpmStandaloneTree(VERSION)).toEqual(
      renderNpmStandaloneTree(VERSION)
    );
  });
});
