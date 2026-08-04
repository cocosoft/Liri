/**
 * Git 工具函数
 *
 * 提供常用 Git 操作封装，补充 utils/git/ 子目录的低层级文件系统操作。
 * 参考 CC源码 cc_code/backend/utils/git.ts
 */

import crypto from 'node:crypto';
import { execSync } from 'child_process';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ module: 'utils:git', level: LogLevel.INFO });

export interface GitInfo {
  branch: string | null;
  remoteUrl: string | null;
  commitHash: string | null;
  isDirty: boolean;
}

export function getGitInfo(cwd?: string): GitInfo {
  const dir = cwd || process.cwd();
  return {
    branch: getCurrentBranch(dir),
    remoteUrl: getRemoteUrl(dir),
    commitHash: getCommitHash(dir),
    isDirty: isWorkingTreeDirty(dir),
  };
}

function getCurrentBranch(cwd: string): string | null {
  try {
    const output = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.trim();
  } catch (error) {
    handleError(error, { module: 'utils:git', action: 'getCurrentBranch' });
    return null;
  }
}

function getRemoteUrl(cwd: string): string | null {
  try {
    const output = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.trim();
  } catch (error) {
    handleError(error, { module: 'utils:git', action: 'getRemoteUrl' });
    return null;
  }
}

function getCommitHash(cwd: string): string | null {
  try {
    const output = execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.trim();
  } catch (error) {
    handleError(error, { module: 'utils:git', action: 'getCommitHash' });
    return null;
  }
}

function isWorkingTreeDirty(cwd: string): boolean {
  try {
    const output = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.trim().length > 0;
  } catch (error) {
    handleError(error, { module: 'utils:git', action: 'isWorkingTreeDirty' });
    return false;
  }
}

export function getRepoRemoteHash(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
}

export function isInGitRepo(cwd?: string): boolean {
  const dir = cwd || process.cwd();
  try {
    const output = execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.trim() === 'true';
  } catch (error) {
    handleError(error, { module: 'utils:git', action: 'isInGitRepo' });
    return false;
  }
}
