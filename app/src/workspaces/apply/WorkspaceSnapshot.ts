// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * WorkspaceSnapshot — 工作区影子 git 快照（P1-4，对标 Hermes CheckpointManager）
 *
 * 在隔离区/工作区执行前自动 `git add -A + commit` 生成快照 commit，
 * 供"失败一键回滚"（restoreWorkspaceSnapshot）与现场排查（listWorkspaceSnapshots）。
 *
 * 说明：
 * - 快照 commit 落在当前分支（隔离 worktree 分支），不污染主分支；
 *   apply-back 的 `git diff HEAD` 基线随之更新（快照后改动 = 执行产出），语义更清晰。
 * - 无改动时跳过 commit（返回当前 HEAD），避免空提交噪音。
 * - 全部使用 spawn 数组参数（防命令注入，对齐 WorkspaceApply）。
 */

import { spawn } from 'child_process';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('workspaces:snapshot');

export interface WorkspaceSnapshotInfo {
  /** 快照 commit 的完整 hash（恢复/差异用） */
  hash: string;
  /** 快照所在分支名 */
  branch: string;
}

/** 快照列表项 */
export interface SnapshotEntry {
  hash: string;
  subject: string;
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runProcess(bin: string, args: string[]): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString('utf-8')));
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString('utf-8')));
    child.on('error', (error) => {
      resolve({ exitCode: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * 创建工作区快照：`git add -A && git commit -m "snapshot: {label}"`。
 * 无改动时跳过 commit（返回当前 HEAD）。
 */
export async function createWorkspaceSnapshot(
  cwd: string,
  label: string,
  gitBin = 'git'
): Promise<WorkspaceSnapshotInfo> {
  const add = await runProcess(gitBin, ['-C', cwd, 'add', '-A']);
  if (add.exitCode !== 0) {
    throw new Error(`snapshot: git add failed: ${add.stderr}`);
  }

  const commit = await runProcess(gitBin, [
    '-C',
    cwd,
    'commit',
    '-m',
    `snapshot: ${label}`,
  ]);
  if (
    commit.exitCode !== 0 &&
    !/nothing to commit|no changes added/i.test(commit.stderr + commit.stdout)
  ) {
    throw new Error(`snapshot: git commit failed: ${commit.stderr}`);
  }

  const head = await runProcess(gitBin, ['-C', cwd, 'rev-parse', 'HEAD']);
  const branch = await runProcess(gitBin, [
    '-C',
    cwd,
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  const hash = head.stdout.trim();
  if (!hash) {
    throw new Error(`snapshot: cannot resolve HEAD: ${head.stderr}`);
  }
  return { hash, branch: branch.stdout.trim() || 'HEAD' };
}

/**
 * 回滚工作区到指定快照：`git reset --hard {hash}`（丢弃快照后的全部改动）。
 */
export async function restoreWorkspaceSnapshot(
  cwd: string,
  hash: string,
  gitBin = 'git'
): Promise<void> {
  const reset = await runProcess(gitBin, ['-C', cwd, 'reset', '--hard', hash]);
  if (reset.exitCode !== 0) {
    throw new Error(`snapshot: git reset --hard failed: ${reset.stderr}`);
  }
  logger.info('workspace 已回滚到快照', { cwd, hash });
}

/**
 * 列出工作区最近 N 个快照 commit（`git log --oneline`）。
 */
export async function listWorkspaceSnapshots(
  cwd: string,
  limit = 10,
  gitBin = 'git'
): Promise<SnapshotEntry[]> {
  const log = await runProcess(gitBin, [
    '-C',
    cwd,
    'log',
    '--oneline',
    `-n ${limit}`,
  ]);
  if (log.exitCode !== 0) return [];
  return log.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.trim().split(' ');
      return { hash, subject: rest.join(' ') };
    });
}
