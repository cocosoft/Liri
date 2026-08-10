//
/**
 * Hook执行器
 * 负责执行Hook并处理执行结果
 */

import {
  IndividualHookConfig,
  HookExecutionResult,
  HookExecutionContext,
} from '../types';
import { CommandHookExecutor } from './CommandHookExecutor';
import { PromptHookExecutor } from './PromptHookExecutor';
import { HttpHookExecutor } from './HttpHookExecutor';
import { AgentHookExecutor } from './AgentHookExecutor';
import { ScriptHookExecutor } from './ScriptHookExecutor';
import { asyncHookRegistry } from '../utils/AsyncHookRegistry';
import { environmentManager } from '../utils/EnvironmentManager';
import { diagnosticManager } from '../utils/DiagnosticManager';
import { securityManager } from '../utils/SecurityManager';
import { performanceManager } from '../utils/PerformanceManager';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('hooks:executors:HookExecutor');

/**
 * Hook执行器
 */
export class HookExecutor {
  private commandExecutor: CommandHookExecutor;
  private promptExecutor: PromptHookExecutor;
  private httpExecutor: HttpHookExecutor;
  private agentExecutor: AgentHookExecutor;
  private scriptExecutor: ScriptHookExecutor;

  constructor() {
    this.commandExecutor = new CommandHookExecutor();
    this.promptExecutor = new PromptHookExecutor();
    this.httpExecutor = new HttpHookExecutor();
    this.agentExecutor = new AgentHookExecutor();
    this.scriptExecutor = new ScriptHookExecutor();
  }

  /**
   * 执行Hook
   * @param hook Hook配置
   * @param context 执行上下文
   * @returns 执行结果
   */
  public async execute(
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): Promise<HookExecutionResult> {
    const startTime = Date.now();
    const hookId = hook.id || `hook-${Date.now()}`;

    try {
      // 记录Hook开始执行
      diagnosticManager.logEvent('hook_started', {
        sessionId: context.sessionId,
        hookId,
        hookName: hook.name,
        hookEvent: context.event,
        details: {
          type: hook.config.type,
          matcher: hook.matcher,
          priority: hook.config.priority,
        },
      });

      // 验证Hook配置安全性
      const securityResult = securityManager.validateHookConfig(hook.config);
      if (!securityResult.valid) {
        // 记录安全验证失败
        diagnosticManager.logEvent('hook_error', {
          sessionId: context.sessionId,
          hookId,
          hookName: hook.name,
          hookEvent: context.event,
          error: securityResult.error || 'Security validation failed',
        });

        return {
          success: false,
          error: securityResult.error || 'Security validation failed',
        };
      }

      // 记录性能开始
      const hookType = (hook.config as Record<string, unknown>).type as string;
      performanceManager.startExecution(hookId, hook.name, hookType);

      // 构建环境变量
      const envOptions = {
        sessionId: context.sessionId,
        skillRoot: (context as Record<string, unknown>).skillRoot as
          | string
          | undefined,
        pluginOptions: (context as Record<string, unknown>).pluginOptions as
          | Record<string, string>
          | undefined,
      };
      const env = environmentManager.buildEnvironment(envOptions);

      // 记录环境变量构建
      diagnosticManager.logEvent('environment_built', {
        sessionId: context.sessionId,
        details: {
          envVars: Object.keys(env).length,
        },
      });

      // 传递环境变量给执行器
      context.env = env;

      // 传递安全配置
      context.securityConfig =
        securityManager.getSandboxConfig() as unknown as Record<
          string,
          unknown
        >;

      let result: HookExecutionResult;
      switch (hookType) {
        case 'command':
          result = await this.commandExecutor.execute(hook, context);
          break;
        case 'prompt':
          result = await this.promptExecutor.execute(hook, context);
          break;
        case 'http':
          result = await this.httpExecutor.execute(hook, context);
          break;
        case 'agent':
          result = await this.agentExecutor.execute(hook, context);
          break;
        case 'script':
          result = await this.scriptExecutor.execute(hook, context);
          break;
        default:
          result = {
            success: false,
            error: `Unknown hook type: ${hookType}`,
          };
      }

      // 记录性能结束
      performanceManager.endExecution(
        hookId,
        hook.name,
        hookType,
        result.success,
        result.error
      );

      // 记录Hook执行完成
      diagnosticManager.logEvent('hook_completed', {
        sessionId: context.sessionId,
        hookId,
        hookName: hook.name,
        hookEvent: context.event,
        duration: Date.now() - startTime,
        details: {
          success: result.success,
          exitCode: result.exitCode,
        },
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // 记录性能结束
      performanceManager.endExecution(
        hookId,
        hook.name,
        ((hook.config as Record<string, unknown>).type as string) || 'unknown',
        false,
        errorMessage
      );

      // 记录Hook执行错误
      diagnosticManager.logEvent('hook_error', {
        sessionId: context.sessionId,
        hookId,
        hookName: hook.name,
        hookEvent: context.event,
        duration: Date.now() - startTime,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 检查异步Hook响应
   * @returns 响应列表
   */
  public async checkAsyncHookResponses(): Promise<unknown[]> {
    const responses = await asyncHookRegistry.checkForAsyncHookResponses();
    return responses;
  }

  /**
   * 取消Hook执行
   * @param processId 进程ID
   */
  public async cancelHook(processId: string): Promise<void> {
    await asyncHookRegistry.cancelHook(processId);

    // 记录Hook取消
    diagnosticManager.logEvent('hook_cancelled', {
      details: {
        processId,
      },
    });
  }

  /**
   * 获取待处理的异步Hook
   * @returns 待处理Hook列表
   */
  public getPendingAsyncHooks(): any[] {
    return asyncHookRegistry.getPendingAsyncHooks();
  }

  /**
   * 并行执行多个Hook
   * @param hooks Hook配置列表
   * @param context 执行上下文
   * @returns 执行结果列表
   */
  public async executeParallel(
    hooks: IndividualHookConfig[],
    context: HookExecutionContext
  ): Promise<HookExecutionResult[]> {
    const tasks = hooks.map((hook) => () => this.execute(hook, context));
    return await performanceManager.executeParallel(tasks);
  }

  /**
   * 批量执行多个Hook
   * @param hooks Hook配置列表
   * @param context 执行上下文
   * @param batchSize 批量大小
   * @returns 执行结果列表
   */
  public async executeBatch(
    hooks: IndividualHookConfig[],
    context: HookExecutionContext,
    batchSize: number = 10
  ): Promise<HookExecutionResult[]> {
    const tasks = hooks.map((hook) => () => this.execute(hook, context));
    return await performanceManager.executeBatch(tasks, batchSize);
  }

  /**
   * 获取性能指标
   * @returns 性能指标
   */
  public getPerformanceMetrics() {
    return performanceManager.getMetrics();
  }

  /**
   * 获取安全管理器
   * @returns 安全管理器
   */
  public getSecurityManager() {
    return securityManager;
  }

  /**
   * 重置执行器
   */
  public reset(): void {
    asyncHookRegistry.reset();
    environmentManager.reset();
    performanceManager.reset();
  }
}
