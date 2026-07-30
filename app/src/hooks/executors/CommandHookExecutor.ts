//
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

import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'hooks:executors:CommandHookExecutor',
  level: LogLevel.INFO,
});

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
    const config = hook.config as Record<string, unknown>;

    if (!config.command) {
      return {
        success: false,
        error: 'Command is required for command type hook',
      };
    }

    try {
      // 准备命令输入
      const input = JSON.stringify(context.data);
      const command = config.command as string;
      const timeout = (config.timeout as number) || 30;

      // 设置环境变量
      const env = {
        ...process.env,
        HOOK_EVENT: context.event,
        HOOK_MATCHER: context.matcher || '',
        HOOK_INPUT: input,
      };

      // 执行命令
      const { stdout, stderr } = await execPromise(command, {
        env,
        timeout: timeout * 1000, // 转换为毫秒
        shell: true as unknown as string,
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
      } catch (err) {
        // 不是有效的JSON，保持原样

        handleError(err, {
          module: 'hooks:executors',
          action: 'parseCommandOutput',
        });
      }

      return result;
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      return {
        success: false,
        output: (err.stdout as string)?.trim(),
        error: (err.stderr as string)?.trim() || (err.message as string),
        exitCode: (err.code as number) || 1,
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
    json: unknown,
    result: HookExecutionResult
  ): HookExecutionResult {
    const j = json as Record<string, unknown>;
    const processed: HookExecutionResult = {
      ...result,
      success: true,
      hookSpecificOutput: j,
    };

    // 处理通用字段
    if (j.continue !== undefined) processed.continue = j.continue as boolean;
    if (j.suppressOutput !== undefined)
      processed.suppressOutput = j.suppressOutput as boolean;
    if (j.stopReason !== undefined)
      processed.stopReason = j.stopReason as string;
    if (j.decision !== undefined) processed.decision = j.decision as string;
    if (j.systemMessage !== undefined)
      processed.systemMessage = j.systemMessage as string;

    // 处理hookSpecificOutput中的字段
    if (j.hookSpecificOutput) {
      const hso = j.hookSpecificOutput as Record<string, unknown>;
      if (hso.additionalContext !== undefined)
        processed.additionalContext = hso.additionalContext as string;
      if (hso.updatedInput !== undefined)
        processed.updatedInput = hso.updatedInput as Record<string, unknown>;
      if (hso.updatedMCPToolOutput !== undefined)
        processed.updatedMCPToolOutput = hso.updatedMCPToolOutput as Record<
          string,
          unknown
        >;
      if (hso.initialUserMessage !== undefined)
        processed.initialUserMessage = hso.initialUserMessage as string;
      if (hso.watchPaths !== undefined)
        processed.watchPaths = hso.watchPaths as string[];
      if (hso.retry !== undefined) processed.retry = hso.retry as boolean;

      // 处理权限决定
      if (hso.permissionDecision !== undefined) {
        processed.permissionBehavior = hso.permissionDecision as
          | 'allow'
          | 'deny'
          | 'ask';
      }
      if (hso.permissionDecisionReason !== undefined) {
        processed.hookPermissionDecisionReason =
          hso.permissionDecisionReason as string;
      }
    }

    return processed;
  }
}
