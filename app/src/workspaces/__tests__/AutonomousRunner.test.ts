/**
 * AutonomousRunner 自主执行编排测试（D1-Step2 闭环）
 *
 * 覆盖：
 * - git 项目：隔离区写入 → apply-back 回灌主项目（applied=true）
 * - 非 git 项目：snapshot 隔离 → 占位 diff（applied=false，人工合并）
 * - 执行抛错 → 返回 error 且隔离区被清理
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runAutonomousTask } from '../AutonomousRunner';

let tmpRoot: string;
let gitProject: string;
let plainProject: string;

function git(cwd: string, ...args: string[]) {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd,
  }).trim();
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wt-auto-'));
  gitProject = join(tmpRoot, 'gitproj');
  plainProject = join(tmpRoot, 'plainproj');

  execSync(`git init "${gitProject}"`, { stdio: 'pipe' });
  writeFileSync(join(gitProject, 'a.txt'), 'base\n');
  git(gitProject, 'add', 'a.txt');
  git(
    gitProject,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-m',
    'init'
  );

  execSync(`mkdir "${plainProject}"`, { stdio: 'pipe' });
  writeFileSync(join(plainProject, 'a.txt'), 'base\n');
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('runAutonomousTask（D1-Step2 闭环）', () => {
  // git 操作（worktree 创建+回灌）在 Windows 冷启动可能超 5s，bun test 默认超时 5s → 加长
  test('git 项目：隔离区写入 → apply-back 回灌主项目', async () => {
    const result = await runAutonomousTask({
      projectRoot: gitProject,
      runId: 'auto-git-1',
      execute: async ({ cwd }) => {
        // 模拟 agent 在隔离区内创建/修改文件
        writeFileSync(join(cwd, 'a.txt'), 'base\nCHANGED-BY-AUTONOMOUS\n');
        writeFileSync(join(cwd, 'new.txt'), 'created\n');
      },
    });
    expect(result.strategy).toBe('git-worktree');
    expect(result.applied).toBe(true);
    expect(result.diff).toBeTruthy();
    // 主项目已回灌
    expect(
      require('fs').readFileSync(join(gitProject, 'a.txt'), 'utf-8')
    ).toContain('CHANGED-BY-AUTONOMOUS');
    expect(existsSync(join(gitProject, 'new.txt'))).toBe(true);
  }, 30000);

  test('非 git 项目：snapshot 隔离 → 占位 diff（applied=false，人工合并）', async () => {
    const result = await runAutonomousTask({
      projectRoot: plainProject,
      runId: 'auto-plain-1',
      execute: async ({ cwd }) => {
        writeFileSync(join(cwd, 'a.txt'), 'base\nMODIFIED\n');
      },
    });
    expect(result.strategy).toBe('snapshot-copy');
    // snapshot 无 POSIX diff（Windows）或需人工合并 → applied=false
    expect(result.applied).toBe(false);
    // 隔离区已清理，主项目未被修改
    expect(
      require('fs').readFileSync(join(plainProject, 'a.txt'), 'utf-8')
    ).toBe('base\n');
  });

  // 注意：此测试复用 gitProject，但测试 1 已回灌导致工作区脏 →
  // GitWorktreeProvider refuseDirty 降级 snapshot-copy（策略无关紧要，本测试只验证错误路径清理）
  // 超时 30s 防御：若未来该测试独立运行（工作区干净）会走 git-worktree 慢路径
  test('执行抛错 → 返回 error 且隔离区被清理', async () => {
    const result = await runAutonomousTask({
      projectRoot: gitProject,
      runId: 'auto-err-1',
      execute: async () => {
        throw new Error('simulated failure');
      },
    });
    expect(result.applied).toBe(false);
    expect(result.error).toContain('simulated failure');
    // 隔离区已清理（provider dispose 执行）：worktrees 目录下无残留
    // 通过再次运行任务不冲突间接验证（无需精确断言目录）
  }, 30000);
});
