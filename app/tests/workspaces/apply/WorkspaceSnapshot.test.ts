/**
 * WorkspaceSnapshot 影子 git 快照测试（P1-4，对标 Hermes CheckpointManager）
 *
 * 覆盖：
 * - createWorkspaceSnapshot：执行前快照 commit，返回 hash
 * - 无改动时跳过 commit（返回当前 HEAD，不产生空提交）
 * - restoreWorkspaceSnapshot：回滚工作区到快照
 * - listWorkspaceSnapshots：列出快照历史
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
  listWorkspaceSnapshots,
} from '../../../src/workspaces/apply/WorkspaceSnapshot';

let repo: string;

function git(cwd: string, ...args: string[]) {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd,
  }).trim();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'wt-snap-'));
  execSync(`git init "${repo}"`, { stdio: 'pipe' });
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', 'a.txt');
  git(
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-m',
    'init'
  );
});

afterAll(() => {
  try {
    rmSync(repo, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

describe('WorkspaceSnapshot（P1-4）', () => {
  // Windows 冷启动 git commit 可能超 5s，bun test 默认超时 5s → 加长
  test('createWorkspaceSnapshot：执行前快照 commit，返回 hash', async () => {
    writeFileSync(join(repo, 'b.txt'), 'pending\n');
    const snap = await createWorkspaceSnapshot(repo, 'before-execute-test');
    expect(snap.hash).toBeTruthy();
    expect(snap.branch).toBe('master'); // 默认分支名（测试环境）
    // 快照后工作区干净
    expect(git(repo, 'status', '--porcelain')).toBe('');
  }, 30000);

  test('无改动时跳过 commit（返回当前 HEAD）', async () => {
    const headBefore = git(repo, 'rev-parse', 'HEAD');
    const snap = await createWorkspaceSnapshot(repo, 'no-change');
    expect(snap.hash).toBe(headBefore);
  }, 30000);

  test('restoreWorkspaceSnapshot：回滚工作区到快照', async () => {
    // 快照当前状态（含 b.txt）
    const snap = await createWorkspaceSnapshot(repo, 'baseline');
    // 制造改动
    writeFileSync(join(repo, 'a.txt'), 'base\nCORRUPTED\n');
    writeFileSync(join(repo, 'b.txt'), 'changed\n');
    expect(readFileSync(join(repo, 'a.txt'), 'utf-8')).toContain('CORRUPTED');
    // 回滚
    await restoreWorkspaceSnapshot(repo, snap.hash);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // CRLF：Windows core.autocrlf 检出 \r\n，用 toContain 而非 toBe
    expect(readFileSync(join(repo, 'a.txt'), 'utf-8')).toContain('base');
    expect(readFileSync(join(repo, 'b.txt'), 'utf-8')).toContain('pending');
  }, 30000);

  test('listWorkspaceSnapshots：列出快照历史', async () => {
    const list = await listWorkspaceSnapshots(repo, 10);
    // init + before-execute（baseline 无改动跳过，不产生新 commit）
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some((e) => e.subject.includes('before-execute'))).toBe(true);
  }, 30000);
});
