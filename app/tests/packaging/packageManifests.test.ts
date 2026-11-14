// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2 剩余：分发清单生成器（npm / Scoop / Homebrew）。
 *
 * 锁定语义：
 * - 渲染结果**确定**（同输入 ⇒ 同文本），字段与哈希来自入参（不猜）；
 * - `sha256OfFile` 与标准摘要一致（用已知向量 `abc` 校准）；
 * - 仓库内提交的三份清单 = 脚本以"占位哈希 + 当前版本"渲染的结果（**防手改漂移**）。
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_PATHS,
  renderHomebrewFormula,
  renderNpmPackageJson,
  renderScoopManifest,
  sha256OfFile,
  type ManifestInput,
} from '../../../scripts/gen-package-manifests';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const APP_PKG = JSON.parse(
  readFileSync(join(REPO_ROOT, 'app', 'package.json'), 'utf-8')
) as { version: string };

const INPUT: ManifestInput = {
  version: '9.9.9',
  artifactName: 'liri-cli-9.9.9.tgz',
  sha256: 'a'.repeat(64),
};

describe('gen-package-manifests：渲染', () => {
  it('sha256OfFile 与标准摘要一致（已知向量 abc）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-pkg-'));
    try {
      const file = join(dir, 'artifact.tgz');
      writeFileSync(file, 'abc');
      expect(sha256OfFile(file)).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Scoop 清单：版本 / 哈希 / 下载地址 / bun 前置 / bin 映射', () => {
    const parsed = JSON.parse(renderScoopManifest(INPUT)) as {
      version: string;
      depends: string[];
      architecture: Record<string, { url: string; hash: string }>;
      bin: string[][];
    };
    expect(parsed.version).toBe('9.9.9');
    expect(parsed.depends).toEqual(['bun']);
    expect(parsed.architecture['64bit'].hash).toBe('a'.repeat(64));
    expect(parsed.architecture['64bit'].url).toContain('/v9.9.9/');
    expect(parsed.bin).toEqual([['Liri.cmd', 'liri']]);
  });

  it('Homebrew formula：url / sha256 / version / 依赖 bun', () => {
    const rb = renderHomebrewFormula(INPUT);
    expect(rb).toContain('sha256 "' + 'a'.repeat(64) + '"');
    expect(rb).toContain('version "9.9.9"');
    expect(rb).toContain('depends_on "bun"');
    expect(rb).toContain('liri-cli-9.9.9.tgz');
  });

  it('npm 清单：bin 指向构建产物、files 白名单、engines.bun', () => {
    const pkg = JSON.parse(renderNpmPackageJson(INPUT)) as {
      version: string;
      bin: Record<string, string>;
      files: string[];
      engines: Record<string, string>;
    };
    expect(pkg.version).toBe('9.9.9');
    expect(pkg.bin['Liri']).toBe('dist/main.js');
    expect(pkg.files).toEqual(['dist/main.js']);
    expect(pkg.engines.bun).toBeTruthy();
  });

  it('渲染确定：同输入两次逐字相同', () => {
    expect(renderHomebrewFormula(INPUT)).toBe(renderHomebrewFormula(INPUT));
    expect(renderScoopManifest(INPUT)).toBe(renderScoopManifest(INPUT));
  });
});

describe('gen-package-manifests：仓库内清单与脚本一致', () => {
  it('三份清单 = 占位哈希 + 当前 app 版本 的渲染结果（防手改）', () => {
    const placeholder: ManifestInput = {
      version: APP_PKG.version,
      artifactName: `liri-cli-${APP_PKG.version}.tgz`,
      sha256: '0'.repeat(64),
    };
    const expected: Record<string, string> = {
      [MANIFEST_PATHS.scoop]: renderScoopManifest(placeholder),
      [MANIFEST_PATHS.homebrew]: renderHomebrewFormula(placeholder),
      [MANIFEST_PATHS.npm]: renderNpmPackageJson(placeholder),
    };
    for (const [rel, content] of Object.entries(expected)) {
      const actual = readFileSync(join(REPO_ROOT, rel), 'utf-8');
      expect(actual).toBe(content);
    }
  });
});
