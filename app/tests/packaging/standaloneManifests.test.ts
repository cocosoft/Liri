// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2 剩余四期：**standalone 清单**（单文件二进制 ⇒ 去掉 bun 前置）的纯函数。
 *
 * 锁定的语义：
 * - 只认 `liri-<platform>-<arch>[.exe]` 命名；缺任一必需平台 ⇒ `missing` 如实报出；
 * - 渲染结果**不含** bun 前置（`depends` / `depends_on "bun"`）；
 * - 合并 `SHA256SUMS` 按文件名升序、确定性。
 *
 * 真实产物由 CI 矩阵构建；本机只有 win32-x64，故用例用构造的资产表。
 */

import { describe, expect, it } from 'bun:test';
import {
  parseStandaloneName,
  renderHomebrewStandaloneFormula,
  renderScoopStandaloneManifest,
  renderStandaloneManifests,
  resolveStandaloneAssets,
  type StandaloneAsset,
} from '../../../scripts/gen-package-manifests';

const ASSETS: StandaloneAsset[] = [
  {
    name: 'liri-win32-x64.exe',
    platform: 'win32',
    arch: 'x64',
    sha256: 'a'.repeat(64),
  },
  {
    name: 'liri-darwin-arm64',
    platform: 'darwin',
    arch: 'arm64',
    sha256: 'b'.repeat(64),
  },
  {
    name: 'liri-darwin-x64',
    platform: 'darwin',
    arch: 'x64',
    sha256: 'c'.repeat(64),
  },
  {
    name: 'liri-linux-x64',
    platform: 'linux',
    arch: 'x64',
    sha256: 'd'.repeat(64),
  },
];

describe('standalone 清单', () => {
  it('产物名解析：带/不带 .exe 均可，其他命名给 null（不猜）', () => {
    expect(parseStandaloneName('liri-win32-x64.exe')).toEqual({
      platform: 'win32',
      arch: 'x64',
    });
    expect(parseStandaloneName('liri-darwin-arm64')).toEqual({
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(parseStandaloneName('SHA256SUMS')).toBeNull();
    expect(parseStandaloneName('liri-win32-ia32.exe')).toBeNull();
  });

  it('资产齐全 ⇒ missing 为空，且按 platform → arch 升序', () => {
    const { assets, missing } = resolveStandaloneAssets(
      [...ASSETS].reverse().map((a) => ({ name: a.name, sha256: a.sha256 }))
    );
    expect(missing).toEqual([]);
    expect(assets.map((a) => a.name)).toEqual([
      'liri-darwin-arm64',
      'liri-darwin-x64',
      'liri-linux-x64',
      'liri-win32-x64.exe',
    ]);
  });

  it('缺平台 ⇒ 只报缺的那个（不静默补占位）', () => {
    const { assets, missing } = resolveStandaloneAssets(
      ASSETS.filter((a) => a.name !== 'liri-darwin-x64').map((a) => ({
        name: a.name,
        sha256: a.sha256,
      }))
    );
    expect(missing).toEqual(['liri-darwin-x64']);
    expect(assets).toHaveLength(3);
  });

  it('Scoop（standalone）：无 bun 前置，url/hash 指向单文件产物', () => {
    const manifest = JSON.parse(
      renderScoopStandaloneManifest({ version: '0.5.28', assets: ASSETS })
    ) as Record<string, unknown>;
    expect(manifest['depends']).toBeUndefined();
    expect(manifest['architecture']).toEqual({
      '64bit': {
        url: 'https://github.com/openliri/Liri/releases/download/v0.5.28/liri-win32-x64.exe',
        hash: 'a'.repeat(64),
      },
    });
    expect(manifest['bin']).toEqual([['liri-win32-x64.exe', 'liri']]);
  });

  it('Homebrew（standalone）：无 bun 依赖，按平台分支给 url 与 sha256', () => {
    const formula = renderHomebrewStandaloneFormula({
      version: '0.5.28',
      assets: ASSETS,
    });
    expect(formula).not.toContain('depends_on "bun"');
    expect(formula).toContain('on_macos do');
    expect(formula).toContain('on_linux do');
    expect(formula).toContain('/v0.5.28/liri-darwin-arm64');
    expect(formula).toContain('/v0.5.28/liri-darwin-x64');
    expect(formula).toContain('/v0.5.28/liri-linux-x64');
    expect(formula).toContain(`sha256 "${'b'.repeat(64)}"`);
  });

  it('合并 SHA256SUMS：三平台四产物、按名升序、确定性', () => {
    const rendered = renderStandaloneManifests({
      version: '0.5.28',
      assets: ASSETS,
    });
    const sums = rendered['packaging/standalone/SHA256SUMS'];
    expect(sums).toBe(
      [
        `${'b'.repeat(64)}  liri-darwin-arm64`,
        `${'c'.repeat(64)}  liri-darwin-x64`,
        `${'d'.repeat(64)}  liri-linux-x64`,
        `${'a'.repeat(64)}  liri-win32-x64.exe`,
        '',
      ].join('\n')
    );
    expect(
      renderStandaloneManifests({ version: '0.5.28', assets: ASSETS })
    ).toEqual(rendered);
  });

  it('资产缺失时渲染 fail-fast（不产出半份清单）', () => {
    expect(() =>
      renderHomebrewStandaloneFormula({
        version: '0.5.28',
        assets: ASSETS.filter((a) => a.name !== 'liri-linux-x64'),
      })
    ).toThrow('standalone 资产缺失：liri-linux-x64');
  });
});
