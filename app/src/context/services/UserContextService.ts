/**
 * 用户上下文收集服务
 * 提供用户级别的上下文信息收集功能
 * 参考CC源码: cc_code/backend/context.ts
 */

import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { TTLCache } from '@modules/utils/cache';
import { configManager } from '@modules/config';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 用户上下文信息
 */
export interface UserContextInfo {
  claudeMd?: string;
  currentDate: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
}

/**
 * 用户上下文服务类
 */
export class UserContextService {
  private static instance: UserContextService;
  private cache: TTLCache<unknown>;

  private constructor() {
    this.cache = new TTLCache(100, 60000);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): UserContextService {
    if (!UserContextService.instance) {
      UserContextService.instance = new UserContextService();
    }
    return UserContextService.instance;
  }

  /**
   * 检查文件是否存在
   * @param filePath 文件路径
   * @returns 是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 读取文件内容
   * @param filePath 文件路径
   * @returns 文件内容
   */
  private async readFileContent(filePath: string): Promise<string | null> {
    try {
      if (!(await this.fileExists(filePath))) {
        return null;
      }
      const content = await readFile(filePath, 'utf-8');
      return content.trim();
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, { error });
      return null;
    }
  }

  /**
   * 查找Liri.md文件
   * @param startDir 起始目录
   * @returns Liri.md文件路径
   */
  private async findClaudeMd(startDir: string): Promise<string | null> {
    const claudeMdNames = ['Liri.md', 'Liri.md', 'Liri.md'];

    for (const name of claudeMdNames) {
      const filePath = join(startDir, name);
      if (await this.fileExists(filePath)) {
        return filePath;
      }
    }

    return null;
  }

  /**
   * 获取claude.md内容
   * @param cwd 工作目录
   * @returns claude.md内容
   */
  async getClaudeMdContent(cwd?: string): Promise<string | null> {
    const workingDir = cwd || process.cwd();

    if (configManager.env('CLAUDE_CODE_DISABLE_CLAUDE_MDS') === 'true') {
      return null;
    }

    const claudeMdPath = await this.findClaudeMd(workingDir);
    if (!claudeMdPath) {
      return null;
    }

    return this.readFileContent(claudeMdPath);
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
   * 获取用户上下文
   * @param cwd 工作目录
   * @returns 用户上下文信息
   */
  async getUserContext(cwd?: string): Promise<UserContextInfo> {
    const cacheKey = `user_context_${cwd || 'default'}`;
    const cached = this.getFromCache<UserContextInfo>(cacheKey);
    if (cached) {
      return cached;
    }

    const workingDir = cwd || process.cwd();
    const claudeMd = await this.getClaudeMdContent(workingDir);

    const context: UserContextInfo = {
      currentDate: `Today's date is ${this.getCurrentDate()}.`,
      projectPath: workingDir,
    };

    if (claudeMd) {
      context.claudeMd = claudeMd;
    }

    this.setCache(cacheKey, context);
    return context;
  }

  /**
   * 格式化用户上下文为字符串
   * @param userContext 用户上下文信息
   * @returns 格式化后的字符串
   */
  formatUserContext(userContext: UserContextInfo): string {
    const parts: string[] = [];

    if (userContext.claudeMd) {
      parts.push(userContext.claudeMd);
    }

    parts.push(userContext.currentDate);

    return parts.join('\n\n');
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
export const userContextService = UserContextService.getInstance();
