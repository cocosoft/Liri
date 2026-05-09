/**
 * 工具Hook管理器
 * 负责工具Hook的注册、管理和执行
 */
import {
  ToolHookContext,
  ToolHookResult,
  ToolHookExecutionOptions,
  PreToolUseHookYield,
  PostToolUseHookYield,
  createToolHookSuccessResult,
  createToolHookBlockingResult,
  createToolHookCancelledResult,
} from '../types/ToolHooks';
import { PermissionBehavior } from '@modules/permission/types/PermissionRule';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { HookManager } from './HookManager';
import { HookEvent } from '../types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 工具Hook管理器
 */
export class ToolHookManager {
  private static instance: ToolHookManager;
  private hookManager: HookManager;
  private preToolUseHooks: Map<string, any[]> = new Map();
  private postToolUseHooks: Map<string, any[]> = new Map();
  private postToolUseFailureHooks: Map<string, any[]> = new Map();

  private constructor() {
    this.hookManager = HookManager.getInstance();
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): ToolHookManager {
    if (!ToolHookManager.instance) {
      ToolHookManager.instance = new ToolHookManager();
    }
    return ToolHookManager.instance;
  }

  /**
   * 注册PreToolUse Hook
   * @param toolName 工具名称
   * @param hook Hook配置
   */
  public registerPreToolUseHook(toolName: string, hook: any): void {
    if (!this.preToolUseHooks.has(toolName)) {
      this.preToolUseHooks.set(toolName, []);
    }
    this.preToolUseHooks.get(toolName)!.push(hook);
  }

  /**
   * 注册PostToolUse Hook
   * @param toolName 工具名称
   * @param hook Hook配置
   */
  public registerPostToolUseHook(toolName: string, hook: any): void {
    if (!this.postToolUseHooks.has(toolName)) {
      this.postToolUseHooks.set(toolName, []);
    }
    this.postToolUseHooks.get(toolName)!.push(hook);
  }

  /**
   * 注册PostToolUseFailure Hook
   * @param toolName 工具名称
   * @param hook Hook配置
   */
  public registerPostToolUseFailureHook(toolName: string, hook: any): void {
    if (!this.postToolUseFailureHooks.has(toolName)) {
      this.postToolUseFailureHooks.set(toolName, []);
    }
    this.postToolUseFailureHooks.get(toolName)!.push(hook);
  }

  /**
   * 执行PreToolUse Hooks
   * @param context 工具Hook上下文
   * @param options 执行选项
   * @returns AsyncGenerator产生PreToolUseHookYield
   */
  public async *executePreToolUseHooks(
    context: ToolHookContext,
    options: ToolHookExecutionOptions = {}
  ): AsyncGenerator<PreToolUseHookYield> {
    const hooks = this.preToolUseHooks.get(context.toolName) || [];
    const toolUseID = context.toolUseID;

    for (const hook of hooks) {
      if (context.abortSignal?.aborted) {
        yield { type: 'stop' };
        return;
      }

      try {
        const result = await this.executeHook(hook, context, options);

        if (result.outcome === 'cancelled') {
          yield { type: 'stop' };
          return;
        }

        if (result.blockingError) {
          yield {
            type: 'hookPermissionResult',
            permissionBehavior: PermissionBehavior.DENY,
            reason: result.blockingError.blockingError,
          };
        }

        if (result.preventContinuation) {
          yield {
            type: 'preventContinuation',
            shouldPreventContinuation: true,
          };
          if (result.stopReason) {
            yield { type: 'stopReason', stopReason: result.stopReason };
          }
        }

        if (result.permissionBehavior) {
          yield {
            type: 'hookPermissionResult',
            permissionBehavior: result.permissionBehavior,
            updatedInput: result.updatedInput,
            reason: result.hookPermissionDecisionReason,
          };
        }

        if (result.updatedInput && !result.permissionBehavior) {
          yield { type: 'hookUpdatedInput', updatedInput: result.updatedInput };
        }

        if (result.additionalContext) {
          yield {
            type: 'additionalContext',
            context: result.additionalContext,
          };
        }
      } catch (error) {
        logger.error(
          `Error executing PreToolUse hook for ${context.toolName}:`,
          { error }
        );
      }
    }
  }

  /**
   * 执行PostToolUse Hooks
   * @param context 工具Hook上下文
   * @param options 执行选项
   * @returns AsyncGenerator产生PostToolUseHookYield
   */
  public async *executePostToolUseHooks(
    context: ToolHookContext,
    options: ToolHookExecutionOptions = {}
  ): AsyncGenerator<PostToolUseHookYield> {
    const hooks = this.postToolUseHooks.get(context.toolName) || [];

    for (const hook of hooks) {
      if (context.abortSignal?.aborted) {
        return;
      }

      try {
        const result = await this.executeHook(hook, context, options);

        if (result.outcome === 'cancelled') {
          return;
        }

        if (result.message) {
          yield { type: 'message', message: result.message };
        }

        if (result.blockingError) {
          yield { type: 'blockingError', error: result.blockingError };
        }

        if (result.preventContinuation) {
          yield {
            type: 'preventContinuation',
            shouldPreventContinuation: true,
          };
        }

        if (result.additionalContext) {
          yield {
            type: 'additionalContext',
            context: result.additionalContext,
          };
        }

        if (result.updatedToolOutput) {
          yield { type: 'updatedToolOutput', output: result.updatedToolOutput };
        }
      } catch (error) {
        logger.error(
          `Error executing PostToolUse hook for ${context.toolName}:`,
          { error }
        );
      }
    }
  }

  /**
   * 执行PostToolUseFailure Hooks
   * @param context 工具Hook上下文
   * @param options 执行选项
   * @returns AsyncGenerator产生PostToolUseHookYield
   */
  public async *executePostToolUseFailureHooks(
    context: ToolHookContext,
    options: ToolHookExecutionOptions = {}
  ): AsyncGenerator<PostToolUseHookYield> {
    const hooks = this.postToolUseFailureHooks.get(context.toolName) || [];

    for (const hook of hooks) {
      if (context.abortSignal?.aborted) {
        return;
      }

      try {
        const result = await this.executeHook(hook, context, options);

        if (result.outcome === 'cancelled') {
          return;
        }

        if (result.message) {
          yield { type: 'message', message: result.message };
        }

        if (result.blockingError) {
          yield { type: 'blockingError', error: result.blockingError };
        }

        if (result.preventContinuation) {
          yield {
            type: 'preventContinuation',
            shouldPreventContinuation: true,
          };
        }

        if (result.additionalContext) {
          yield {
            type: 'additionalContext',
            context: result.additionalContext,
          };
        }
      } catch (error) {
        logger.error(
          `Error executing PostToolUseFailure hook for ${context.toolName}:`,
          { error }
        );
      }
    }
  }

  /**
   * 执行单个Hook
   * @param hook Hook配置
   * @param context 工具Hook上下文
   * @param options 执行选项
   * @returns Hook执行结果
   */
  private async executeHook(
    hook: any,
    context: ToolHookContext,
    options: ToolHookExecutionOptions
  ): Promise<ToolHookResult> {
    try {
      if (hook.callback && typeof hook.callback === 'function') {
        return await hook.callback(context, options);
      }

      if (hook.command && typeof hook.command === 'string') {
        return await this.executeCommandHook(hook.command, context, options);
      }

      return createToolHookSuccessResult();
    } catch (error) {
      return {
        outcome: 'non_blocking_error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 执行命令型Hook
   * @param command 命令
   * @param context 工具Hook上下文
   * @param options 执行选项
   * @returns Hook执行结果
   */
  private async executeCommandHook(
    command: string,
    context: ToolHookContext,
    options: ToolHookExecutionOptions
  ): Promise<ToolHookResult> {
    const timeoutMs = options.timeoutMs || 60000;

    return new Promise<ToolHookResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(createToolHookCancelledResult());
      }, timeoutMs);

      try {
        const { spawn } = require('child_process');
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'cmd.exe' : '/bin/sh';
        const shellArgs = isWindows ? ['/c', command] : ['-c', command];

        const proc = spawn(shell, shellArgs, {
          cwd: process.cwd(),
          env: { ...process.env, ...this.buildHookEnv(context) },
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
          clearTimeout(timeout);
          resolve({
            outcome:
              code === 0
                ? 'success'
                : code === 2
                  ? 'blocking'
                  : 'non_blocking_error',
            output: stdout + stderr,
            exitCode: code ?? undefined,
          });
        });

        proc.on('error', (error: Error) => {
          clearTimeout(timeout);
          resolve({
            outcome: 'non_blocking_error',
            error: error.message,
          });
        });
      } catch (error) {
        clearTimeout(timeout);
        resolve({
          outcome: 'non_blocking_error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * 构建Hook环境变量
   * @param context 工具Hook上下文
   * @returns 环境变量对象
   */
  private buildHookEnv(context: ToolHookContext): Record<string, string> {
    return {
      TOOL_NAME: context.toolName,
      TOOL_USE_ID: context.toolUseID,
      TOOL_INPUT: JSON.stringify(context.input),
      TOOL_OUTPUT: context.output ? JSON.stringify(context.output) : '',
      TOOL_ERROR: context.error || '',
      PERMISSION_MODE: context.permissionMode,
    };
  }

  /**
   * 移除指定工具的所有Hooks
   * @param toolName 工具名称
   */
  public removeHooksForTool(toolName: string): void {
    this.preToolUseHooks.delete(toolName);
    this.postToolUseHooks.delete(toolName);
    this.postToolUseFailureHooks.delete(toolName);
  }

  /**
   * 清空所有Hooks
   */
  public clearAllHooks(): void {
    this.preToolUseHooks.clear();
    this.postToolUseHooks.clear();
    this.postToolUseFailureHooks.clear();
  }

  /**
   * 获取已注册的Hook数量
   * @returns Hook数量统计
   */
  public getHookStats(): {
    preToolUse: number;
    postToolUse: number;
    postToolUseFailure: number;
  } {
    return {
      preToolUse: Array.from(this.preToolUseHooks.values()).flat().length,
      postToolUse: Array.from(this.postToolUseHooks.values()).flat().length,
      postToolUseFailure: Array.from(
        this.postToolUseFailureHooks.values()
      ).flat().length,
    };
  }
}
