/**
 * Hook管理器
 * 负责Hook的注册、匹配和执行
 */

import {
  IndividualHookConfig,
  HookEvent,
  HookExecutionContext,
  HookExecutionResult,
} from './types';
import { HookExecutor } from './executors/HookExecutor';

/**
 * Hook管理器类
 */
export class HookManager {
  private hooks: Map<HookEvent, IndividualHookConfig[]> = new Map();
  private executor: HookExecutor;

  constructor() {
    this.executor = new HookExecutor();
  }

  /**
   * 注册一个Hook
   * @param hook Hook配置
   */
  public registerHook(hook: IndividualHookConfig): void {
    if (!this.hooks.has(hook.event)) {
      this.hooks.set(hook.event, []);
    }
    this.hooks.get(hook.event)!.push(hook);

    // 按优先级排序（如果有优先级）
    this.hooks.get(hook.event)!.sort((a, b) => {
      const prioA = a.config.priority || 0;
      const prioB = b.config.priority || 0;
      return prioB - prioA; // 高优先级在前
    });
  }

  /**
   * 批量注册Hooks
   * @param hooks Hook配置列表
   */
  public registerHooks(hooks: IndividualHookConfig[]): void {
    hooks.forEach((hook) => this.registerHook(hook));
  }

  /**
   * 获取指定事件类型的所有Hooks
   * @param event Hook事件类型
   * @returns Hook配置列表
   */
  public getHooksForEvent(event: HookEvent): IndividualHookConfig[] {
    return this.hooks.get(event) || [];
  }

  /**
   * 匹配符合条件的Hooks
   * @param event Hook事件类型
   * @param context 执行上下文
   * @returns 匹配的Hook配置列表
   */
  public matchHooks(
    event: HookEvent,
    context: HookExecutionContext
  ): IndividualHookConfig[] {
    const hooks = this.getHooksForEvent(event);

    // 如果没有匹配器，返回所有
    if (!context.matcher) {
      return hooks.filter((hook) => !hook.matcher);
    }

    // 匹配带有匹配器的Hooks
    return hooks.filter((hook) => {
      if (!hook.matcher) return false;

      // 支持通配符匹配
      return this.matchPattern(hook.matcher, context.matcher);
    });
  }

  /**
   * 执行指定事件的所有Hooks
   * @param event Hook事件类型
   * @param context 执行上下文
   * @returns 执行结果列表
   */
  public async executeHooks(
    event: HookEvent,
    context: HookExecutionContext
  ): Promise<HookExecutionResult[]> {
    const hooks = this.matchHooks(event, context);
    const results: HookExecutionResult[] = [];

    for (const hook of hooks) {
      // 检查是否启用
      if (hook.config.enabled === false) continue;

      // 执行Hook
      const result = await this.executor.execute(hook, context);
      results.push(result);

      // 如果有Hook要求停止，就不再继续执行后面的
      if (result.continue === false) {
        break;
      }
    }

    return results;
  }

  /**
   * 聚合Hook执行结果
   * @param results Hook执行结果列表
   * @returns 聚合后的结果
   */
  public aggregateResults(results: HookExecutionResult[]): HookExecutionResult {
    const aggregated: HookExecutionResult = {
      success: results.every((r) => r.success),
      additionalContexts: [],
    };

    for (const result of results) {
      // 合并错误信息
      if (!result.success) {
        aggregated.error =
          (aggregated.error ? aggregated.error + '\n' : '') +
          (result.error || '');
      }

      // 合并输出
      if (result.output) {
        aggregated.output =
          (aggregated.output ? aggregated.output + '\n' : '') + result.output;
      }

      // 合并附加的上下文
      if (result.additionalContext) {
        if (!aggregated.additionalContexts) {
          aggregated.additionalContexts = [];
        }
        aggregated.additionalContexts.push(result.additionalContext);
      }

      // 如果有Hook要求停止，就设置标志
      if (result.continue === false) {
        aggregated.continue = false;
        if (result.stopReason) {
          aggregated.stopReason = result.stopReason;
        }
      }

      // 处理权限决定
      if (result.permissionBehavior) {
        aggregated.permissionBehavior = result.permissionBehavior;
      }
      if (result.hookPermissionDecisionReason) {
        aggregated.hookPermissionDecisionReason =
          result.hookPermissionDecisionReason;
      }

      // 处理更新的输入
      if (result.updatedInput) {
        aggregated.updatedInput = result.updatedInput;
      }

      // 处理系统消息
      if (result.systemMessage) {
        aggregated.systemMessage = result.systemMessage;
      }

      // 处理监视路径
      if (result.watchPaths) {
        if (!aggregated.watchPaths) {
          aggregated.watchPaths = [];
        }
        aggregated.watchPaths.push(...result.watchPaths);
      }

      // 处理重试标志
      if (result.retry) {
        aggregated.retry = true;
      }
    }

    // 如果有多个附加上下文，合并它们
    if (
      aggregated.additionalContexts &&
      aggregated.additionalContexts.length > 0
    ) {
      aggregated.additionalContext = aggregated.additionalContexts.join('\n\n');
    }

    return aggregated;
  }

  /**
   * 清除所有注册的Hooks
   */
  public clearHooks(): void {
    this.hooks.clear();
  }

  /**
   * 模式匹配（支持通配符）
   * @param pattern 模式
   * @param value 值
   * @returns 是否匹配
   */
  private matchPattern(pattern: string, value: string): boolean {
    // 转换为正则表达式
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }
}

// 导出单例实例
export const hookManager = new HookManager();
