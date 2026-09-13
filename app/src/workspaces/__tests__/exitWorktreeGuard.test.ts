/**
 * G4：exitWorktree 数据丢失防护测试
 *
 * 验证：worktree 存在未提交/未跟踪改动时，exitWorktree 拒绝移除（防止 --force 静默丢弃）。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { enterWorktree, exitWorktree } from '../commands/session';

let tmpRoot: string;
let gitRoot: string;
let worktreePath: string;
let originalCwd: string;

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd,
  });
}

beforeAll(() => {
  originalCwd = process.cwd();
  tmpRoot = mkdtempSync(join(tmpdir(), 'wt-guard-'));
  gitRoot = join(tmpRoot, 'repo');
  execSync(`git init "${gitRoot}"`, { stdio: 'pipe' });
  // 首次提交（worktree add 需要 HEAD）
  writeFileSync(join(gitRoot, 'base.txt'), 'base\n');
  git(gitRoot, 'add', 'base.txt');
  git(
    gitRoot,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'init'
  );
});

afterAll(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch — 清理失败不影响测试结论
  }
});

describe('exitWorktree 数据丢失防护（G4）', () => {
  test('存在未提交改动时拒绝移除，且 worktree 目录保留', async () => {
    // 进入 worktree
    process.chdir(gitRoot);
    const enter = await enterWorktree('guard-test', undefined, gitRoot);
    expect(enter.success).toBe(true);
    worktreePath = (enter.data as { worktree_path: string }).worktree_path;
    expect(existsSync(worktreePath)).toBe(true);

    // 在 worktree 内创建未提交文件
    writeFileSync(join(worktreePath, 'uncommitted.txt'), 'draft\n');

    // 尝试退出（remove=false 原本会走 --force 静默丢弃）
    process.chdir(worktreePath);
    const exit = await exitWorktree('guard-test', false, worktreePath);

    expect(exit.success).toBe(false);
    expect(exit.error).toContain('未提交改动');
    expect(exit.message).toContain('uncommitted.txt');
    // 数据必须保留：worktree 未被移除
    expect(existsSync(worktreePath)).toBe(true);
    expect(existsSync(join(worktreePath, 'uncommitted.txt'))).toBe(true);
  });

  test('remove=true 同样被防护（有改动拒绝）', async () => {
    const exit = await exitWorktree('guard-test', true, worktreePath);
    expect(exit.success).toBe(false);
    expect(exit.error).toContain('未提交改动');
    expect(existsSync(join(worktreePath, 'uncommitted.txt'))).toBe(true);
  });

  test('清理改动后可正常退出', async () => {
    // 删除未提交文件后应能正常退出
    rmSync(join(worktreePath, 'uncommitted.txt'), { force: true });
    process.chdir(worktreePath);
    const exit = await exitWorktree('guard-test', true, worktreePath);
    expect(exit.success).toBe(true);
    expect(existsSync(worktreePath)).toBe(false);
  });
});
