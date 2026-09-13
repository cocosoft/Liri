/**
 * G1：apply-back（worktree 改动回灌主项目）集成测试
 *
 * 覆盖：
 * - 正常回灌：worktree 修改 + 新建文件 → 主项目同步
 * - 冲突拒绝：主项目同文件已改 → apply 失败且主项目不被破坏
 * - 空 diff：无改动 → applied=true
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generateWorkspaceDiff,
  applyWorkspaceDiff,
  applyWorktreeToProject,
} from '../WorkspaceApply';

let tmpRoot: string;
let mainRepo: string;
let worktreePath: string;

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd,
  });
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wt-apply-'));
  mainRepo = join(tmpRoot, 'main');
  execSync(`git init "${mainRepo}"`, { stdio: 'pipe' });
  writeFileSync(join(mainRepo, 'a.txt'), 'line1\nline2\nline3\n');
  git(mainRepo, 'add', 'a.txt');
  git(
    mainRepo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-m',
    'init'
  );
  worktreePath = join(tmpRoot, 'feature-worktree');
  execSync(`git worktree add --detach "${worktreePath}"`, {
    cwd: mainRepo,
    stdio: 'pipe',
  });
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch — 清理失败不影响测试结论
  }
});

describe('apply-back（G1）', () => {
  test('正常回灌：修改 + 新建文件同步到主项目', async () => {
    // worktree 内修改 a.txt + 新建 b.txt
    writeFileSync(join(worktreePath, 'a.txt'), 'line1\nCHANGED\nline3\n');
    writeFileSync(join(worktreePath, 'b.txt'), 'new file\n');

    const result = await applyWorktreeToProject(worktreePath, mainRepo);
    expect(result.applied).toBe(true);
    expect(result.diff).toBeTruthy();

    // 主项目同步：a.txt 已修改、b.txt 已新建
    // 注：Windows core.autocrlf 会把 apply 写入的文件转成 CRLF，故用 toContain 而非精确匹配
    expect(readFileSync(join(mainRepo, 'a.txt'), 'utf-8')).toContain('CHANGED');
    expect(readFileSync(join(mainRepo, 'b.txt'), 'utf-8')).toContain(
      'new file'
    );
  });

  test('冲突拒绝：主项目同文件已改 → apply 失败且不破坏主项目', async () => {
    // 主项目先把 a.txt 改成另一个内容（未提交）
    writeFileSync(join(mainRepo, 'a.txt'), 'line1\nMAIN-CONFLICT\nline3\n');

    // worktree 再改 a.txt 同一行
    writeFileSync(join(worktreePath, 'a.txt'), 'line1\nWORKTREE-EDIT\nline3\n');

    const result = await applyWorktreeToProject(worktreePath, mainRepo);
    expect(result.applied).toBe(false);
    expect(result.error).toBeTruthy();
    // 主项目保持冲突前内容（未被覆盖）
    expect(readFileSync(join(mainRepo, 'a.txt'), 'utf-8')).toContain(
      'MAIN-CONFLICT'
    );
  });

  test('空 diff：无改动 → applied=true 且 diff 为空', async () => {
    // 恢复主项目（提交当前状态避免污染），worktree 重置到其 HEAD（清工作区+暂存区）
    git(mainRepo, 'add', 'a.txt', 'b.txt');
    git(
      mainRepo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-m',
      'sync'
    );
    execSync(`git -C "${worktreePath}" reset --hard HEAD`, { stdio: 'pipe' });

    const diff = await generateWorkspaceDiff(worktreePath);
    expect(diff.diff.trim()).toBe('');
    const result = await applyWorkspaceDiff(diff.diff, mainRepo);
    expect(result.applied).toBe(true);
  });
});
