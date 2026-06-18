/**
 * 异步钩子注册表
 * 管理异步钩子的执行和状态
 * 参考CC源码: cc_code/backend/utils/hooks/AsyncHookRegistry.ts
 */

import { EventEmitter } from 'events';
import type { HookEvent } from '../types';
import { diagnosticManager } from './DiagnosticManager';
import { getLogger } from '@modules/monitoring/logs/Logger';

const logger = getLogger('AsyncHookRegistry');

/**
 * 异步钩子输出
 */
export interface AsyncHookJSONOutput {
  async: boolean;
  asyncTimeout?: number;
  asyncRewake?: boolean;
  [key: string]: any;
}

/**
 * 同步钩子输出
 */
export interface SyncHookJSONOutput {
  [key: string]: any;
}

/**
 * 待处理的异步钩子
 */
export interface PendingAsyncHook {
  processId: string;
  hookId: string;
  hookName: string;
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
  toolName?: string;
  pluginId?: string;
  startTime: number;
  timeout: number;
  command: string;
  responseAttachmentSent: boolean;
  shellCommand?: any;
  stopProgressInterval: () => void;
  asyncRewake: boolean;
}

/**
 * 异步钩子注册表类
 */
export class AsyncHookRegistry extends EventEmitter {
  private static instance: AsyncHookRegistry;
  private pendingHooks: Map<string, PendingAsyncHook> = new Map();

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): AsyncHookRegistry {
    if (!AsyncHookRegistry.instance) {
      AsyncHookRegistry.instance = new AsyncHookRegistry();
    }
    return AsyncHookRegistry.instance;
  }

  /**
   * 注册待处理的异步钩子
   */
  registerPendingAsyncHook({
    processId,
    hookId,
    asyncResponse,
    hookName,
    hookEvent,
    command,
    shellCommand,
    toolName,
    pluginId,
  }: {
    processId: string;
    hookId: string;
    asyncResponse: AsyncHookJSONOutput;
    hookName: string;
    hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
    command: string;
    shellCommand: any;
    toolName?: string;
    pluginId?: string;
  }): void {
    const timeout = asyncResponse.asyncTimeout || 15000; // 默认15秒
    const asyncRewake = asyncResponse.asyncRewake || false;

    logger.info(
      `Hooks: Registering async hook ${processId} (${hookName}) with timeout ${timeout}ms, asyncRewake: ${asyncRewake}`
    );

    // 记录异步钩子注册
    diagnosticManager.logEvent('async_hook_registered', {
      hookId,
      hookName,
      hookEvent,
      details: {
        processId,
        timeout,
        asyncRewake,
        command: command.substring(0, 100), // 只记录命令的前100个字符
      },
    });

    const stopProgressInterval = this.startHookProgressInterval({
      hookId,
      hookName,
      hookEvent,
      getOutput: async () => {
        const taskOutput =
          this.pendingHooks.get(processId)?.shellCommand?.taskOutput;
        if (!taskOutput) {
          return { stdout: '', stderr: '', output: '' };
        }
        const stdout = await taskOutput.getStdout();
        const stderr = taskOutput.getStderr();
        return { stdout, stderr, output: stdout + stderr };
      },
    });

    this.pendingHooks.set(processId, {
      processId,
      hookId,
      hookName,
      hookEvent,
      toolName,
      pluginId,
      command,
      startTime: Date.now(),
      timeout,
      responseAttachmentSent: false,
      shellCommand,
      stopProgressInterval,
      asyncRewake,
    });
  }

  /**
   * 获取待处理的异步钩子
   */
  getPendingAsyncHooks(): PendingAsyncHook[] {
    return Array.from(this.pendingHooks.values()).filter(
      (hook) => !hook.responseAttachmentSent
    );
  }

  /**
   * 检查异步钩子响应
   */
  async checkForAsyncHookResponses(): Promise<
    Array<{
      processId: string;
      response: SyncHookJSONOutput;
      hookName: string;
      hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
      toolName?: string;
      pluginId?: string;
      stdout: string;
      stderr: string;
      exitCode?: number;
      asyncRewake: boolean;
    }>
  > {
    const responses: Array<{
      processId: string;
      response: SyncHookJSONOutput;
      hookName: string;
      hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
      toolName?: string;
      pluginId?: string;
      stdout: string;
      stderr: string;
      exitCode?: number;
      asyncRewake: boolean;
    }> = [];

    const pendingCount = this.pendingHooks.size;
    logger.info(`Hooks: Found ${pendingCount} total hooks in registry`);

    // 处理前先获取快照
    const hooks = Array.from(this.pendingHooks.values());

    const settled = await Promise.allSettled(
      hooks.map(async (hook) => {
        const stdout = (await hook.shellCommand?.taskOutput.getStdout()) ?? '';
        const stderr = hook.shellCommand?.taskOutput.getStderr() ?? '';
        logger.info(
          `Hooks: Checking hook ${hook.processId} (${hook.hookName}) - attachmentSent: ${hook.responseAttachmentSent}, stdout length: ${stdout.length}`
        );

        if (hook.shellCommand?.isComplete()) {
          const exitCode = hook.shellCommand?.exitCode;
          await this.finalizeHook(
            hook,
            exitCode || 0,
            exitCode === 0 ? 'success' : 'error'
          );

          // 解析JSON输出
          let response: SyncHookJSONOutput = {};
          try {
            const jsonOutput = stdout.trim();
            if (jsonOutput) {
              response = JSON.parse(jsonOutput);
            }
          } catch (error) {
            logger.error(`Hooks: Failed to parse hook output: ${error}`);
          }

          return {
            processId: hook.processId,
            response,
            hookName: hook.hookName,
            hookEvent: hook.hookEvent,
            toolName: hook.toolName,
            pluginId: hook.pluginId,
            stdout,
            stderr,
            exitCode,
            asyncRewake: hook.asyncRewake,
          };
        }

        // 检查超时
        if (Date.now() - hook.startTime > hook.timeout) {
          await this.finalizeHook(hook, -1, 'error');
          return {
            processId: hook.processId,
            response: { error: 'Hook execution timed out' },
            hookName: hook.hookName,
            hookEvent: hook.hookEvent,
            toolName: hook.toolName,
            pluginId: hook.pluginId,
            stdout: '',
            stderr: 'Hook execution timed out',
            exitCode: -1,
            asyncRewake: hook.asyncRewake,
          };
        }

        return null;
      })
    );

    // 处理已完成的钩子
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        responses.push(result.value);
        this.pendingHooks.delete(result.value.processId);
      }
    }

    return responses;
  }

  /**
   * 完成钩子执行
   */
  private async finalizeHook(
    hook: PendingAsyncHook,
    exitCode: number,
    outcome: 'success' | 'error' | 'cancelled'
  ): Promise<void> {
    hook.stopProgressInterval();
    const taskOutput = hook.shellCommand?.taskOutput;
    const stdout = taskOutput ? await taskOutput.getStdout() : '';
    const stderr = taskOutput?.getStderr() ?? '';
    hook.shellCommand?.cleanup();

    // 记录异步钩子完成
    diagnosticManager.logEvent('async_hook_completed', {
      hookId: hook.hookId,
      hookName: hook.hookName,
      hookEvent: hook.hookEvent,
      duration: Date.now() - hook.startTime,
      details: {
        outcome,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      },
    });

    this.emit('hookResponse', {
      hookId: hook.hookId,
      hookName: hook.hookName,
      hookEvent: hook.hookEvent,
      output: stdout + stderr,
      stdout,
      stderr,
      exitCode,
      outcome,
    });
  }

  /**
   * 启动钩子进度间隔
   */
  private startHookProgressInterval({
    hookId,
    hookName,
    hookEvent,
    getOutput,
  }: {
    hookId: string;
    hookName: string;
    hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
    getOutput: () => Promise<{
      stdout: string;
      stderr: string;
      output: string;
    }>;
  }): () => void {
    const interval = setInterval(async () => {
      try {
        const output = await getOutput();
        this.emit('hookProgress', {
          hookId,
          hookName,
          hookEvent,
          output: output.output,
          stdout: output.stdout,
          stderr: output.stderr,
        });
      } catch (error) {
        logger.error(`Hooks: Error getting hook progress: ${error}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }

  /**
   * 取消钩子执行
   */
  async cancelHook(processId: string): Promise<void> {
    const hook = this.pendingHooks.get(processId);
    if (hook) {
      await this.finalizeHook(hook, -2, 'cancelled');
      this.pendingHooks.delete(processId);
    }
  }

  /**
   * 重置注册表
   */
  reset(): void {
    for (const hook of this.pendingHooks.values()) {
      hook.stopProgressInterval();
      hook.shellCommand?.cleanup();
    }
    this.pendingHooks.clear();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const asyncHookRegistry = AsyncHookRegistry.getInstance();
