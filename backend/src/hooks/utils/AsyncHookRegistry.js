/**
 * 异步钩子注册表
 * 管理异步钩子的执行和状态
 * 参考CC源码: cc_code/backend/utils/hooks/AsyncHookRegistry.ts
 */

import { EventEmitter } from 'events';
import type { HookEvent } from '../types';
import { diagnosticManager } from './DiagnosticManager';

/**
 * 异步钩子输出
 */
export interface AsyncHookJSONOutput {
  async?: boolean;
  asyncTimeout?: number;
  asyncRewake?: boolean;
  continue?: boolean;
  [key: string]: any;
}

/**
 * 同步钩子输出
 */
export interface SyncHookJSONOutput {
  continue?: boolean;
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
class AsyncHookRegistry extends EventEmitter {
  private static instance: AsyncHookRegistry;
  private pendingHooks: Map<string, PendingAsyncHook> = new Map();
  private asyncRewakeHooks: Map<string, PendingAsyncHook> = new Map();

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
    const timeout = asyncResponse.asyncTimeout || 15000;
    const asyncRewake = asyncResponse.asyncRewake || false;

    console.log(`Hooks: Registering async hook ${processId} (${hookName}) with timeout ${timeout}ms, asyncRewake: ${asyncRewake}`);

    // 记录异步钩子注册
    diagnosticManager.logEvent('async_hook_registered', {
      hookId,
      hookName,
      hookEvent,
      details: {
        processId,
        timeout,
        asyncRewake,
        command: command.substring(0, 100),
      },
    });

    const stopProgressInterval = this.startHookProgressInterval({
      hookId,
      hookName,
      hookEvent,
      getOutput: async () => {
        const taskOutput = this.pendingHooks.get(processId)?.shellCommand?.taskOutput;
        if (!taskOutput) {
          return { stdout: '', stderr: '', output: '' };
        }
        const stdout = await taskOutput.getStdout();
        const stderr = taskOutput.getStderr();
        return { stdout, stderr, output: stdout + stderr };
      },
    });

    const pendingHook: PendingAsyncHook = {
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
    };

    this.pendingHooks.set(processId, pendingHook);

    // asyncRewake钩子绕过注册表管理
    if (asyncRewake) {
      this.asyncRewakeHooks.set(processId, pendingHook);
      this.handleAsyncRewakeHook(pendingHook);
    }
  }

  /**
   * 处理asyncRewake钩子
   * asyncRewake钩子完成后，如果退出码为2（阻塞错误），则唤醒模型
   */
  private async handleAsyncRewakeHook(hook: PendingAsyncHook): Promise<void> {
    try {
      // 等待shell命令完成
      const result = await hook.shellCommand?.result;

      // 等待I/O让StreamWrapper数据处理程序排入TaskOutput
      await new Promise(resolve => setImmediate(resolve));

      const stdout = await hook.shellCommand?.taskOutput.getStdout() || '';
      const stderr = hook.shellCommand?.taskOutput.getStderr() || '';
      hook.shellCommand?.cleanup();

      // 发出钩子响应事件
      this.emitHookResponse({
        hookId: hook.hookId,
        hookName: hook.hookName,
        hookEvent: hook.hookEvent,
        output: stdout + stderr,
        stdout,
        stderr,
        exitCode: result?.code,
        outcome: result?.code === 0 ? 'success' : 'error',
      });

      // 如果退出码为2（阻塞错误），则作为任务通知入队
      if (result?.code === 2) {
        this.enqueueBlockingNotification({
          value: this.wrapInSystemReminder(
            `Stop hook blocking error from command "${hook.hookName}": ${stderr || stdout}`
          ),
        });
      }

      // 从asyncRewake钩子列表中移除
      this.asyncRewakeHooks.delete(hook.processId);
    } catch (error) {
      console.error(`Hooks: Error handling asyncRewake hook ${hook.hookId}:`, error);
      this.asyncRewakeHooks.delete(hook.processId);
    }
  }

  /**
   * 发出钩子响应事件
   */
  private emitHookResponse(params: {
    hookId: string;
    hookName: string;
    hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
    output: string;
    stdout: string;
    stderr: string;
    exitCode?: number;
    outcome: string;
  }): void {
    this.emit('hookResponse', params);

    diagnosticManager.logEvent('async_hook_response', {
      hookId: params.hookId,
      hookName: params.hookName,
      hookEvent: params.hookEvent,
      details: {
        exitCode: params.exitCode,
        outcome: params.outcome,
        outputLength: params.output.length,
      },
    });
  }

  /**
   * 将消息包装在系统提醒中
   */
  private wrapInSystemReminder(message: string): string {
    return `[SyStem Reminder]\n\n${message}\n\n[/SyStem Reminder]`;
  }

  /**
   * 将阻塞通知入队
   */
  private enqueuePendingNotification(params: { value: string; mode: 'task-notification' | 'queued_command' }): void {
    this.emit('pendingNotification', params);
  }

  /**
   * 获取待处理的异步钩子
   */
  getPendingAsyncHooks(): PendingAsyncHook[] {
    return Array.from(this.pendingHooks.values()).filter(
      hook => !hook.responseAttachmentSent
    );
  }

  /**
   * 获取asyncRewake钩子
   */
  getAsyncRewakeHooks(): PendingAsyncHook[] {
    return Array.from(this.asyncRewakeHooks.values());
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
    console.log(`Hooks: Found ${pendingCount} total hooks in registry`);

    // 跳过asyncRewake钩子，它们由handleAsyncRewakeHook单独处理
    const hooks = Array.from(this.pendingHooks.values()).filter(
      hook => !hook.asyncRewake
    );

    const settled = await Promise.allSettled(
      hooks.map(async hook => {
        const stdout = (await hook.shellCommand?.taskOutput.getStdout()) ?? '';
        const stderr = hook.shellCommand?.taskOutput.getStderr() ?? '';
        console.log(
          `Hooks: Checking hook ${hook.processId} (${hook.hookName}) - attachmentSent: ${hook.responseAttachmentSent}, stdout length: ${stdout.length}`
        );

        if (hook.shellCommand?.isComplete()) {
          const exitCode = hook.shellCommand?.exitCode;
          await this.finalizeHook(hook, exitCode || 0, exitCode === 0 ? 'success' : 'error');

          // 解析JSON输出
          let response: SyncHookJSONOutput = {};
          try {
            const jsonOutput = stdout.trim();
            if (jsonOutput) {
              response = JSON.parse(jsonOutput);
            }
          } catch (error) {
            console.error(`Hooks: Failed to parse hook output: ${error}`);
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
    getOutput
  }: {
    hookId: string;
    hookName: string;
    hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion';
    getOutput: () => Promise<{ stdout: string; stderr: string; output: string }>;
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
        console.error(`Hooks: Error getting hook progress: ${error}`);
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
      this.asyncRewakeHooks.delete(processId);
    }
  }

  /**
   * 检查钩子是否应该由于工作区信任而被跳过
   */
  shouldSkipHookDueToTrust(isInteractive: boolean, hasTrust: boolean): boolean {
    // 在非交互模式（SDK）中，信任是隐式的 - 始终执行
    if (!isInteractive) {
      return false;
    }

    // 在交互模式下，所有钩子都需要信任
    return !hasTrust;
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
    this.asyncRewakeHooks.clear();
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
AsyncHookRegistry.instance = new AsyncHookRegistry();

export { AsyncHookRegistry };
export const asyncHookRegistry = AsyncHookRegistry.getInstance();
