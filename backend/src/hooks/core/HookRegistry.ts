/**
 * Hooks注册和管理系统（基于CC源码实现）
 * 支持Hook的注册、匹配、优先级管理和依赖解析
 */

import type {
  HookDefinition,
  HookEvent,
  HookContext,
  HookResult,
  HookPriority,
  HookDependency,
} from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * Hook注册项接口（基于CC源码）
 */
interface HookRegistration {
  /**
   * Hook定义
   */
  definition: HookDefinition;

  /**
   * 启用状态
   */
  enabled: boolean;

  /**
   * 优先级
   */
  priority: HookPriority;

  /**
   * 依赖关系
   */
  dependencies: HookDependency[];

  /**
   * 注册时间
   */
  registeredAt: Date;

  /**
   * 最后执行时间
   */
  lastExecutedAt?: Date;

  /**
   * 执行次数
   */
  executionCount: number;
}

/**
 * Hook注册器类（基于CC源码实现）
 */
export class HookRegistry {
  private hooks: Map<HookEvent, HookRegistration[]> = new Map();
  private hookIndex: Map<string, HookRegistration> = new Map();
  private executionHistory: Map<string, HookResult[]> = new Map();

  /**
   * 注册Hook（基于CC源码）
   */
  registerHook(definition: HookDefinition): void {
    const hookId = this.generateHookId(definition);

    // 检查是否已注册
    if (this.hookIndex.has(hookId)) {
      throw new AppError(
        `Hook already registered: ${hookId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const registration: HookRegistration = {
      definition,
      enabled: definition.enabled ?? true,
      priority: definition.priority ?? 'normal',
      dependencies: definition.dependencies ?? [],
      registeredAt: new Date(),
      executionCount: 0,
    };

    // 添加到事件映射
    const event = definition.event;
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(registration);

    // 添加到索引
    this.hookIndex.set(hookId, registration);

    // 按优先级排序
    this.sortHooksByPriority(event);

    console.log(`✅ Hook registered: ${hookId}`);
  }

  /**
   * 批量注册Hooks（基于CC源码）
   */
  registerHooks(definitions: HookDefinition[]): void {
    definitions.forEach((definition) => this.registerHook(definition));
  }

  /**
   * 注销Hook（基于CC源码）
   */
  unregisterHook(hookId: string): boolean {
    const registration = this.hookIndex.get(hookId);
    if (!registration) {
      return false;
    }

    const event = registration.definition.event;
    const eventHooks = this.hooks.get(event);

    if (eventHooks) {
      const index = eventHooks.findIndex(
        (h) => this.generateHookId(h.definition) === hookId
      );

      if (index >= 0) {
        eventHooks.splice(index, 1);

        // 如果事件没有Hook了，删除事件映射
        if (eventHooks.length === 0) {
          this.hooks.delete(event);
        }
      }
    }

    this.hookIndex.delete(hookId);
    this.executionHistory.delete(hookId);

    console.log(`✅ Hook unregistered: ${hookId}`);
    return true;
  }

  /**
   * 获取指定事件的Hook（基于CC源码）
   */
  getHooksForEvent(event: HookEvent): HookRegistration[] {
    const hooks = this.hooks.get(event) || [];

    // 过滤启用的Hook
    return hooks.filter((hook) => hook.enabled);
  }

  /**
   * 获取所有Hook（基于CC源码）
   */
  getAllHooks(): HookRegistration[] {
    return Array.from(this.hookIndex.values());
  }

  /**
   * 获取Hook详情（基于CC源码）
   */
  getHook(hookId: string): HookRegistration | undefined {
    return this.hookIndex.get(hookId);
  }

  /**
   * 启用/禁用Hook（基于CC源码）
   */
  setHookEnabled(hookId: string, enabled: boolean): boolean {
    const registration = this.hookIndex.get(hookId);
    if (!registration) {
      return false;
    }

    registration.enabled = enabled;
    console.log(`✅ Hook ${enabled ? 'enabled' : 'disabled'}: ${hookId}`);
    return true;
  }

  /**
   * 设置Hook优先级（基于CC源码）
   */
  setHookPriority(hookId: string, priority: HookPriority): boolean {
    const registration = this.hookIndex.get(hookId);
    if (!registration) {
      return false;
    }

    registration.priority = priority;

    // 重新排序
    this.sortHooksByPriority(registration.definition.event);

    console.log(`✅ Hook priority set: ${hookId} -> ${priority}`);
    return true;
  }

  /**
   * 记录Hook执行结果（基于CC源码）
   */
  recordExecution(hookId: string, result: HookResult): void {
    const registration = this.hookIndex.get(hookId);
    if (!registration) {
      return;
    }

    registration.lastExecutedAt = new Date();
    registration.executionCount++;

    if (!this.executionHistory.has(hookId)) {
      this.executionHistory.set(hookId, []);
    }

    const history = this.executionHistory.get(hookId)!;
    history.push(result);

    // 保持历史记录数量限制
    if (history.length > 100) {
      history.shift();
    }
  }

  /**
   * 获取Hook执行历史（基于CC源码）
   */
  getExecutionHistory(hookId: string): HookResult[] {
    return this.executionHistory.get(hookId) || [];
  }

  /**
   * 检查依赖关系（基于CC源码）
   */
  checkDependencies(hookId: string): { satisfied: boolean; missing: string[] } {
    const registration = this.hookIndex.get(hookId);
    if (!registration) {
      return { satisfied: false, missing: ['Hook not found'] };
    }

    const missing: string[] = [];

    for (const dependency of registration.dependencies) {
      const dependentHook = this.hookIndex.get(dependency.hookId);

      if (!dependentHook) {
        missing.push(`Dependent hook not found: ${dependency.hookId}`);
        continue;
      }

      if (!dependentHook.enabled) {
        missing.push(`Dependent hook disabled: ${dependency.hookId}`);
        continue;
      }

      if (
        dependency.requiredVersion &&
        dependentHook.definition.version !== dependency.requiredVersion
      ) {
        missing.push(`Version mismatch: ${dependency.hookId}`);
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * 清除所有Hook（基于CC源码）
   */
  clearAllHooks(): void {
    this.hooks.clear();
    this.hookIndex.clear();
    this.executionHistory.clear();
    console.log('✅ All hooks cleared');
  }

  /**
   * 清除指定事件的Hook（基于CC源码）
   */
  clearHooksForEvent(event: HookEvent): void {
    const hooks = this.hooks.get(event) || [];

    for (const hook of hooks) {
      const hookId = this.generateHookId(hook.definition);
      this.hookIndex.delete(hookId);
      this.executionHistory.delete(hookId);
    }

    this.hooks.delete(event);
    console.log(`✅ Hooks cleared for event: ${event}`);
  }

  /**
   * 生成Hook ID（基于CC源码）
   */
  private generateHookId(definition: HookDefinition): string {
    return `${definition.event}:${definition.name}:${definition.version || '1.0.0'}`;
  }

  /**
   * 按优先级排序Hook（基于CC源码）
   */
  private sortHooksByPriority(event: HookEvent): void {
    const hooks = this.hooks.get(event);
    if (!hooks) {
      return;
    }

    const priorityOrder: Record<HookPriority, number> = {
      highest: 100,
      high: 75,
      normal: 50,
      low: 25,
      lowest: 0,
    };

    hooks.sort((a, b) => {
      const priorityA = priorityOrder[a.priority] || 50;
      const priorityB = priorityOrder[b.priority] || 50;
      return priorityB - priorityA; // 高优先级在前
    });
  }

  /**
   * 获取统计信息（基于CC源码）
   */
  getStatistics(): {
    totalHooks: number;
    enabledHooks: number;
    events: number;
    totalExecutions: number;
  } {
    const totalHooks = this.hookIndex.size;
    const enabledHooks = Array.from(this.hookIndex.values()).filter(
      (hook) => hook.enabled
    ).length;
    const events = this.hooks.size;
    const totalExecutions = Array.from(this.hookIndex.values()).reduce(
      (sum, hook) => sum + hook.executionCount,
      0
    );

    return {
      totalHooks,
      enabledHooks,
      events,
      totalExecutions,
    };
  }
}

/**
 * 全局Hook注册器实例（基于CC源码）
 */
export const globalHookRegistry = new HookRegistry();

/**
 * 默认Hook注册函数（基于CC源码）
 */
export function registerDefaultHooks(): void {
  console.log('🔧 Registering default hooks...');

  // 注册核心Hook类型
  registerCoreHooks(globalHookRegistry);

  // 注册压缩Hook
  registerCompressionHooks(globalHookRegistry);

  // 注册会话Hook
  registerSessionHooks(globalHookRegistry);

  console.log('✅ Default hooks registered');
}

/**
 * 注册核心Hook（基于CC源码）
 */
function registerCoreHooks(registry: HookRegistry): void {
  // 系统启动Hook
  registry.registerHook({
    name: 'system-startup',
    event: 'system.startup',
    description: '系统启动时执行的Hook',
    version: '1.0.0',
    enabled: true,
    priority: 'highest',
    handler: async (context: HookContext) => ({
      success: true,
      message: 'System startup completed',
    }),
  });

  // 系统关闭Hook
  registry.registerHook({
    name: 'system-shutdown',
    event: 'system.shutdown',
    description: '系统关闭时执行的Hook',
    version: '1.0.0',
    enabled: true,
    priority: 'highest',
    handler: async (context: HookContext) => ({
      success: true,
      message: 'System shutdown completed',
    }),
  });
}

/**
 * 注册压缩Hook（基于CC源码）
 */
function registerCompressionHooks(registry: HookRegistry): void {
  // 预压缩Hook
  registry.registerHook({
    name: 'pre-compression',
    event: 'compression.pre',
    description: '压缩前执行的Hook',
    version: '1.0.0',
    enabled: true,
    priority: 'high',
    handler: async (context: HookContext) => ({
      success: true,
      message: 'Pre-compression hook executed',
    }),
  });

  // 压缩后Hook
  registry.registerHook({
    name: 'post-compression',
    event: 'compression.post',
    description: '压缩后执行的Hook',
    version: '1.0.0',
    enabled: true,
    priority: 'high',
    handler: async (context: HookContext) => ({
      success: true,
      message: 'Post-compression hook executed',
    }),
  });
}

/**
 * 注册会话Hook（基于CC源码）
 */
function registerSessionHooks(registry: HookRegistry): void {
  // 会话开始Hook
  registry.registerHook({
    name: 'session-start',
    event: 'session.start',
    description: '会话开始时执行的Hook',
    version: '1.0.0',
    enabled: true,
    priority: 'high',
    handler: async (context: HookContext) => ({
      success: true,
      message: 'Session start hook executed',
    }),
  });

  // 会话结束Hook
  registry.registerHook({
    name: 'session-end',
    event: 'session.end',
    description: '会话结束时执行的Hook',
    version: '1.0.0',
    enabled: true,
    priority: 'high',
    handler: async (context: HookContext) => ({
      success: true,
      message: 'Session end hook executed',
    }),
  });
}

export default globalHookRegistry;
