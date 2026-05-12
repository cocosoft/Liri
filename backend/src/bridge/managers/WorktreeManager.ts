/**
 * 工作树管理器
 * 负责为会话创建和管理独立的工作树
 */

import { execSync } from 'child_process';
import { join, resolve } from 'path';
import { existsSync, rmSync } from 'fs';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 工作树信息
 */
export interface WorktreeInfo {
  /** 工作树路径 */
  worktreePath: string;
  /** 工作树分支 */
  worktreeBranch: string;
  /** Git根目录 */
  gitRoot: string;
  /** 是否基于钩子 */
  hookBased: boolean;
}

/**
 * 工作树管理器选项
 */
interface WorktreeManagerOptions {
  /** 基础目录 */
  baseDir: string;
}

/**
 * 工作树管理器
 */
export class WorktreeManager {
  private readonly baseDir: string;
  private worktrees: Map<string, WorktreeInfo> = new Map();

  constructor(options: WorktreeManagerOptions) {
    this.baseDir = options.baseDir;
  }

  /**
   * 创建工作树
   */
  async createWorktree(sessionId: string): Promise<WorktreeInfo> {
    // 检查是否已经存在工作树
    if (this.worktrees.has(sessionId)) {
      return this.worktrees.get(sessionId)!;
    }

    // 生成工作树名称
    const worktreeName = `bridge-${this.safeFilenameId(sessionId)}`;

    // 获取Git根目录
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      throw new AppError('Not in a git repository', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    // 创建工作树
    const worktreePath = join(gitRoot, '..', 'worktrees', worktreeName);
    const worktreeBranch = `bridge/${worktreeName}`;

    try {
      // 确保工作树目录存在
      execSync(`mkdir -p "${join(gitRoot, '..', 'worktrees')}"`, {
        stdio: 'ignore',
      });

      // 创建工作树
      execSync(`git worktree add --detach "${worktreePath}"`, {
        cwd: gitRoot,
        stdio: 'ignore',
      });

      // 创建临时分支
      execSync(`git checkout -b "${worktreeBranch}"`, {
        cwd: worktreePath,
        stdio: 'ignore',
      });

      const worktreeInfo: WorktreeInfo = {
        worktreePath,
        worktreeBranch,
        gitRoot,
        hookBased: false,
      };

      // 记录工作树信息
      this.worktrees.set(sessionId, worktreeInfo);

      return worktreeInfo;
    } catch (error) {
      // 清理失败的工作树
      this.removeWorktree(sessionId);
      throw error;
    }
  }

  /**
   * 移除工作树
   */
  async removeWorktree(sessionId: string): Promise<void> {
    const worktreeInfo = this.worktrees.get(sessionId);
    if (!worktreeInfo) {
      return;
    }

    try {
      // 移除工作树
      execSync(`git worktree remove "${worktreeInfo.worktreePath}"`, {
        cwd: worktreeInfo.gitRoot,
        stdio: 'ignore',
      });
    } catch (error) {
      // 如果git命令失败，尝试直接删除目录
      if (existsSync(worktreeInfo.worktreePath)) {
        rmSync(worktreeInfo.worktreePath, { recursive: true, force: true });
      }
    } finally {
      // 从记录中移除
      this.worktrees.delete(sessionId);
    }
  }

  /**
   * 获取工作树信息
   */
  getWorktreeInfo(sessionId: string): WorktreeInfo | undefined {
    return this.worktrees.get(sessionId);
  }

  /**
   * 获取Git根目录
   */
  private getGitRoot(): string | null {
    try {
      const result = execSync('git rev-parse --show-toplevel', {
        cwd: this.baseDir,
        stdio: 'pipe',
      });
      return result.toString().trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * 生成安全的文件名ID
   */
  private safeFilenameId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  /**
   * 清理所有工作树
   */
  async clearAllWorktrees(): Promise<void> {
    for (const sessionId of this.worktrees.keys()) {
      await this.removeWorktree(sessionId);
    }
  }
}

/**
 * 创建工作树管理器
 */
export function createWorktreeManager(
  options: WorktreeManagerOptions
): WorktreeManager {
  return new WorktreeManager(options);
}
