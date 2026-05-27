/**
 * Hook执行器
 * 负责执行Hook并处理执行结果
 * 参考CC源码: cc_code/backend/utils/hooks.ts
 */

import { asyncHookRegistry } from '../utils/AsyncHookRegistry';
import { environmentManager } from '../utils/EnvironmentManager';
import { diagnosticManager } from '../utils/DiagnosticManager';
import { securityManager } from '../utils/SecurityManager';
import { performanceManager } from '../utils/PerformanceManager';
import { CommandHookExecutor } from './CommandHookExecutor';
import { PromptHookExecutor } from './PromptHookExecutor';
import { HttpHookExecutor } from './HttpHookExecutor';
import { AgentHookExecutor } from './AgentHookExecutor';
import { ScriptHookExecutor } from './ScriptHookExecutor';

/**
 * Hook执行结果
 */
interface HookExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  exitCode?: number;
  durationMs?: number;
  blockingError?: string;
  preventContinuation?: boolean;
  stopReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
  permissionBehavior?: 'allow' | 'deny' | 'ask';
  hookPermissionDecisionReason?: string;
}

/**
 * Hook执行上下文
 */
interface HookExecutionContext {
  sessionId: string;
  event: string;
  skillRoot?: string;
  pluginOptions?: Record<string, string>;
  workspaceRoot?: string;
  permissionMode?: string;
  agentId?: string;
  agentType?: string;
  env?: Record<string, string>;
  securityConfig?: any;
  toolUseId?: string;
  toolName?: string;
  input?: Record<string, unknown>;
  messages?: any[];
}

/**
 * IndividualHookConfig
 */
interface IndividualHookConfig {
  id?: string;
  name: string;
  config: {
    type: 'command' | 'prompt' | 'http' | 'agent' | 'script';
    command?: string;
    prompt?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    agent?: string;
    args?: string[];
    timeout?: number;
    priority?: number;
    matcher?: string;
  };
  matcher?: string;
}

/**
 * Hook输出验证结果
 */
interface HookOutputValidation {
  valid: boolean;
  error?: string;
  parsed?: any;
}

/**
 * JSON解析结果
 */
interface JSONParseResult {
  json?: any;
  plainText?: string;
  validationError?: string;
}

/**
 * Hook执行器
 */
class HookExecutor {
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
      performanceManager.startExecution(hookId, hook.name, hook.config.type);

      // 构建环境变量
      const envOptions = {
        sessionId: context.sessionId,
        skillRoot: context.skillRoot,
        pluginOptions: context.pluginOptions,
        workspaceRoot: context.workspaceRoot,
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
      context.securityConfig = securityManager.getSandboxConfig();

      let result: HookExecutionResult;
      switch (hook.config.type) {
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
            error: `Unknown hook type: ${hook.config.type}`,
          };
      }

      // 解析和验证Hook输出
      if (result.success && result.output) {
        const parsedOutput = this.parseHookOutput(result.output);
        if (parsedOutput.validationError) {
          result.error = parsedOutput.validationError;
          result.success = false;
        } else if (parsedOutput.json) {
          result.output = this.processHookJSONOutput(parsedOutput.json, hook, context);
        }
      }

      // 记录性能结束
      performanceManager.endExecution(hookId, hook.name, hook.config.type, result.success, result.error);

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

      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      performanceManager.endExecution(hookId, hook.name, hook.config.type || 'unknown', false, errorMessage);

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
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 解析Hook输出
   */
  public parseHookOutput(stdout: string): JSONParseResult {
    const trimmed = stdout.trim();
    if (!trimmed.startsWith('{')) {
      return { plainText: stdout };
    }

    try {
      const validation = this.validateHookJson(trimmed);
      if (validation.valid) {
        return { json: validation.parsed };
      }
      return { validationError: validation.error };
    } catch (e) {
      return { plainText: stdout };
    }
  }

  /**
   * 验证Hook JSON输出
   */
  private validateHookJson(jsonString: string): HookOutputValidation {
    try {
      const parsed = JSON.parse(jsonString);

      // 验证必需的字段
      if (parsed === null || typeof parsed !== 'object') {
        return {
          valid: false,
          error: 'Hook output must be a JSON object',
        };
      }

      // 验证continue字段
      if (parsed.continue !== undefined && typeof parsed.continue !== 'boolean') {
        return {
          valid: false,
          error: 'continue field must be a boolean',
        };
      }

      // 验证decision字段
      if (parsed.decision !== undefined) {
        if (!['approve', 'block'].includes(parsed.decision)) {
          return {
            valid: false,
            error: 'decision must be "approve" or "block"',
          };
        }
      }

      // 验证permissionDecision字段
      if (parsed.permissionDecision !== undefined) {
        if (!['allow', 'deny', 'ask'].includes(parsed.permissionDecision)) {
          return {
            valid: false,
            error: 'permissionDecision must be "allow", "deny", or "ask"',
          };
        }
      }

      // 验证stopReason字段
      if (parsed.stopReason !== undefined && typeof parsed.stopReason !== 'string') {
        return {
          valid: false,
          error: 'stopReason field must be a string',
        };
      }

      // 验证systemMessage字段
      if (parsed.systemMessage !== undefined && typeof parsed.systemMessage !== 'string') {
        return {
          valid: false,
          error: 'systemMessage field must be a string',
        };
      }

      return {
        valid: true,
        parsed,
      };
    } catch (e) {
      return {
        valid: false,
        error: `JSON parse error: ${e instanceof Error ? e.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * 处理Hook JSON输出
   */
  private processHookJSONOutput(
    json: any,
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): any {
    const result: any = {
      ...json,
    };

    // 处理continue字段
    if (json.continue === false) {
      result.preventContinuation = true;
      if (json.stopReason) {
        result.stopReason = json.stopReason;
      }
    }

    // 处理decision字段
    if (json.decision) {
      switch (json.decision) {
        case 'approve':
          result.permissionBehavior = 'allow';
          break;
        case 'block':
          result.permissionBehavior = 'deny';
          result.blockingError = json.reason || 'Blocked by hook';
          break;
      }
    }

    // 处理systemMessage字段
    if (json.systemMessage) {
      result.systemMessage = json.systemMessage;
    }

    // 处理hookSpecificOutput
    if (json.hookSpecificOutput) {
      result.hookSpecificOutput = this.processHookSpecificOutput(
        json.hookSpecificOutput,
        hook,
        context
      );
    }

    // 处理additionalContext
    if (json.additionalContext) {
      result.additionalContext = json.additionalContext;
    }

    // 处理updatedInput
    if (json.updatedInput) {
      result.updatedInput = json.updatedInput;
    }

    return result;
  }

  /**
   * 处理Hook特定输出
   */
  private processHookSpecificOutput(
    hookSpecificOutput: any,
    hook: IndividualHookConfig,
    context: HookExecutionContext
  ): any {
    const result: any = {
      ...hookSpecificOutput,
    };

    // 验证hookEventName
    if (!hookSpecificOutput.hookEventName) {
      return result;
    }

    // 处理PreToolUse
    if (hookSpecificOutput.hookEventName === 'PreToolUse') {
      if (hookSpecificOutput.permissionDecision) {
        result.permissionBehavior = hookSpecificOutput.permissionDecision;
        if (hookSpecificOutput.permissionDecision === 'deny') {
          result.blockingError =
            hookSpecificOutput.permissionDecisionReason ||
            hookSpecificOutput.reason ||
            'Blocked by hook';
        }
      }
      if (hookSpecificOutput.updatedInput) {
        result.updatedInput = hookSpecificOutput.updatedInput;
      }
    }

    // 处理UserPromptSubmit
    if (hookSpecificOutput.hookEventName === 'UserPromptSubmit') {
      if (hookSpecificOutput.additionalContext) {
        result.additionalContext = hookSpecificOutput.additionalContext;
      }
    }

    // 处理PostToolUse
    if (hookSpecificOutput.hookEventName === 'PostToolUse') {
      if (hookSpecificOutput.additionalContext) {
        result.additionalContext = hookSpecificOutput.additionalContext;
      }
    }

    return result;
  }

  /**
   * 检查异步Hook响应
   */
  public async checkAsyncHookResponses(): Promise<any[]> {
    const responses = await asyncHookRegistry.checkForAsyncHookResponses();
    return responses;
  }

  /**
   * 取消Hook执行
   */
  public async cancelHook(processId: string): Promise<void> {
    await asyncHookRegistry.cancelHook(processId);

    diagnosticManager.logEvent('hook_cancelled', {
      details: {
        processId,
      },
    });
  }

  /**
   * 获取待处理的异步Hook
   */
  public getPendingAsyncHooks(): any[] {
    return asyncHookRegistry.getPendingAsyncHooks();
  }

  /**
   * 获取asyncRewake钩子
   */
  public getAsyncRewakeHooks(): any[] {
    return asyncHookRegistry.getAsyncRewakeHooks();
  }

  /**
   * 并行执行多个Hook
   */
  public async executeParallel(
    hooks: IndividualHookConfig[],
    context: HookExecutionContext
  ): Promise<HookExecutionResult[]> {
    const tasks = hooks.map(hook => () => this.execute(hook, context));
    return await performanceManager.executeParallel(tasks);
  }

  /**
   * 批量执行多个Hook
   */
  public async executeBatch(
    hooks: IndividualHookConfig[],
    context: HookExecutionContext,
    batchSize: number = 10
  ): Promise<HookExecutionResult[]> {
    const tasks = hooks.map(hook => () => this.execute(hook, context));
    return await performanceManager.executeBatch(tasks, batchSize);
  }

  /**
   * 获取性能指标
   */
  public getPerformanceMetrics() {
    return performanceManager.getMetrics();
  }

  /**
   * 获取安全管理器
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

/**
 * 导出单例
 */
HookExecutor.instance = new HookExecutor();

export { HookExecutor };
export const hookExecutor = HookExecutor.getInstance();
