// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G1（2026-11-12）：源码扫描根**单一事实源**回归锁。
 *
 * 背景：门禁此前各自维护根列表，包迁出后屡次"忘记补扫"（实证 `lint-state-literal-ratchet.ts`
 * 注释「P29–P32 迁入的 203 个文件此前不在扫描面内」）。本测试锁三件事：
 *  1. `packages/*\/src` **自动发现**（新增包无需改门禁）；
 *  2. 没有 `src` 的包自动跳过、目录不存在不抛错；
 *  3. 顺序稳定（`app` 在前，`packages` 按名升序）—— 供"扫描文件数"前后对比。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveSourceRootPaths,
  resolveSourceRoots,
} from '../../../scripts/lib/sourceRoots';

const created: string[] = [];

function fakeProject(layout: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-src-roots-'));
  created.push(root);
  for (const dir of layout) mkdirSync(join(root, dir), { recursive: true });
  return root;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('G1：源码扫描根单一事实源', () => {
  it('自动发现 app/src + packages/*/src，顺序为 app 在前、包名升序', () => {
    const root = fakeProject([
      'app/src',
      'packages/service/src',
      'packages/infra/src',
      'packages/kernel/src',
    ]);

    const roots = resolveSourceRoots(root);

    expect(roots.map((r) => r.name)).toEqual([
      'app',
      'infra',
      'kernel',
      'service',
    ]);
    expect(roots[0].path).toBe(join(root, 'app', 'src'));
  });

  it('没有 src 的包自动跳过；缺目录不抛错', () => {
    const root = fakeProject([
      'app/src',
      'packages/types-only/lib',
      'packages/empty',
    ]);
    const paths = resolveSourceRootPaths(root);
    expect(paths).toEqual([join(root, 'app', 'src')]);

    const bare = fakeProject([]);
    expect(resolveSourceRootPaths(bare)).toEqual([]);
  });

  it('真实仓库：四个根齐全（app / infra / kernel / service）', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const names = resolveSourceRoots(repoRoot).map((r) => r.name);
    for (const expected of ['app', 'infra', 'kernel', 'service']) {
      expect(names).toContain(expected);
    }
  });
});
