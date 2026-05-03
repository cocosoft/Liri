// @ts-nocheck
/**
 * 提示类型Hook执行器
 * 负责执行提示类型的Hook
 */

import {
  IndividualHookConfig,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';

/**
 * 提示Hook执行器
 */
export class PromptHookExecutor {
  /**
   * 执行提示类型Hook
   * @param hook Hook配置
   * @param context 执行上下文
   * @returns 执行结果
   */
  public async execute(
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): Promise<HookExecutionResult> {
    if (!hook.config.prompt) {
      return {
        success: false,
        error: 'Prompt is required for prompt type hook',
      };
    }

    try {
      // 提示类型Hook直接返回提示内容
      return {
        success: true,
        output: hook.config.prompt,
        hookSpecificOutput: {
          prompt: hook.config.prompt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
