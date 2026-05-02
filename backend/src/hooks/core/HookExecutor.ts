/**
 * Hook执行引擎（基于CC源码实现）
 * 支持Hook的并发执行、超时控制、错误处理、性能监控等功能
 */

import type {
  HookDefinition,
  HookContext,
  HookResult,
  HookExecutorConfig,
  HookExecutionStats,
} from '../types';

/**
 * Hook执行器类（基于CC源码实现）
 */
export class HookExecutor {
  private config: HookExecutorConfig;
  private stats: Map<string, HookExecutionStats> = new Map();
  private activeExecutions: Set<string> = new Set();

  constructor(config: HookExecutorConfig = {}) {
    this.config = {
      defaultTimeout: 5000, // 5秒默认超时
      maxConcurrency: 10,   // 最大并发数
      errorHandling: 'continue',
      enablePerformanceMonitoring: true,
      enableSecurityCheck: true,
      enableDiagnosticLogging: false,
      ...config,
    };
  }

  /**
   * 执行Hook（基于CC源码）
   */
  async executeHook(
    hook: HookDefinition,
    context: HookContext
  ): Promise<HookResult> {
    const hookId = this.generateHookId(hook);
    const startTime = Date.now();
    
    // 检查并发限制
    if (this.activeExecutions.size >= this.config.maxConcurrency!) {
      return {
        success: false,
        error: 'Maximum concurrency limit reached',
        exitCode: 1,
      };
    }

    this.activeExecutions.add(hookId);
    
    try {
      // 安全检查
      if (this.config.enableSecurityCheck) {
        const securityCheck = await this.performSecurityCheck(hook, context);
        if (!securityCheck.allowed) {
          return {
            success: false,
            error: `Security check failed: ${securityCheck.reason}`,
            exitCode: 1,
          };
        }
      }

      // 执行Hook
      const result = await this.executeHookWithTimeout(hook, context);
      const durationMs = Date.now() - startTime;

      // 记录执行结果
      this.recordExecutionStats(hookId, result, durationMs);

      return {
        ...result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorResult: HookResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        durationMs,
      };

      this.recordExecutionStats(hookId, errorResult, durationMs);

      // 错误处理策略
      if (hook.errorHandling === 'throw' || this.config.errorHandling === 'throw') {
        throw error;
      }

      return errorResult;
    } finally {
      this.activeExecutions.delete(hookId);
    }
  }

  /**
   * 批量执行Hook（基于CC源码）
   */
  async executeHooks(
    hooks: HookDefinition[],
    context: HookContext
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of hooks) {
      // 检查是否阻止后续执行
      if (results.some(result => result.preventContinuation)) {
        break;
      }

      const result = await this.executeHook(hook, context);
      results.push(result);

      // 检查当前Hook是否阻止后续执行
      if (result.preventContinuation) {
        break;
      }
    }

    return results;
  }

  /**
   * 并发执行Hook（基于CC源码）
   */
  async executeHooksConcurrently(
    hooks: HookDefinition[],
    context: HookContext
  ): Promise<HookResult[]> {
    const executions = hooks.map(hook => this.executeHook(hook, context));
    return Promise.all(executions);
  }

  /**
   * 带超时的Hook执行（基于CC源码）
   */
  private async executeHookWithTimeout(
    hook: HookDefinition,
    context: HookContext
  ): Promise<HookResult> {
    const timeout = hook.timeout || this.config.defaultTimeout!;
    
    if (timeout <= 0) {
      return hook.handler(context);
    }

    const timeoutPromise = new Promise<HookResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Hook execution timeout after ${timeout}ms`));
      }, timeout);
    });

    const executionPromise = hook.handler(context);

    return Promise.race([executionPromise, timeoutPromise]);
  }

  /**
   * 执行安全检查（基于CC源码）
   */
  private async performSecurityCheck(
    hook: HookDefinition,
    context: HookContext
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 检查Hook名称安全性
    if (!this.isSafeHookName(hook.name)) {
      return { allowed: false, reason: 'Invalid hook name' };
    }

    // 检查事件类型安全性
    if (!this.isSafeHookEvent(hook.event)) {
      return { allowed: false, reason: 'Invalid hook event' };
    }

    // 检查上下文数据安全性
    if (context.data && !this.isSafeData(context.data)) {
      return { allowed: false, reason: 'Unsafe context data' };
    }

    return { allowed: true };
  }

  /**
   * 检查Hook名称安全性（基于CC源码）
   */
  private isSafeHookName(name: string): boolean {
    // 只允许字母、数字、连字符、下划线
    const safePattern = /^[a-zA-Z0-9_-]+$/;
    return safePattern.test(name) && name.length <= 100;
  }

  /**
   * 检查Hook事件安全性（基于CC源码）
   */
  private isSafeHookEvent(event: string): boolean {
    // 只允许字母、数字、点、连字符、下划线
    const safePattern = /^[a-zA-Z0-9._-]+$/;
    return safePattern.test(event) && event.length <= 200;
  }

  /**
   * 检查数据安全性（基于CC源码）
   */
  private isSafeData(data: any): boolean {
    try {
      // 检查数据大小（防止内存耗尽）
      const dataSize = JSON.stringify(data).length;
      if (dataSize > 10 * 1024 * 1024) { // 10MB限制
        return false;
      }

      // 检查深度（防止递归攻击）
      if (this.getObjectDepth(data) > 20) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取对象深度（基于CC源码）
   */
  private getObjectDepth(obj: any): number {
    if (typeof obj !== 'object' || obj === null) {
      return 0;
    }

    let maxDepth = 0;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const depth = this.getObjectDepth(obj[key]) + 1;
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    return maxDepth;
  }

  /**
   * 记录执行统计（基于CC源码）
   */
  private recordExecutionStats(
    hookId: string,
    result: HookResult,
    durationMs: number
  ): void {
    if (!this.config.enablePerformanceMonitoring) {
      return;
    }

    const existingStats = this.stats.get(hookId) || {
      hookId,
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      averageDuration: 0,
    };

    existingStats.executionCount++;
    
    if (result.success) {
      existingStats.successCount++;
    } else {
      existingStats.failureCount++;
    }

    // 更新平均执行时间
    existingStats.averageDuration = 
      (existingStats.averageDuration * (existingStats.executionCount - 1) + durationMs) / 
      existingStats.executionCount;

    existingStats.lastExecutedAt = new Date();
    existingStats.lastResult = result;

    this.stats.set(hookId, existingStats);

    // 诊断日志
    if (this.config.enableDiagnosticLogging) {
      console.log(`🔧 Hook executed: ${hookId}`, {
        success: result.success,
        durationMs,
        error: result.error,
      });
    }
  }

  /**
   * 获取执行统计（基于CC源码）
   */
  getExecutionStats(hookId?: string): HookExecutionStats | HookExecutionStats[] {
    if (hookId) {
      return this.stats.get(hookId) || {
        hookId,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        averageDuration: 0,
      };
    }

    return Array.from(this.stats.values());
  }

  /**
   * 清除统计信息（基于CC源码）
   */
  clearStats(): void {
    this.stats.clear();
  }

  /**
   * 获取当前活跃执行数（基于CC源码）
   */
  getActiveExecutionCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * 获取配置信息（基于CC源码）
   */
  getConfig(): HookExecutorConfig {
    return { ...this.config };
  }

  /**
   * 更新配置（基于CC源码）
   */
  updateConfig(newConfig: Partial<HookExecutorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 生成Hook ID（基于CC源码）
   */
  private generateHookId(hook: HookDefinition): string {
    return `${hook.event}:${hook.name}:${hook.version || '1.0.0'}`;
  }
}

/**
 * 全局Hook执行器实例（基于CC源码）
 */
export const globalHookExecutor = new HookExecutor();

export default HookExecutor;