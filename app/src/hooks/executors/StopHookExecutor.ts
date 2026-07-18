/**
 * StopHook执行器
 * 负责执行停止Hook并处理执行结果
 *
 * 参考CC源码实现: cc_code/backend/query/stopHooks.ts
 */

import type { Message } from '@modules/chat/types/message.js';
import type { ToolUseContext } from '@modules/tools/types/ToolUseContext.js';
import { HookExecutor } from './HookExecutor.js';
import type {
  IndividualHookConfig,
  HookExecutionResult,
} from '../types/index.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'hooks:executors:StopHookExecutor', level: LogLevel.INFO });

/**
 * StopHook信息
 */
export interface StopHookInfo {
  hookId: string;
  hookName: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  preventedContinuation: boolean;
  blockingErrors: Message[];
}

/**
 * StopHook执行结果
 */
export interface StopHookExecutionResult {
  hookInfos: StopHookInfo[];
  hookErrors: string[];
  preventedContinuation: boolean;
  stopReason?: string;
  hasOutput: boolean;
  totalDurationMs: number;
}

/**
 * StopHook上下文
 */
export interface StopHookContext {
  messages: Message[];
  systemPrompt: string;
  userContext: Record<string, string>;
  systemContext: Record<string, string>;
  toolUseContext: ToolUseContext;
  querySource: string;
  stopHookActive?: boolean;
}

/**
 * StopHook执行器类
 */
export class StopHookExecutor {
  private hookExecutor: HookExecutor;
  private activeHooks: Map<
    string,
    { startTime: number; config: IndividualHookConfig }
  > = new Map();

  constructor(hookExecutor?: HookExecutor) {
    this.hookExecutor = hookExecutor || new HookExecutor();
  }

  /**
   * 执行停止Hook
   * @param context 停止Hook上下文
   * @param hooks 需要执行的Hook配置列表
   * @returns 停止Hook执行结果
   */
  async executeStopHooks(
    context: StopHookContext,
    hooks: IndividualHookConfig[]
  ): Promise<StopHookExecutionResult> {
    const hookInfos: StopHookInfo[] = [];
    const hookErrors: string[] = [];
    let preventedContinuation = false;
    let hasOutput = false;
    const startTime = Date.now();

    for (const hook of hooks) {
      const hookId = `stop-hook-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      this.activeHooks.set(hookId, {
        startTime: Date.now(),
        config: hook,
      });

      try {
        const result = await this.executeHook(hook, context);
        const durationMs =
          Date.now() - (this.activeHooks.get(hookId)?.startTime || Date.now());

        const hookName = String(hook.matcher || hook.config.type || 'unknown');

        const hookInfo: StopHookInfo = {
          hookId,
          hookName,
          success: result.success,
          output: result.output as string | undefined,
          error: result.error,
          durationMs,
          preventedContinuation:
            result.success && this.shouldPreventContinuation(result),
          blockingErrors: result.success
            ? []
            : [this.createErrorMessage(result.error || 'Unknown error')],
        };

        hookInfos.push(hookInfo);
        hasOutput = hasOutput || !!result.output;

        if (hookInfo.preventedContinuation) {
          preventedContinuation = true;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        hookErrors.push(errorMessage);

        hookInfos.push({
          hookId,
          hookName: String(hook.matcher || hook.config.type || 'unknown'),
          success: false,
          error: errorMessage,
          durationMs:
            Date.now() -
            (this.activeHooks.get(hookId)?.startTime || Date.now()),
          preventedContinuation: false,
          blockingErrors: [this.createErrorMessage(errorMessage)],
        });
      } finally {
        this.activeHooks.delete(hookId);
      }
    }

    return {
      hookInfos,
      hookErrors,
      preventedContinuation,
      stopReason: preventedContinuation
        ? 'Hook prevented continuation'
        : undefined,
      hasOutput,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * 执行单个Hook
   * @param hook Hook配置
   * @param context 执行上下文
   * @returns Hook执行结果
   */
  private async executeHook(
    hook: IndividualHookConfig,
    context: StopHookContext
  ): Promise<HookExecutionResult> {
    const hookContext = {
      event: 'Stop' as const,
      matcher: hook.matcher,
      data: {
        messages: context.messages,
        systemPrompt: context.systemPrompt,
        userContext: context.userContext,
        systemContext: context.systemContext,
      },
      toolNames:
        context.toolUseContext.options?.tools?.map((t) => t.name) || [],
    };

    return await this.hookExecutor.execute(hook, hookContext as any);
  }

  /**
   * 判断Hook是否应该阻止继续
   * @param result Hook执行结果
   * @returns 是否阻止继续
   */
  private shouldPreventContinuation(result: HookExecutionResult): boolean {
    if (!result.success) {
      return false;
    }

    if (result.output) {
      try {
        const output = JSON.parse(result.output as string);
        return output.preventContinuation === true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * 创建错误消息
   * @param error 错误信息
   * @returns 错误消息
   */
  private createErrorMessage(error: string): Message {
    return {
      id: `error-${Date.now()}`,
      role: 'system' as any,
      content: `[StopHook Error]: ${error}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Message;
  }

  /**
   * 获取活跃的Hook
   * @returns 活跃Hook ID列表
   */
  getActiveHooks(): string[] {
    return Array.from(this.activeHooks.keys());
  }

  /**
   * 取消指定的Hook
   * @param hookId Hook ID
   * @returns 是否成功取消
   */
  cancelHook(hookId: string): boolean {
    const hook = this.activeHooks.get(hookId);
    if (!hook) {
      return false;
    }

    this.activeHooks.delete(hookId);
    return true;
  }

  /**
   * 取消所有活跃的Hook
   */
  cancelAllHooks(): void {
    this.activeHooks.clear();
  }

  /**
   * 检查是否有活跃的Hook
   * @returns 是否有活跃Hook
   */
  hasActiveHooks(): boolean {
    return this.activeHooks.size > 0;
  }
}

/**
 * 创建StopHookExecutor实例
 * @returns StopHookExecutor实例
 */
export function createStopHookExecutor(): StopHookExecutor {
  return new StopHookExecutor();
}

export default StopHookExecutor;
