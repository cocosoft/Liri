/**
 * Git状态服务
 * 实现Git状态注入到系统提示
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const MAX_STATUS_CHARS = 2000;

/**
 * Git状态信息
 */
export interface GitStatusInfo {
  branch: string;
  mainBranch: string;
  status: string;
  recentCommits: string;
  userName: string | null;
}

/**
 * Git状态服务
 */
export class GitContextService {
  private static instance: GitContextService;
  private cachedStatus: string | null = null;
  private cacheClearCallback: (() => void) | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): GitContextService {
    if (!GitContextService.instance) {
      GitContextService.instance = new GitContextService();
    }
    return GitContextService.instance;
  }

  /**
   * 检查是否为Git仓库
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', {
        cwd: process.cwd(),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前分支
   */
  async getBranch(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git branch --show-current', {
        cwd: process.cwd(),
      });
      return stdout.trim() || 'HEAD';
    } catch {
      return null;
    }
  }

  /**
   * 获取默认分支（主分支）
   */
  async getDefaultBranch(): Promise<string | null> {
    try {
      // 尝试获取远程主分支
      const { stdout } = await execAsync(
        'git rev-parse --verify origin/main --quiet 2>/dev/null || git rev-parse --verify origin/master --quiet',
        {
          cwd: process.cwd(),
        }
      );

      if (stdout.trim()) {
        // 获取主分支名称
        const { stdout: mainBranch } = await execAsync(
          'git name-reveal --all origin/main --quiet 2>/dev/null || git name-reveal --all origin/master --quiet || echo main',
          {
            cwd: process.cwd(),
          }
        );
        return mainBranch.trim() || 'main';
      }
      return 'main';
    } catch {
      return 'main';
    }
  }

  /**
   * 获取Git状态（简短格式）
   */
  async getStatus(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        'git --no-optional-locks status --short',
        {
          cwd: process.cwd(),
        }
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * 获取最近提交
   */
  async getRecentCommits(count: number = 5): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git --no-optional-locks log --oneline -n ${count}`,
        {
          cwd: process.cwd(),
        }
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * 获取Git用户名
   */
  async getUserName(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git config user.name', {
        cwd: process.cwd(),
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * 获取完整的Git状态信息
   */
  async getGitStatus(): Promise<GitStatusInfo | null> {
    // 检查是否为测试环境
    if (process.env.NODE_ENV === 'test') {
      return null;
    }

    try {
      const isGit = await this.isGitRepository();
      if (!isGit) {
        return null;
      }

      const [branch, mainBranch, status, recentCommits, userName] =
        await Promise.all([
          this.getBranch(),
          this.getDefaultBranch(),
          this.getStatus(),
          this.getRecentCommits(),
          this.getUserName(),
        ]);

      return {
        branch: branch || 'unknown',
        mainBranch: mainBranch || 'main',
        status: status || '(clean)',
        recentCommits: recentCommits || 'No commits',
        userName,
      };
    } catch (error) {
      console.error('Failed to get git status:', error);
      return null;
    }
  }

  /**
   * 格式化为系统提示
   */
  formatAsSystemPrompt(gitStatus: GitStatusInfo): string {
    const { branch, mainBranch, status, recentCommits, userName } = gitStatus;

    // 截断过长的状态
    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
        : status;

    const parts: string[] = [
      `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
      `Current branch: ${branch}`,
      `Main branch (you will usually use this for PRs): ${mainBranch}`,
    ];

    if (userName) {
      parts.push(`Git user: ${userName}`);
    }

    parts.push(
      `Status:\n${truncatedStatus}`,
      `Recent commits:\n${recentCommits}`
    );

    return parts.join('\n\n');
  }

  /**
   * 获取Git状态作为系统提示
   */
  async getGitStatusAsSystemPrompt(): Promise<string | null> {
    const gitStatus = await this.getGitStatus();
    if (!gitStatus) {
      return null;
    }
    return this.formatAsSystemPrompt(gitStatus);
  }

  /**
   * 设置缓存清除回调
   */
  setCacheClearCallback(callback: () => void): void {
    this.cacheClearCallback = callback;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedStatus = null;
    this.cacheClearCallback?.();
  }
}

/**
 * 获取Git上下文服务实例
 */
export function getGitContextService(): GitContextService {
  return GitContextService.getInstance();
}

/**
 * 获取Git状态（便捷函数）
 */
export async function fetchGitStatus(): Promise<string | null> {
  const service = getGitContextService();
  return service.getGitStatusAsSystemPrompt();
}

/**
 * 获取Git状态信息（便捷函数）
 */
export async function fetchGitStatusInfo(): Promise<GitStatusInfo | null> {
  const service = getGitContextService();
  return service.getGitStatus();
}
