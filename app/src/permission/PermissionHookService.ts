/**
 * 权限钩子服务
 * 负责管理和执行权限请求钩子
 */

import {
  PermissionHook,
  PermissionHookContext,
  PermissionHookDecision,
  RegisteredPermissionHook,
  PermissionHookMetadata,
} from './types/PermissionHook';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 权限钩子服务类
 */
export class PermissionHookService {
  private static instance: PermissionHookService;
  private hooks: Map<string, RegisteredPermissionHook> = new Map();

  /**
   * 获取单例实例
   */
  public static getInstance(): PermissionHookService {
    if (!PermissionHookService.instance) {
      PermissionHookService.instance = new PermissionHookService();
    }
    return PermissionHookService.instance;
  }

  /**
   * 构造函数
   */
  private constructor() {
    // 初始化时可以注册一些内置钩子
  }

  /**
   * 注册权限钩子
   * @param metadata 钩子元数据
   * @param hook 钩子函数
   */
  registerHook(metadata: PermissionHookMetadata, hook: PermissionHook): void {
    const { name } = metadata;

    if (this.hooks.has(name)) {
      logger.warn(`Permission hook '${name}' already exists, overwriting`);
    }

    this.hooks.set(name, {
      metadata: {
        ...metadata,
        enabled: metadata.enabled !== false, // 默认启用
        priority: metadata.priority || 100,
      },
      hook,
    });

    logger.info(`Registered permission hook: ${name}`);
  }

  /**
   * 注销权限钩子
   * @param name 钩子名称
   */
  unregisterHook(name: string): void {
    if (this.hooks.has(name)) {
      this.hooks.delete(name);
      logger.info(`Unregistered permission hook: ${name}`);
    } else {
      logger.warn(`Permission hook '${name}' not found for unregistration`);
    }
  }

  /**
   * 获取所有注册的钩子
   */
  getAllHooks(): RegisteredPermissionHook[] {
    return Array.from(this.hooks.values());
  }

  /**
   * 获取启用的钩子，按优先级排序
   */
  private getEnabledHooks(): RegisteredPermissionHook[] {
    return this.getAllHooks()
      .filter((h) => h.metadata.enabled)
      .sort(
        (a, b) => (a.metadata.priority || 100) - (b.metadata.priority || 100)
      );
  }

  /**
   * 执行权限钩子
   * @param context 钩子上下文
   * @returns 权限决策或null
   */
  async executeHooks(
    context: PermissionHookContext
  ): Promise<PermissionHookDecision | null> {
    const hooks = this.getEnabledHooks();

    if (hooks.length === 0) {
      logger.debug('No permission hooks registered or enabled');
      return null;
    }

    logger.debug(
      `Executing ${hooks.length} permission hooks for tool: ${context.toolName}`
    );

    for (const registeredHook of hooks) {
      try {
        // 检查是否被中止
        if (context.abortSignal?.aborted) {
          logger.debug(`Hook execution aborted for tool: ${context.toolName}`);
          return null;
        }

        const { metadata, hook } = registeredHook;
        logger.debug(`Executing permission hook: ${metadata.name}`);

        const decision = await hook({
          ...context,
        });

        if (decision && decision.behavior !== 'passthrough') {
          logger.info(
            `Permission hook '${metadata.name}' made decision: ${decision.behavior}`
          );
          return decision;
        }
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        logger.error(
          `Error executing permission hook '${registeredHook.metadata.name}':`,
          e
        );
        // 钩子出错时继续执行其他钩子，而不是中断
      }
    }

    // 没有钩子做出决策
    return null;
  }

  /**
   * 启用钩子
   * @param name 钩子名称
   */
  enableHook(name: string): void {
    const hook = this.hooks.get(name);
    if (hook) {
      hook.metadata.enabled = true;
      logger.info(`Enabled permission hook: ${name}`);
    } else {
      logger.warn(`Permission hook '${name}' not found for enabling`);
    }
  }

  /**
   * 禁用钩子
   * @param name 钩子名称
   */
  disableHook(name: string): void {
    const hook = this.hooks.get(name);
    if (hook) {
      hook.metadata.enabled = false;
      logger.info(`Disabled permission hook: ${name}`);
    } else {
      logger.warn(`Permission hook '${name}' not found for disabling`);
    }
  }

  /**
   * 检查钩子是否存在
   * @param name 钩子名称
   */
  hasHook(name: string): boolean {
    return this.hooks.has(name);
  }

  /**
   * 清空所有钩子
   */
  clearHooks(): void {
    this.hooks.clear();
    logger.info('Cleared all permission hooks');
  }
}

/**
 * 创建权限钩子服务实例
 */
export function createPermissionHookService(): PermissionHookService {
  return PermissionHookService.getInstance();
}

/**
 * 导出单例
 */
export const permissionHookService = PermissionHookService.getInstance();
