/**
 * 上下文收集器
 * 提供统一的上下文收集功能，支持并行执行
 * 参考CC源码: cc_code/backend/context.ts
 */

import {
  systemContextService,
  type SystemContextInfo,
} from './SystemContextService.js';
import {
  userContextService,
  type UserContextInfo,
} from './UserContextService.js';
import { contextCacheService } from './ContextCacheService.js';

/**
 * 完整的上下文信息
 */
export interface FullContextInfo {
  system: SystemContextInfo;
  user: UserContextInfo;
  combined: string;
}

/**
 * 上下文收集选项
 */
export interface ContextCollectorOptions {
  cwd?: string;
  includeGit?: boolean;
  includeClaudeMd?: boolean;
  useCache?: boolean;
}

/**
 * 默认选项
 */
const DEFAULT_OPTIONS: ContextCollectorOptions = {
  includeGit: true,
  includeClaudeMd: true,
  useCache: true,
};

/**
 * 上下文收集器类
 */
export class ContextCollector {
  private static instance: ContextCollector;

  private constructor() {}

  static getInstance(): ContextCollector {
    if (!ContextCollector.instance) {
      ContextCollector.instance = new ContextCollector();
    }
    return ContextCollector.instance;
  }

  /**
   * 并行收集系统上下文和用户上下文
   * @param options 收集选项
   * @returns 完整的上下文信息
   */
  async collect(
    options: Partial<ContextCollectorOptions> = {}
  ): Promise<FullContextInfo> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (opts.useCache) {
      const cacheKey = `full_context_${opts.cwd || 'default'}`;
      const cached = contextCacheService.get<FullContextInfo>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const [systemContext, userContext] = await Promise.all([
      this.collectSystemContext(opts),
      this.collectUserContext(opts),
    ]);

    const combined = this.combineContexts(systemContext, userContext);

    const result: FullContextInfo = {
      system: systemContext,
      user: userContext,
      combined,
    };

    if (opts.useCache) {
      const cacheKey = `full_context_${opts.cwd || 'default'}`;
      contextCacheService.set(cacheKey, result);
    }

    return result;
  }

  /**
   * 收集系统上下文
   * @param options 收集选项
   * @returns 系统上下文信息
   */
  private async collectSystemContext(
    options: ContextCollectorOptions
  ): Promise<SystemContextInfo> {
    if (!options.includeGit) {
      return {
        currentDate: systemContextService.getCurrentDate(),
      };
    }

    return systemContextService.getSystemContext(options.cwd);
  }

  /**
   * 收集用户上下文
   * @param options 收集选项
   * @returns 用户上下文信息
   */
  private async collectUserContext(
    options: ContextCollectorOptions
  ): Promise<UserContextInfo> {
    if (!options.includeClaudeMd) {
      return {
        currentDate: userContextService.getCurrentDate(),
      };
    }

    return userContextService.getUserContext(options.cwd);
  }

  /**
   * 组合上下文
   * @param systemContext 系统上下文
   * @param userContext 用户上下文
   * @returns 组合后的字符串
   */
  private combineContexts(
    systemContext: SystemContextInfo,
    userContext: UserContextInfo
  ): string {
    const parts: string[] = [];

    if (userContext.claudeMd) {
      parts.push(userContext.claudeMd);
    }

    if (systemContext.gitStatus) {
      parts.push(systemContext.gitStatus);
    }

    parts.push(userContext.currentDate);

    return parts.join('\n\n');
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    systemContextService.clearCache();
    userContextService.clearCache();
    contextCacheService.clear();
  }
}

/**
 * 导出单例
 */
export const contextCollector = ContextCollector.getInstance();
