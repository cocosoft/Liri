// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Git Worktree 工作空间管理
 * 基于 git worktree 为 Agent 会话创建隔离的代码工作目录
 */
import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { WorktreeInfo } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'workspaces\WorkspaceGit',
  level: LogLevel.INFO,
});

/**
 * WorkspaceGit 构造选项
 */
interface WorkspaceGitOptions {
  baseDir: string;
}

/**
 * Git Worktree 工作空间管理器
 * 保留 Map<sessionId, WorktreeInfo> 运行时状态结构，确保 Bridge 热迁移时无状态丢失
 */
export class WorkspaceGit {
  private readonly baseDir: string;
  private worktrees: Map<string, WorktreeInfo> = new Map();

  constructor(options: WorkspaceGitOptions) {
    this.baseDir = options.baseDir;
  }

  /**
   * 为指定会话创建 git worktree
   * @param sessionId 会话 ID
   * @returns worktree 信息
   */
  async createWorktree(sessionId: string): Promise<WorktreeInfo> {
    if (this.worktrees.has(sessionId)) {
      return this.worktrees.get(sessionId)!;
    }

    const worktreeName = `bridge-${this.safeFilenameId(sessionId)}`;

    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      throw new AppError(
        'Not in a git repository',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const worktreePath = join(gitRoot, '..', 'worktrees', worktreeName);
    const worktreeBranch = `bridge/${worktreeName}`;

    try {
      execSync(`mkdir -p "${join(gitRoot, '..', 'worktrees')}"`, {
        stdio: 'ignore',
      });

      execSync(`git worktree add --detach "${worktreePath}"`, {
        cwd: gitRoot,
        stdio: 'ignore',
      });

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

      this.worktrees.set(sessionId, worktreeInfo);

      return worktreeInfo;
    } catch (error) {
      this.removeWorktree(sessionId);
      throw error;
    }
  }

  /**
   * 移除指定会话的 worktree
   * @param sessionId 会话 ID
   */
  async removeWorktree(sessionId: string): Promise<void> {
    const worktreeInfo = this.worktrees.get(sessionId);
    if (!worktreeInfo) {
      return;
    }

    try {
      execSync(`git worktree remove "${worktreeInfo.worktreePath}"`, {
        cwd: worktreeInfo.gitRoot,
        stdio: 'ignore',
      });
    } catch {
      if (existsSync(worktreeInfo.worktreePath)) {
        rmSync(worktreeInfo.worktreePath, { recursive: true, force: true });
      }
    } finally {
      this.worktrees.delete(sessionId);
    }
  }

  /**
   * 获取指定会话的 worktree 信息
   * @param sessionId 会话 ID
   */
  getWorktreeInfo(sessionId: string): WorktreeInfo | undefined {
    return this.worktrees.get(sessionId);
  }

  /**
   * 清理所有 worktree
   */
  async clearAllWorktrees(): Promise<void> {
    for (const sessionId of this.worktrees.keys()) {
      await this.removeWorktree(sessionId);
    }
  }

  /**
   * 获取 Git 根目录
   */
  private getGitRoot(): string | null {
    try {
      const result = execSync('git rev-parse --show-toplevel', {
        cwd: this.baseDir,
        stdio: 'pipe',
      });
      return result.toString().trim();
    } catch {
      return null;
    }
  }

  /**
   * 生成安全的文件名 ID
   */
  private safeFilenameId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  }
}

/**
 * 创建 WorkspaceGit 实例
 * @param options 配置选项
 */
export function createWorkspaceGit(options: WorkspaceGitOptions): WorkspaceGit {
  return new WorkspaceGit(options);
}
