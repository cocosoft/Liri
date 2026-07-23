/**
 * 用户上下文服务
 * 实现用户上下文文件的读取和注入
 */

import fs from 'fs';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveProjectRoot } from '@modules/core';

const logger = new Logger({
  module: 'context:userContextService',
  level: LogLevel.INFO,
});

const MAX_CONTEXT_FILE_SIZE = 50000; // 50KB

/**
 * 用户上下文文件
 */
export interface UserContextFile {
  name: string;
  content: string;
  path: string;
}

/**
 * 用户上下文服务
 */
export class UserContextService {
  private static instance: UserContextService;
  private cachedContent: string | null = null;
  private cacheClearCallback: (() => void) | null = null;

  private constructor() {}

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
   * 获取当前日期字符串
   */
  getCurrentDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * 格式化当前日期
   */
  formatCurrentDate(): string {
    return `Today's date is ${this.getCurrentDate()}.`;
  }

  /**
   * 读取文件内容
   */
  async readFile(filePath: string): Promise<string | null> {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        return null;
      }

      // 检查文件大小
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_CONTEXT_FILE_SIZE) {
        logger.warning(
          `Context file ${filePath} exceeds max size, reading truncated`
        );
      }

      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf-8');
      return content;
    } catch (error) {
      await handleError(error, {
        module: 'context:user',
        action: 'read_context',
      });
      return null;
    }
  }

  /**
   * 查找用户上下文文件
   * 优先级：Liri.md > CLAUDE.md > .claude.md
   */
  async findUserContextFile(): Promise<string | null> {
    const possibleFiles = [
      path.join(resolveProjectRoot(), 'Liri.md'),
      path.join(resolveProjectRoot(), 'CLAUDE.md'),
      path.join(resolveProjectRoot(), '.claude.md'),
    ];

    for (const file of possibleFiles) {
      if (fs.existsSync(file)) {
        return file;
      }
    }

    return null;
  }

  /**
   * 获取用户上下文文件内容
   */
  async getUserContextFile(): Promise<UserContextFile | null> {
    const filePath = await this.findUserContextFile();
    if (!filePath) {
      return null;
    }

    const content = await this.readFile(filePath);
    if (!content) {
      return null;
    }

    const fileName = path.basename(filePath);
    return {
      name: fileName,
      content,
      path: filePath,
    };
  }

  /**
   * 格式化用户上下文
   */
  formatUserContext(userContext: UserContextFile | null): string | null {
    if (!userContext) {
      return null;
    }
    return userContext.content;
  }

  /**
   * 获取用户上下文
   */
  async getUserContext(): Promise<{
    userContext: string | null;
    currentDate: string;
  }> {
    const userContextFile = await this.getUserContextFile();

    return {
      userContext: this.formatUserContext(userContextFile),
      currentDate: this.formatCurrentDate(),
    };
  }

  /**
   * 注入当前日期到上下文
   */
  injectCurrentDate(context: string): string {
    return context.replace(/\{\{current_date\}\}/g, this.getCurrentDate());
  }

  /**
   * 注入用户信息到上下文
   */
  injectUserInfo(context: string, userName: string | null): string {
    if (!userName) {
      return context;
    }
    return context.replace(/\{\{user_name\}\}/g, userName);
  }

  /**
   * 设置缓存
   */
  setCachedContent(content: string | null): void {
    this.cachedContent = content;
  }

  /**
   * 获取缓存内容
   */
  getCachedContent(): string | null {
    return this.cachedContent;
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
    this.cachedContent = null;
    this.cacheClearCallback?.();
  }
}

/**
 * 获取用户上下文服务实例
 */
export function getUserContextService(): UserContextService {
  return UserContextService.getInstance();
}

/**
 * 获取用户上下文（便捷函数）
 */
export async function fetchUserContext(): Promise<{
  userContext: string | null;
  currentDate: string;
}> {
  const service = getUserContextService();
  return service.getUserContext();
}
