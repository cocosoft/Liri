/**
 * 采样后置Hook管理器
 */

import type {
  PostSamplingHook,
  PostSamplingHookContext,
  PostSamplingHookResult,
  PostSamplingHookConfig,
} from '../types/PostSampling';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('PostSamplingHookManager');

/**
 * 内部Hook项
 */
interface HookItem {
  name: string;
  hook: PostSamplingHook;
  enabled: boolean;
  priority: number;
  timeout?: number;
}

/**
 * 采样后置Hook管理器
 * 负责注册、管理和执行采样后置Hook
 */
export class PostSamplingHookManager {
  /** Hook列表 */
  private hooks: HookItem[] = [];
  /** 是否启用日志 */
  private enableLogging: boolean = false;

  constructor(options?: { enableLogging?: boolean }) {
    this.enableLogging = options?.enableLogging ?? false;
  }

  /**
   * 注册Hook
   * @param name Hook名称
   * @param hook Hook函数
   * @param options Hook选项
   */
  registerHook(
    name: string,
    hook: PostSamplingHook,
    options?: {
      enabled?: boolean;
      priority?: number;
      timeout?: number;
    }
  ): void {
    const existingIndex = this.hooks.findIndex((h) => h.name === name);

    const hookItem: HookItem = {
      name,
      hook,
      enabled: options?.enabled ?? true,
      priority: options?.priority ?? 0,
      timeout: options?.timeout,
    };

    if (existingIndex >= 0) {
      this.hooks[existingIndex] = hookItem;
      this.log(`Replaced hook: ${name}`);
    } else {
      this.hooks.push(hookItem);
      this.log(`Registered hook: ${name}`);
    }

    this.sortHooks();
  }

  /**
   * 使用配置对象注册Hook
   * @param config Hook配置
   */
  registerHookWithConfig(config: PostSamplingHookConfig): void {
    this.registerHook(config.name, config.hook, {
      enabled: config.enabled,
      priority: config.priority,
      timeout: config.timeout,
    });
  }

  /**
   * 注销Hook
   * @param name Hook名称
   * @returns 是否成功注销
   */
  unregisterHook(name: string): boolean {
    const index = this.hooks.findIndex((h) => h.name === name);
    if (index >= 0) {
      this.hooks.splice(index, 1);
      this.log(`Unregistered hook: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 启用Hook
   * @param name Hook名称
   * @returns 是否成功
   */
  enableHook(name: string): boolean {
    const hook = this.hooks.find((h) => h.name === name);
    if (hook) {
      hook.enabled = true;
      this.log(`Enabled hook: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 禁用Hook
   * @param name Hook名称
   * @returns 是否成功
   */
  disableHook(name: string): boolean {
    const hook = this.hooks.find((h) => h.name === name);
    if (hook) {
      hook.enabled = false;
      this.log(`Disabled hook: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 执行所有Hook
   * @param context Hook上下文
   * @returns 执行结果列表
   */
  async executeHooks(
    context: PostSamplingHookContext
  ): Promise<PostSamplingHookResult[]> {
    const results: PostSamplingHookResult[] = [];
    const enabledHooks = this.hooks.filter((h) => h.enabled);

    this.log(`Executing ${enabledHooks.length} hooks`);

    for (const hookItem of enabledHooks) {
      const result = await this.executeSingleHook(hookItem, context);
      results.push(result);
    }

    return results;
  }

  /**
   * 执行单个Hook
   * @param hookItem Hook项
   * @param context Hook上下文
   * @returns 执行结果
   */
  private async executeSingleHook(
    hookItem: HookItem,
    context: PostSamplingHookContext
  ): Promise<PostSamplingHookResult> {
    const startTime = Date.now();

    try {
      if (hookItem.timeout) {
        await this.executeWithTimeout(hookItem.hook, context, hookItem.timeout);
      } else {
        await hookItem.hook(context);
      }

      const duration = Date.now() - startTime;
      this.log(`Hook ${hookItem.name} completed in ${duration}ms`);

      return {
        hookName: hookItem.name,
        success: true,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.log(`Hook ${hookItem.name} failed: ${errorMessage}`);
      void handleError(error, { module: 'hooks:postsampling', action: 'executeSingleHook' });

      return {
        hookName: hookItem.name,
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * 带超时执行Hook
   * @param hook Hook函数
   * @param context Hook上下文
   * @param timeout 超时时间
   */
  private async executeWithTimeout(
    hook: PostSamplingHook,
    context: PostSamplingHookContext,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hook execution timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve(hook(context))
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 按优先级排序Hook
   */
  private sortHooks(): void {
    this.hooks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 清除所有Hook
   */
  clearHooks(): void {
    this.hooks = [];
    this.log('Cleared all hooks');
  }

  /**
   * 获取已注册的Hook名称列表
   * @returns Hook名称列表
   */
  getRegisteredHooks(): string[] {
    return this.hooks.map((h) => h.name);
  }

  /**
   * 获取Hook数量
   * @returns Hook数量
   */
  getHookCount(): number {
    return this.hooks.length;
  }

  /**
   * 获取启用的Hook数量
   * @returns 启用的Hook数量
   */
  getEnabledHookCount(): number {
    return this.hooks.filter((h) => h.enabled).length;
  }

  /**
   * 检查Hook是否存在
   * @param name Hook名称
   * @returns 是否存在
   */
  hasHook(name: string): boolean {
    return this.hooks.some((h) => h.name === name);
  }

  /**
   * 检查Hook是否启用
   * @param name Hook名称
   * @returns 是否启用
   */
  isHookEnabled(name: string): boolean {
    const hook = this.hooks.find((h) => h.name === name);
    return hook?.enabled ?? false;
  }

  /**
   * 输出日志
   * @param message 日志消息
   */
  private log(message: string): void {
    if (this.enableLogging) {
      logger.info(message);
    }
  }
}

/**
 * 创建采样后置Hook管理器实例
 * @param options 选项
 * @returns 管理器实例
 */
export function createPostSamplingHookManager(options?: {
  enableLogging?: boolean;
}): PostSamplingHookManager {
  return new PostSamplingHookManager(options);
}
