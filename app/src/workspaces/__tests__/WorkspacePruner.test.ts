/**
 * G5：worktree 残留回收测试
 *
 * 覆盖：
 * - 孤儿 worktree（git 注册丢失）被清理
 * - 正常注册的 worktree 不被误删
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pruneOrphanWorktrees } from '../WorkspacePruner';

let tmpRoot: string;
let gitRoot: string;
let worktreesDir: string;

function git(cwd: string, ...args: string[]) {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd,
  }).trim();
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wt-prune-'));
  gitRoot = join(tmpRoot, 'repo');
  worktreesDir = join(tmpRoot, 'worktrees');
  execSync(`git init "${gitRoot}"`, { stdio: 'pipe' });
  writeFileSync(join(gitRoot, 'a.txt'), 'base\n');
  git(gitRoot, 'add', 'a.txt');
  git(
    gitRoot,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-m',
    'init'
  );
  mkdirSync(worktreesDir, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('pruneOrphanWorktrees（G5）', () => {
  test('git 注册丢失的孤儿 worktree 被清理', async () => {
    const orphan = join(worktreesDir, 'orphan-1');
    execSync(`git worktree add --detach "${orphan}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
    });
    expect(existsSync(orphan)).toBe(true);

    // 制造孤儿：删除 worktree 的 .git 引用 → git worktree prune 后注册丢失，目录残留
    rmSync(join(orphan, '.git'), { recursive: true, force: true });

    const pruned = await pruneOrphanWorktrees(gitRoot);
    expect(pruned).toContain(orphan);
    expect(existsSync(orphan)).toBe(false);
  });

  test('正常注册的 worktree 不被误删', async () => {
    const active = join(worktreesDir, 'active-1');
    execSync(`git worktree add --detach "${active}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
    });

    const pruned = await pruneOrphanWorktrees(gitRoot);
    expect(pruned).not.toContain(active);
    expect(existsSync(active)).toBe(true);

    // 清理
    execSync(`git worktree remove --force "${active}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
    });
  });

  test('无 worktrees 目录时静默返回空', async () => {
    const emptyRepo = join(tmpRoot, 'empty');
    execSync(`git init "${emptyRepo}"`, { stdio: 'pipe' });
    const pruned = await pruneOrphanWorktrees(emptyRepo);
    expect(pruned).toEqual([]);
  });
});
