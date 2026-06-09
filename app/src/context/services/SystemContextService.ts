/**
 * 系统上下文收集服务
 * 提供系统级别的上下文信息收集功能
 * 参考CC源码: cc_code/backend/context.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { TTLCache } from '@modules/utils/cache';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

const execAsync = promisify(exec);

/**
 * Git状态限制
 */
const MAX_STATUS_CHARS = 2000;

/**
 * Git状态信息
 */
export interface GitStatusInfo {
  branch: string;
  mainBranch: string;
  status: string;
  recentCommits: string;
  userName?: string;
  truncated: boolean;
}

/**
 * 系统上下文信息
 */
export interface SystemContextInfo {
  gitStatus?: string;
  currentDate: string;
  systemInfo?: string;
}

/**
 * 系统上下文服务类
 */
export class SystemContextService {
  private static instance: SystemContextService;
  private cache: TTLCache<unknown>;

  private constructor() {
    this.cache = new TTLCache(100, 60000);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SystemContextService {
    if (!SystemContextService.instance) {
      SystemContextService.instance = new SystemContextService();
    }
    return SystemContextService.instance;
  }

  /**
   * 执行git命令
   * @param args git命令参数
   * @param cwd 工作目录
   * @returns 命令输出
   */
  private async execGitCommand(args: string[], cwd?: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`git ${args.join(' ')}`, {
        cwd: cwd || process.cwd(),
        encoding: 'utf-8',
      });
      return stdout.trim();
    } catch (error) {
      return '';
    }
  }

  /**
   * 检查是否在git仓库中
   * @param cwd 工作目录
   * @returns 是否在git仓库中
   */
  async isGitRepository(cwd?: string): Promise<boolean> {
    try {
      await this.execGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前分支
   * @param cwd 工作目录
   * @returns 分支名称
   */
  async getBranch(cwd?: string): Promise<string> {
    return this.execGitCommand(['branch', '--show-current'], cwd);
  }

  /**
   * 获取默认分支
   * @param cwd 工作目录
   * @returns 默认分支名称
   */
  async getDefaultBranch(cwd?: string): Promise<string> {
    const remoteBranch = await this.execGitCommand(
      ['symbolic-ref', 'refs/remotes/origin/HEAD'],
      cwd
    );
    if (remoteBranch) {
      const match = remoteBranch.match(/origin\/(.+)/);
      return match ? match[1] : 'main';
    }
    return 'main';
  }

  /**
   * 获取git状态
   * @param cwd 工作目录
   * @returns git状态信息
   */
  async getGitStatus(cwd?: string): Promise<GitStatusInfo | null> {
    if (configManager.env('NODE_ENV') === 'test') {
      return null;
    }

    const isGit = await this.isGitRepository(cwd);
    if (!isGit) {
      return null;
    }

    try {
      const [branch, mainBranch, status, log, userName] = await Promise.all([
        this.getBranch(cwd),
        this.getDefaultBranch(cwd),
        this.execGitCommand(['--no-optional-locks', 'status', '--short'], cwd),
        this.execGitCommand(
          ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
          cwd
        ),
        this.execGitCommand(['config', 'user.name'], cwd),
      ]);

      const truncated = status.length > MAX_STATUS_CHARS;
      const truncatedStatus = truncated
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
        : status;

      return {
        branch,
        mainBranch,
        status: truncatedStatus,
        recentCommits: log,
        userName: userName || undefined,
        truncated,
      };
    } catch (error) {
      logger.error('Failed to get git status:', { error });
      return null;
    }
  }

  /**
   * 格式化git状态为字符串
   * @param gitStatus git状态信息
   * @returns 格式化后的字符串
   */
  formatGitStatus(gitStatus: GitStatusInfo): string {
    const parts = [
      'This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.',
      `Current branch: ${gitStatus.branch}`,
      `Main branch (you will usually use this for PRs): ${gitStatus.mainBranch}`,
    ];

    if (gitStatus.userName) {
      parts.push(`Git user: ${gitStatus.userName}`);
    }

    parts.push(`Status:\n${gitStatus.status || '(clean)'}`);
    parts.push(`Recent commits:\n${gitStatus.recentCommits}`);

    return parts.join('\n\n');
  }

  /**
   * 获取当前日期
   * @returns ISO格式的日期字符串
   */
  getCurrentDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * 获取系统上下文
   * @param cwd 工作目录
   * @returns 系统上下文信息
   */
  async getSystemContext(cwd?: string): Promise<SystemContextInfo> {
    const cacheKey = `system_context_${cwd || 'default'}`;
    const cached = this.getFromCache<SystemContextInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    const gitStatus = await this.getGitStatus(cwd);

    const context: SystemContextInfo = {
      currentDate: `Today's date is ${this.getCurrentDate()}.`,
    };

    if (gitStatus) {
      context.gitStatus = this.formatGitStatus(gitStatus);
    }

    this.setCache(cacheKey, context);
    return context;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 从缓存获取值
   */
  private getFromCache<T>(key: string): T | null {
    return this.cache.get(key) as T | null;
  }

  /**
   * 设置缓存
   */
  private setCache(key: string, value: unknown): void {
    this.cache.set(key, value);
  }
}

/**
 * 导出单例
 */
export const systemContextService = SystemContextService.getInstance();
