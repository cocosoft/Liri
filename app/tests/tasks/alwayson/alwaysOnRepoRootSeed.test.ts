// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-2 残留（2026-11-04 真机复核）：AlwaysOn 预置根取**所属仓库根**，而非任务目标的叶子目录。
 *
 * 实证：15Z 窗口 `工具路径越界` 41 次，roots 只有 `[…\LiriProjects\proj_x, E:\…\app\src\ai\router]`，
 * 而模型要读 `E:\…\app\src\tasks\AlwaysOnQuota.ts` —— 只授权叶子目录，改兄弟目录必然越界。
 *
 * 判据边界：只向上找 `.git`（目录或 worktree 的 `.git` 文件）；找不到 ⇒ `null`（调用方退回原值）。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_ASCEND_DEPTH,
  findEnclosingRepoRoot,
} from '@openliri/infra/utils/toolContract/repoRoot';

const ALWAYSON_SRC = readFileSync(
  new URL('../../../src/entrypoints/alwaysOnEntry.ts', import.meta.url),
  'utf8'
);

const created: string[] = [];
function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe('findEnclosingRepoRoot：向上找 .git', () => {
  it('叶子目录在仓库内 ⇒ 返回仓库根（不是叶子）', () => {
    const repo = makeTmp('liri-repo-');
    mkdirSync(join(repo, '.git'));
    const leaf = join(repo, 'app', 'src', 'ai', 'router');
    mkdirSync(leaf, { recursive: true });

    expect(findEnclosingRepoRoot(leaf)).toBe(repo);
  });

  it('worktree 的 `.git` 是文件 ⇒ 同样算仓库根', () => {
    const repo = makeTmp('liri-wt-');
    writeFileSync(join(repo, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
    const leaf = join(repo, 'src');
    mkdirSync(leaf);

    expect(findEnclosingRepoRoot(leaf)).toBe(repo);
  });

  it('自己就是仓库根 ⇒ 返回自己', () => {
    const repo = makeTmp('liri-self-');
    mkdirSync(join(repo, '.git'));

    expect(findEnclosingRepoRoot(repo)).toBe(repo);
  });

  it('向上没有任何 .git ⇒ null（调用方退回 project.path）', () => {
    const plain = makeTmp('liri-plain-');
    mkdirSync(join(plain, 'a', 'b'), { recursive: true });

    expect(findEnclosingRepoRoot(join(plain, 'a', 'b'))).toBeNull();
  });

  it('目录不存在也不抛（仍按祖先找）', () => {
    const repo = makeTmp('liri-ghost-');
    mkdirSync(join(repo, '.git'));

    expect(findEnclosingRepoRoot(join(repo, 'nope', 'deep', 'x'))).toBe(repo);
  });

  it('空 / 空白入参 ⇒ null', () => {
    expect(findEnclosingRepoRoot(undefined)).toBeNull();
    expect(findEnclosingRepoRoot('   ')).toBeNull();
  });

  it(`超过 ${MAX_ASCEND_DEPTH} 层不再上溯（避免异常路径走到盘符根）`, () => {
    const repo = makeTmp('liri-deep-');
    mkdirSync(join(repo, '.git'));
    let deep = repo;
    for (let i = 0; i <= MAX_ASCEND_DEPTH; i++) deep = join(deep, `d${i}`);
    mkdirSync(deep, { recursive: true });

    expect(findEnclosingRepoRoot(deep)).toBeNull();
  });
});

describe('接线：AlwaysOn 预置根改用仓库根', () => {
  it('先算 targetRoot（找不到 .git 则退回 project.path）', () => {
    expect(ALWAYSON_SRC).toContain(
      'const targetRoot = findEnclosingRepoRoot(project.path) ?? project.path;'
    );
  });

  it('预置根与每轮回填都用 targetRoot（不再直接用 project.path）', () => {
    expect(ALWAYSON_SRC).toContain(
      'workspaceRoots: mergeWorkspaceRoots(targetRoot, []),'
    );
    expect(ALWAYSON_SRC).toContain(
      'setSessionWorkspace(sessionId, cwd, project.id, targetRoot),'
    );
    expect(ALWAYSON_SRC).not.toContain('mergeWorkspaceRoots(project.path, [])');
  });
});
