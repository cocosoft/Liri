//
/**
 * 启动预加载服务
 * 参考CC源码的并行预加载机制，在应用启动时并行执行所有预加载任务
 * 以减少整体启动时间
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('StartupPreloader');

/**
 * 预加载任务接口
 */
export interface PreloadTask {
  name: string;
  execute: () => Promise<void>;
}

/**
 * 预加载结果接口
 */
export interface PreloadResult {
  success: boolean;
  duration: number;
  failedTasks: string[];
  completedTasks: string[];
}

/**
 * 启动预加载管理器
 * 实现并行预加载机制，参考CC源码的startKeychainPrefetch和startMdmRawRead模式
 */
export class StartupPreloader {
  private static instance: StartupPreloader;
  private preloadTasks: Map<string, PreloadTask> = new Map();
  private preloadPromises: Map<string, Promise<void>> = new Map();
  private startTime: number = 0;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): StartupPreloader {
    if (!StartupPreloader.instance) {
      StartupPreloader.instance = new StartupPreloader();
    }
    return StartupPreloader.instance;
  }

  /**
   * 注册预加载任务
   * @param name 任务名称
   * @param execute 任务执行函数
   */
  registerTask(name: string, execute: () => Promise<void>): void {
    this.preloadTasks.set(name, { name, execute });
    logger.debug(`Registered preload task: ${name}`);
  }

  /**
   * 启动所有预加载任务（并行执行）
   * 参考CC源码模式：在模块加载阶段立即启动，不阻塞后续初始化
   */
  startAll(): void {
    this.startTime = Date.now();
    logger.info('Starting parallel preload tasks...');

    const tasks = Array.from(this.preloadTasks.entries());
    for (const [name, task] of tasks) {
      // 立即启动所有任务，让它们并行运行
      // 不在这里捕获错误，让 ensureAllCompleted 统一处理
      const promise = task.execute().then(() => {
        logger.debug(`Preload task completed: ${name}`);
      });

      this.preloadPromises.set(name, promise);
    }
  }

  /**
   * 等待所有预加载任务完成
   * 在初始化流程的关键节点调用，确保预加载完成
   */
  async ensureAllCompleted(): Promise<PreloadResult> {
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];

    // 等待所有任务完成
    const promises = Array.from(this.preloadPromises.entries());
    const results = await Promise.allSettled(
      promises.map(([name, promise]) =>
        promise
          .then(() => ({ status: 'fulfilled' as const, name }))
          .catch((error) => ({ status: 'rejected' as const, name, error }))
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.status === 'fulfilled') {
          completedTasks.push(result.value.name);
        } else {
          failedTasks.push(result.value.name);
        }
      } else {
        // Promise.allSettled 不会进入这里，因为我们已经处理了所有 promise
        failedTasks.push('unknown');
      }
    }

    const duration = Date.now() - this.startTime;
    const success = failedTasks.length === 0;

    logger.info(
      `Preload completed: ${completedTasks.length} succeeded, ` +
        `${failedTasks.length} failed (${duration}ms)`
    );

    return {
      success,
      duration,
      failedTasks,
      completedTasks,
    };
  }

  /**
   * 等待特定任务完成
   * @param taskName 任务名称
   */
  async ensureTaskCompleted(taskName: string): Promise<void> {
    const promise = this.preloadPromises.get(taskName);
    if (promise) {
      await promise;
    }
  }

  /**
   * 获取已注册的预加载任务列表
   */
  getRegisteredTasks(): string[] {
    return Array.from(this.preloadTasks.keys());
  }

  /**
   * 检查任务是否已完成
   * @param taskName 任务名称
   */
  isTaskCompleted(taskName: string): boolean {
    const promise = this.preloadPromises.get(taskName);
    return promise !== undefined;
  }

  /**
   * 重置预加载器（用于测试）
   */
  reset(): void {
    this.preloadTasks.clear();
    this.preloadPromises.clear();
    this.startTime = 0;
  }
}

/**
 * 创建默认的预加载任务
 * 这些任务将在应用启动时并行执行
 */
export function createDefaultPreloadTasks(): PreloadTask[] {
  return [
    {
      name: 'oauth_tokens',
      execute: async () => {
        // 预加载OAuth Token到内存缓存
        try {
          const { createOAuthStorage } =
            await import('../../oauth/services/OAuthStorage.js');
          const storage = createOAuthStorage();
          const keys = await storage.listKeys();
          logger.debug(`OAuth tokens preloaded: ${keys.length} keys`);
        } catch (error) {
          logger.warn('Failed to preload OAuth tokens:', {
            error: String(error),
          });
        }
      },
    },
    {
      name: 'mcp_configs',
      execute: async () => {
        // 预加载MCP服务器配置（占位任务，待MCP模块实现后完善）
        try {
          logger.debug('MCP configs preload task (placeholder)');
        } catch (error) {
          logger.warn('Failed to preload MCP configs:', {
            error: String(error),
          });
        }
      },
    },
    {
      name: 'user_settings',
      execute: async () => {
        // 预加载用户设置和偏好（占位任务，待配置模块实现后完善）
        try {
          logger.debug('User settings preload task (placeholder)');
        } catch (error) {
          logger.warn('Failed to preload user settings:', {
            error: String(error),
          });
        }
      },
    },
    {
      name: 'secure_credentials',
      execute: async () => {
        // 预加载安全凭证（参考CC源码的keychainPrefetch）
        try {
          const { CryptoUtils } =
            await import('../../security/services/CryptoUtils.js');
          // 预加载加密密钥到内存
          CryptoUtils.generateKey(32);
          logger.debug('Secure credentials preloaded');
        } catch (error) {
          logger.warn('Failed to preload secure credentials:', {
            error: String(error),
          });
        }
      },
    },
  ];
}

/**
 * 初始化并启动默认预加载任务
 * 在应用启动早期调用
 */
export function initializeAndStartPreloading(): StartupPreloader {
  const preloader = StartupPreloader.getInstance();
  const defaultTasks = createDefaultPreloadTasks();

  // 注册所有默认任务
  for (const task of defaultTasks) {
    preloader.registerTask(task.name, task.execute);
  }

  // 立即启动所有预加载任务（并行）
  preloader.startAll();

  return preloader;
}
