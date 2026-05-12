/**
 * Hook管理器
 * 负责Hook的注册、匹配和执行
 * 统一委托给 managers/HookManager 单例
 */

import { IndividualHookConfig, HookEvent, HookExecutionContext, HookExecutionResult } from './types';
import { HookExecutor } from './executors/HookExecutor';
import { HookManager as ManagerHookManager } from './managers/HookManager';

/**
 * Hook管理器类
 */
export class HookManager {
  private executor: HookExecutor;
  private managerInstance: ManagerHookManager;

  constructor() {
    this.executor = new HookExecutor();
    this.managerInstance = ManagerHookManager.getInstance();
  }

  /**
   * 注册一个Hook
   * @param hook Hook配置
   */
  public registerHook(hook: IndividualHookConfig): void {
    this.managerInstance.registerHook(hook);
  }

  /**
   * 批量注册Hooks
   * @param hooks Hook配置列表
   */
  public registerHooks(hooks: IndividualHookConfig[]): void {
    this.managerInstance.registerHooks(hooks);
  }

  /**
   * 获取指定事件类型的所有Hooks
   * @param event Hook事件类型
   * @returns Hook配置列表
   */
  public getHooksForEvent(event: HookEvent): IndividualHookConfig[] {
    return this.managerInstance.getHooksByEvent(event) as IndividualHookConfig[];
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

    if (!context.matcher) {
      return hooks.filter((hook) => !hook.matcher);
    }

    return hooks.filter((hook) => {
      if (!hook.matcher) return false;
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
      if (hook.config.enabled === false) continue;

      const result = await this.executor.execute(hook, context);
      results.push(result);

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
      if (!result.success) {
        aggregated.error =
          (aggregated.error ? aggregated.error + '\n' : '') +
          (result.error || '');
      }

      if (result.output) {
        aggregated.output =
          (aggregated.output ? aggregated.output + '\n' : '') + result.output;
      }

      if (result.additionalContext) {
        if (!aggregated.additionalContexts) {
          aggregated.additionalContexts = [];
        }
        aggregated.additionalContexts.push(result.additionalContext);
      }

      if (result.continue === false) {
        aggregated.continue = false;
        if (result.stopReason) {
          aggregated.stopReason = result.stopReason;
        }
      }

      if (result.permissionBehavior) {
        aggregated.permissionBehavior = result.permissionBehavior;
      }
      if (result.hookPermissionDecisionReason) {
        aggregated.hookPermissionDecisionReason =
          result.hookPermissionDecisionReason;
      }

      if (result.updatedInput) {
        aggregated.updatedInput = result.updatedInput;
      }

      if (result.systemMessage) {
        aggregated.systemMessage = result.systemMessage;
      }

      if (result.watchPaths) {
        if (!aggregated.watchPaths) {
          aggregated.watchPaths = [];
        }
        aggregated.watchPaths.push(...result.watchPaths);
      }

      if (result.retry) {
        aggregated.retry = true;
      }
    }

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
    this.managerInstance.clearHooks();
  }

  /**
   * 模式匹配（支持通配符）
   * @param pattern 模式
   * @param value 值
   * @returns 是否匹配
   */
  private matchPattern(pattern: string, value: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(value);
  }
}

export const hookManager = new HookManager();
