/**
 * G2：隔离 Provider（git-worktree > snapshot-copy）测试
 *
 * 覆盖：
 * - Registry 优先级：git 项目 → GitWorktreeProvider；非 git → SnapshotCopyProvider
 * - SnapshotCopyProvider：复制（排除 ignores）+ 修改 + dispose
 * - GitWorktreeProvider：prepare → publish（回灌）→ dispose 全流程
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WorkspaceProviderRegistry } from '../WorkspaceProviderRegistry';
import { GitWorktreeProvider } from '../GitWorktreeProvider';
import { SnapshotCopyProvider } from '../SnapshotCopyProvider';

let tmpRoot: string;
let gitProject: string;
let plainProject: string;
let snapshotBase: string;

function git(cwd: string, ...args: string[]) {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd,
  }).trim();
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wt-provider-'));
  gitProject = join(tmpRoot, 'gitproj');
  plainProject = join(tmpRoot, 'plainproj');
  snapshotBase = join(tmpRoot, 'snapshots');

  // git 项目（含首次提交）
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

  // 非 git 项目
  mkdirSync(plainProject, { recursive: true });
  writeFileSync(join(plainProject, 'a.txt'), 'base\n');
  mkdirSync(join(plainProject, 'node_modules'), { recursive: true });
  writeFileSync(join(plainProject, 'node_modules', 'big.js'), 'big');
  mkdirSync(snapshotBase, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // @ignore-catch
  }
});

function makeRegistry(): WorkspaceProviderRegistry {
  const registry = new WorkspaceProviderRegistry();
  registry.add(new SnapshotCopyProvider({ baseDir: snapshotBase }));
  registry.add(
    new GitWorktreeProvider({ projectRoot: gitProject, refuseDirty: true })
  );
  return registry;
}

describe('Registry 优先级选择（G2）', () => {
  test('git 项目 → GitWorktreeProvider（priority 1）', async () => {
    const registry = makeRegistry();
    const provider = await registry.resolve(gitProject);
    expect(provider.id).toBe('git-worktree');
  });

  test('非 git 目录 → SnapshotCopyProvider（priority 2 兜底）', async () => {
    const registry = makeRegistry();
    const provider = await registry.resolve(plainProject);
    expect(provider.id).toBe('snapshot-copy');
  });

  test('不存在的目录 → 抛错', async () => {
    const registry = makeRegistry();
    await expect(registry.resolve(join(tmpRoot, 'missing'))).rejects.toThrow();
  });
});

describe('SnapshotCopyProvider（G2）', () => {
  test('prepare 复制并排除 ignores；修改快照文件后 dispose 清理', async () => {
    const provider = new SnapshotCopyProvider({ baseDir: snapshotBase });
    const handle = await provider.prepare({
      projectRoot: plainProject,
      runId: 'snap-1',
    });
    expect(handle.strategy).toBe('snapshot-copy');
    expect(handle.cwd).not.toBe(plainProject);
    // 文件已复制、node_modules 已排除
    expect(existsSync(join(handle.cwd, 'a.txt'))).toBe(true);
    expect(existsSync(join(handle.cwd, 'node_modules'))).toBe(false);

    // 修改快照内文件
    writeFileSync(join(handle.cwd, 'a.txt'), 'changed\n');

    // publish：diff 平台可用时非空，否则为占位（不抛错）
    const out = await provider.publish(handle);
    expect(typeof out.diff).toBe('string');

    // dispose 清理
    await provider.dispose(handle, { keep: false });
    expect(existsSync(handle.cwd)).toBe(false);
  });

  test('keep=true 保留快照', async () => {
    const provider = new SnapshotCopyProvider({ baseDir: snapshotBase });
    const handle = await provider.prepare({
      projectRoot: plainProject,
      runId: 'snap-keep',
    });
    await provider.dispose(handle, { keep: true });
    expect(existsSync(handle.cwd)).toBe(true);
    await provider.dispose(handle, { keep: false });
  });
});

describe('GitWorktreeProvider（G2）', () => {
  test('prepare → publish 回灌 → dispose 全流程', async () => {
    const provider = new GitWorktreeProvider({ projectRoot: gitProject });
    const handle = await provider.prepare({
      projectRoot: gitProject,
      runId: 'wt-1',
    });
    expect(handle.strategy).toBe('git-worktree');
    expect(existsSync(handle.cwd)).toBe(true);

    // 在 worktree 内修改文件
    writeFileSync(join(handle.cwd, 'a.txt'), 'changed\n');

    // publish 回灌主项目
    const out = await provider.publish(handle);
    expect(out.diff).toBeTruthy();
    // 主项目工作区 a.txt 已更新（apply 只改工作区，不写 index）
    expect(
      require('fs').readFileSync(join(gitProject, 'a.txt'), 'utf-8')
    ).toContain('changed');

    // dispose 清理
    await provider.dispose(handle, { keep: false });
    expect(existsSync(handle.cwd)).toBe(false);
  });
});
