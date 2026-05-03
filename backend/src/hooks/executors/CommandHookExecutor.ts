// @ts-nocheck
/**
 * 命令类型Hook执行器
 * 负责执行命令类型的Hook
 */

import {
  IndividualHookConfig,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * 命令Hook执行器
 */
export class CommandHookExecutor {
  /**
   * 执行命令类型Hook
   * @param hook Hook配置
   * @param context 执行上下文
   * @returns 执行结果
   */
  public async execute(
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): Promise<HookExecutionResult> {
    if (!hook.config.command) {
      return {
        success: false,
        error: 'Command is required for command type hook',
      };
    }

    try {
      // 准备命令输入
      const input = JSON.stringify(context.data);

      // 设置环境变量
      const env = {
        ...process.env,
        HOOK_EVENT: context.event,
        HOOK_MATCHER: context.matcher || '',
        HOOK_INPUT: input,
      };

      // 执行命令
      const { stdout, stderr } = await execPromise(hook.config.command, {
        env,
        timeout: (hook.config.timeout || 30) * 1000, // 转换为毫秒
        shell: true as any,
      });

      // 解析JSON输出并构建结果
      let result: HookExecutionResult = {
        success: true,
        output: stdout.trim(),
        error: stderr.trim(),
        exitCode: 0,
      };

      try {
        const parsed = JSON.parse(stdout.trim());
        result = this.processHookJsonOutput(parsed, result);
      } catch {
        // 不是有效的JSON，保持原样
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout?.trim(),
        error: error.stderr?.trim() || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  /**
   * 处理Hook JSON输出
   * @param json 解析后的JSON对象
   * @param result 当前结果对象
   * @returns 处理后的结果
   */
  private processHookJsonOutput(
    json: any,
    result: HookExecutionResult
  ): HookExecutionResult {
    const processed = { ...result, hookSpecificOutput: json };

    // 处理通用字段
    if (json.continue !== undefined) processed.continue = json.continue;
    if (json.suppressOutput !== undefined)
      processed.suppressOutput = json.suppressOutput;
    if (json.stopReason !== undefined) processed.stopReason = json.stopReason;
    if (json.decision !== undefined) processed.decision = json.decision;
    if (json.systemMessage !== undefined)
      processed.systemMessage = json.systemMessage;

    // 处理hookSpecificOutput中的字段
    if (json.hookSpecificOutput) {
      const hso = json.hookSpecificOutput;
      if (hso.additionalContext !== undefined)
        processed.additionalContext = hso.additionalContext;
      if (hso.updatedInput !== undefined)
        processed.updatedInput = hso.updatedInput;
      if (hso.updatedMCPToolOutput !== undefined)
        processed.updatedMCPToolOutput = hso.updatedMCPToolOutput;
      if (hso.initialUserMessage !== undefined)
        processed.initialUserMessage = hso.initialUserMessage;
      if (hso.watchPaths !== undefined) processed.watchPaths = hso.watchPaths;
      if (hso.retry !== undefined) processed.retry = hso.retry;

      // 处理权限决定
      if (hso.permissionDecision !== undefined) {
        processed.permissionBehavior = hso.permissionDecision;
      }
      if (hso.permissionDecisionReason !== undefined) {
        processed.hookPermissionDecisionReason = hso.permissionDecisionReason;
      }
    }

    return processed;
  }
}
