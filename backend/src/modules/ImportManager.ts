//
/**
 * 导入管理器
 * 统一管理模块导入，提供别名路径和批量导入功能
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import { ModuleDefinition, moduleRegistry } from './ModuleRegistry';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 导入管理器配置
 */
interface ImportManagerConfig {
  // 别名映射配置
  aliasMap: Record<string, string>;

  // 默认导入选项
  defaultOptions: {
    cache: boolean;
    lazy: boolean;
  };
}

/**
 * 导入选项
 */
interface ImportOptions {
  // 是否缓存导入结果
  cache?: boolean;

  // 是否懒加载
  lazy?: boolean;

  // 超时时间（毫秒）
  timeout?: number;

  // 错误处理策略
  errorHandling?: 'throw' | 'ignore' | 'log';
}

/**
 * 导入结果
 */
interface ImportResult<T = unknown> {
  success: boolean;
  module?: T;
  error?: Error;
  duration: number;
}

/**
 * 导入管理器类
 */
export class ImportManager {
  private static instance: ImportManager;
  private moduleCache: Map<string, unknown> = new Map();
  private config: ImportManagerConfig;

  /**
   * 私有构造函数
   */
  private constructor() {
    this.config = {
      aliasMap: {
        // 核心模块别名
        '@modules/plugin-sdk': './plugin-sdk',
        '@modules/core': './core',
        '@modules/infrastructure': './infrastructure',

        // 功能模块别名
        '@modules/ai': './ai',
        '@modules/agent': './agent',
        '@modules/bridge': './bridge',

        // 界面模块别名
        '@modules/ui': './ui',
        '@modules/cli': './cli',

        // 工具模块别名
        '@modules/tools': './tools',
        '@modules/commands': './commands',

        // 数据模块别名
        '@modules/memory': './memory',
        '@modules/cache': './cache',

        // 系统模块别名
        '@modules/security': './security',
        '@modules/performance': './performance',
        '@modules/monitoring': './monitoring',

        // 其他模块别名
        '@modules/analytics': './analytics',
        '@modules/buddy': './buddy',
        '@modules/chat': './chat',
        '@modules/chronos': './chronos',
        '@modules/config': './config',
        '@modules/context': './context',
        '@modules/cost': './cost',
        '@modules/docs': './docs',
        '@modules/error': './error',
        '@modules/hooks': './hooks',
        '@modules/lsp': './lsp',
        '@modules/mcp': './mcp',
        '@modules/plugins': './plugins',
        '@modules/query': './query',
        '@modules/sandbox': './sandbox',
        '@modules/services': './services',
      },
      defaultOptions: {
        cache: true,
        lazy: false,
      },
    };
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ImportManager {
    if (!ImportManager.instance) {
      ImportManager.instance = new ImportManager();
    }
    return ImportManager.instance;
  }

  /**
   * 解析别名路径
   */
  private resolveAlias(path: string): string {
    // 检查是否是别名路径
    for (const [alias, realPath] of Object.entries(this.config.aliasMap)) {
      if (path.startsWith(alias)) {
        return path.replace(alias, realPath);
      }
    }

    // 如果不是别名路径，直接返回
    return path;
  }

  /**
   * 导入单个模块
   */
  public async import<T = unknown>(
    path: string,
    options: ImportOptions = {}
  ): Promise<ImportResult<T>> {
    const startTime = Date.now();
    const mergedOptions = { ...this.config.defaultOptions, ...options };

    try {
      // 解析别名路径
      const resolvedPath = this.resolveAlias(path);

      // 检查缓存
      if (mergedOptions.cache && this.moduleCache.has(resolvedPath)) {
        const cached = this.moduleCache.get(resolvedPath) as T | undefined;
        return {
          success: true,
          module: cached,
          duration: Date.now() - startTime,
        };
      }

      // 动态导入模块
      let module: unknown;

      if (mergedOptions.lazy) {
        // 懒加载：返回一个代理对象
        module = new Proxy({} as Record<string, unknown>, {
          get: (target: Record<string, unknown>, prop: string) => {
            if (!target['__module__']) {
              target['__module__'] = this.loadModule(resolvedPath) as Promise<
                Record<string, unknown>
              >;
            }
            return (
              target['__module__'] as Promise<Record<string, unknown>>
            ).then((m: Record<string, unknown>) => m[prop]);
          },
        });
      } else {
        // 立即加载
        module = await this.loadModule(resolvedPath);
      }

      // 缓存模块
      if (mergedOptions.cache) {
        this.moduleCache.set(resolvedPath, module);
      }

      return {
        success: true,
        module: module as T,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorResult: ImportResult<T> = {
        success: false,
        error: error as Error,
        duration: Date.now() - startTime,
      };

      // 错误处理
      switch (mergedOptions.errorHandling) {
        case 'ignore':
          break;
        case 'log':
          logger.error(`导入模块失败: ${path}`, { error });
          break;
        case 'throw':
        default:
          throw error;
      }

      return errorResult;
    }
  }

  /**
   * 批量导入模块
   */
  public async importMultiple(
    paths: string[],
    options: ImportOptions = {}
  ): Promise<Record<string, ImportResult>> {
    const results: Record<string, ImportResult> = {};

    // 并行导入所有模块
    const importPromises = paths.map(async (path) => {
      const result = await this.import(path, options);
      results[path] = result;
    });

    await Promise.all(importPromises);

    return results;
  }

  /**
   * 从模块注册表导入模块
   */
  public async importFromRegistry<T = any>(
    moduleId: string,
    options: ImportOptions = {}
  ): Promise<ImportResult<T>> {
    const moduleDef = moduleRegistry.find(moduleId);
    if (!moduleDef) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MODULE_NOT_REGISTERED',
        { moduleId }
      );
    }

    // 构建模块路径
    const modulePath = `@modules/${moduleDef.category}/${moduleDef.name}`;

    return this.import<T>(modulePath, options);
  }

  /**
   * 加载模块的具体实现
   */
  private async loadModule(path: string): Promise<unknown> {
    return await import(path);
  }

  /**
   * 清除缓存
   */
  public clearCache(path?: string): void {
    if (path) {
      const resolvedPath = this.resolveAlias(path);
      this.moduleCache.delete(resolvedPath);
    } else {
      this.moduleCache.clear();
    }
  }

  /**
   * 获取缓存统计信息
   */
  public getCacheStats(): {
    total: number;
    size: number;
    hitRate: number;
  } {
    // 这里可以添加更详细的缓存统计
    return {
      total: this.moduleCache.size,
      size: 0, // 实际项目中可以计算缓存大小
      hitRate: 0, // 实际项目中可以统计命中率
    };
  }

  /**
   * 配置导入管理器
   */
  public configure(config: Partial<ImportManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 添加别名映射
   */
  public addAlias(alias: string, realPath: string): void {
    this.config.aliasMap[alias] = realPath;
  }

  /**
   * 获取所有别名映射
   */
  public getAliases(): Record<string, string> {
    return { ...this.config.aliasMap };
  }
}

/**
 * 全局导入管理器实例
 */
export const importManager = ImportManager.getInstance();

/**
 * 便捷导入函数
 */
export async function importModule<T = unknown>(
  path: string,
  options?: ImportOptions
): Promise<T> {
  const result = await importManager.import<T>(path, options);
  if (!result.success) {
    throw result.error;
  }
  return result.module!;
}

/**
 * 从注册表便捷导入函数
 */
export async function importFromRegistry<T = unknown>(
  moduleId: string,
  options?: ImportOptions
): Promise<T> {
  const result = await importManager.importFromRegistry<T>(moduleId, options);
  if (!result.success) {
    throw result.error;
  }
  return result.module!;
}
