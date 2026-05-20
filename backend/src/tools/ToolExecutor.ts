/**
 * 工具执行器
 * 负责工具的执行、权限检查、输入验证等功能
 */
import { Tool } from './types/Tool';
import { ToolResult, createToolResult } from './types/ToolResult';
import { ToolUseContext } from './types/ToolUseContext';
import {
  PermissionManager,
  createPermissionManager,
} from '../permission/PermissionManager';
import { GovernanceManager } from '../governance/managers/GovernanceManager';
import { ToolHookManager } from '../hooks/managers/ToolHookManager';
import { ToolHookContext } from '../hooks/types/ToolHooks';
import { v4 as uuidv4 } from 'uuid';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import {
  SandboxManagerImpl,
  createSandboxManager,
} from '../sandbox/SandboxImpl';

const logger = new Logger({ level: LogLevel.INFO });
import {
  SandboxPlatform,
  createDefaultSandboxConfig,
  createSandboxExecuteOptions,
} from '../sandbox/types/SandboxTypes';
import {
  preExecutionCheck,
  isPathTraversal,
  sanitizePath,
} from '@modules/security';
import type { ToolExecutionStats, ToolExecutionLog } from './types/ToolTypes';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { Span, SpanStatusCode } from '@opentelemetry/api';

export interface ToolResultBlock {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error: string | null;
  output: string;
  executionTime: number;
}

/**
 * 工具执行器类
 */
export class ToolExecutor {
  /** 权限管理器 */
  private permissionManager: PermissionManager;

  /** 治理管理器 */
  private governanceManager: GovernanceManager;

  /** Hook管理器 */
  private hookManager: ToolHookManager;

  /** 执行状态 */
  private isExecuting: boolean = false;

  /** 中断标志 */
  private interrupted: boolean = false;

  /** 是否启用治理闭环 */
  private useGovernance: boolean = true;

  /** 是否启用Hook系统 */
  private useHooks: boolean = true;

  /** 沙箱管理器 */
  private sandboxManager: SandboxManagerImpl;

  /** CC 并发执行追踪 */
  private concurrentExecutions: Map<string, Promise<ToolResult>> = new Map();

  /** CC 执行统计 */
  private executionStats: Map<string, ToolExecutionStats> = new Map();

  /** CC 执行日志 */
  private executionLogs: Map<string, ToolExecutionLog[]> = new Map();

  /**
   * 构造函数
   * @param permissionManager 权限管理器实例
   * @param governanceManager 治理管理器实例
   * @param useGovernance 是否启用治理闭环
   * @param useHooks 是否启用Hook系统
   */
  constructor(
    permissionManager?: PermissionManager,
    governanceManager?: GovernanceManager,
    useGovernance: boolean = true,
    useHooks: boolean = true
  ) {
    this.permissionManager = permissionManager || createPermissionManager();
    this.governanceManager =
      governanceManager || GovernanceManager.getInstance();
    this.hookManager = ToolHookManager.getInstance();
    this.sandboxManager = createSandboxManager();
    this.useGovernance = useGovernance;
    this.useHooks = useHooks;
  }

  /**
   * 执行工具
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param onProgress 进度回调
   * @returns 工具执行结果
   */
  async execute(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    onProgress?: (progress: any) => void
  ): Promise<ToolResult> {
    const startTime = Date.now();
    this.isExecuting = true;
    this.interrupted = false;
    const toolUseId = uuidv4();

    const toolName = tool.name;

    const hookContext: ToolHookContext = {
      toolName: toolName,
      toolUseID: toolUseId,
      input: { ...input },
      permissionMode: 'auto' as any,
      abortSignal: undefined,
    };

    let tracingSpan: Span | undefined;

    try {
      // 创建 OTel span 用于工具调用链追踪
      const tracing = getOTelTracing();
      const spanAttributes: Record<string, string | number | boolean> = {
        'tool.name': toolName,
        'tool.use_id': toolUseId,
      };
      const safeInputKeys = Object.keys(input).slice(0, 10);
      spanAttributes['tool.input_keys'] = safeInputKeys.join(',');

      tracingSpan = tracing.startSpan(`tool.${toolName}`, spanAttributes);

      // 将 traceId 注入上下文，支持子工具链路追踪
      const traceId = tracingSpan.spanContext().traceId;
      context.traceId = traceId;

      // 安全检查
      const securityCheck = this.performSecurityCheck(tool, input);
      if (!securityCheck.safe) {
        tracing.endSpan(
          tracingSpan,
          SpanStatusCode.ERROR,
          'Security check failed'
        );
        return createToolResult(null, {
          newMessages: [
            {
              role: 'system',
              content: `Security check failed: ${securityCheck.errors.join(', ')}`,
            },
          ],
        });
      }

      // 显示安全警告
      if (securityCheck.warnings.length > 0) {
        logger.warning('Security warnings', securityCheck.warnings);
      }

      if (this.useHooks) {
        const preHookResult = await this.executePreToolUseHooks(hookContext);
        if (preHookResult.preventContinuation) {
          tracing.endSpan(
            tracingSpan,
            SpanStatusCode.ERROR,
            'Execution prevented by hook'
          );
          return createToolResult(null, {
            newMessages: [
              {
                role: 'system',
                content: 'Execution prevented by hook',
              },
            ],
          });
        }
      }

      const result = this.useGovernance
        ? await this.executeWithGovernance(
            tool,
            input,
            context,
            startTime,
            onProgress,
            toolUseId
          )
        : await this.executeLegacy(
            tool,
            input,
            context,
            startTime,
            onProgress,
            toolUseId
          );

      if (this.useHooks) {
        hookContext.output = result.data;
        hookContext.error =
          typeof result.metadata?.error === 'string'
            ? result.metadata.error
            : undefined;
        await this.executePostToolUseHooks(
          hookContext,
          !result.metadata?.error
        );
      }

      const success = !result.metadata?.error;

      // 记录执行结果到 span
      tracingSpan.setAttribute('tool.success', success);
      tracingSpan.setAttribute('tool.duration_ms', Date.now() - startTime);
      if (result.metadata?.error) {
        tracing.endSpan(
          tracingSpan,
          SpanStatusCode.ERROR,
          String(result.metadata.error)
        );
      } else {
        tracing.endSpan(tracingSpan, SpanStatusCode.OK);
      }

      this.recordToolExecution(toolName, toolUseId, startTime, success);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (this.useHooks) {
        hookContext.error = errorMessage;
        await this.executePostToolUseHooks(hookContext, false);
      }

      this.recordToolExecution(toolName, toolUseId, startTime, false);

      // 关闭 OTel span（如有），记录错误
      if (tracingSpan) {
        try {
          const tracing = getOTelTracing();
          tracing.recordError(
            tracingSpan,
            error instanceof Error ? error : new Error(errorMessage)
          );
          tracing.endSpan(tracingSpan, SpanStatusCode.ERROR, errorMessage);
        } catch {
          // OTel span 错误不影响主流程
        }
      }

      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${errorMessage}`,
          },
        ],
      });
    } finally {
      this.isExecuting = false;
      this.interrupted = false;
    }
  }

  /**
   * 执行PreToolUse Hooks
   * @param context Hook上下文
   * @returns 执行结果
   */
  private async executePreToolUseHooks(context: ToolHookContext): Promise<{
    preventContinuation: boolean;
    stopReason?: string;
    updatedInput?: Record<string, unknown>;
  }> {
    const result: {
      preventContinuation: boolean;
      stopReason?: string;
      updatedInput?: Record<string, unknown>;
    } = {
      preventContinuation: false,
      updatedInput: undefined,
    };

    try {
      for await (const yieldValue of this.hookManager.executePreToolUseHooks(
        context
      )) {
        switch (yieldValue.type) {
          case 'preventContinuation':
            result.preventContinuation = yieldValue.shouldPreventContinuation;
            break;
          case 'stopReason':
            result.stopReason = yieldValue.stopReason;
            break;
          case 'hookUpdatedInput':
            result.updatedInput = yieldValue.updatedInput;
            break;
          case 'stop':
            result.preventContinuation = true;
            break;
        }
      }
    } catch (error) {
      logger.error(
        'Error executing PreToolUse hooks',
        error instanceof Error ? error : new Error(String(error))
      );
    }

    return result;
  }

  /**
   * 执行PostToolUse或PostToolUseFailure Hooks
   * @param context Hook上下文
   * @param isSuccess 是否成功
   */
  private async executePostToolUseHooks(
    context: ToolHookContext,
    isSuccess: boolean
  ): Promise<void> {
    try {
      if (isSuccess) {
        for await (const _ of this.hookManager.executePostToolUseHooks(
          context
        )) {
        }
      } else {
        for await (const _ of this.hookManager.executePostToolUseFailureHooks(
          context
        )) {
        }
      }
    } catch (error) {
      logger.error(
        'Error executing PostToolUse hooks',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 在沙箱中执行命令
   * @param command 命令参数
   * @param options 执行选项
   * @returns 执行结果
   */
  private async executeInSandbox(
    command: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const platform = this.sandboxManager.getCurrentPlatform();
    const sandboxConfig = createDefaultSandboxConfig(platform);
    const sandbox = this.sandboxManager.createSandbox(sandboxConfig);

    await sandbox.initialize(sandboxConfig);

    try {
      const executeOptions = createSandboxExecuteOptions(command, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      });

      const result = await sandbox.execute(executeOptions);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } finally {
      await sandbox.close();
    }
  }

  /**
   * 使用治理闭环执行工具
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param startTime 开始时间
   * @param onProgress 进度回调
   * @param toolUseId 工具使用ID
   * @returns 工具执行结果
   */
  private async executeWithGovernance(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    startTime: number,
    onProgress?: (progress: any) => void,
    toolUseId?: string
  ): Promise<ToolResult> {
    const validationResult = await this.validateInput(tool, input, context);
    if (!validationResult.valid) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${validationResult.error}`,
          },
        ],
      });
    }

    const finalToolUseId = toolUseId || uuidv4();

    const governanceContext = {
      toolUseId: finalToolUseId,
      toolName: tool.name,
      input,
      permissionMode: 'auto' as any,
      abortSignal: undefined,
    };

    const governanceResult = await this.governanceManager.executeWithGovernance(
      tool,
      governanceContext,
      async (finalInput: Record<string, unknown>) => {
        return await tool.execute(finalInput, context);
      }
    );

    if (!governanceResult.success) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${governanceResult.error || 'Execution failed'}`,
          },
        ],
      });
    }

    return governanceResult.output as ToolResult;
  }

  /**
   * 原有执行流程（不使用治理闭环）
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param startTime 开始时间
   * @param onProgress 进度回调
   * @param toolUseId 工具使用ID
   * @returns 工具执行结果
   */
  private async executeLegacy(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    startTime: number,
    onProgress?: (progress: any) => void,
    toolUseId?: string
  ): Promise<ToolResult> {
    const validationResult = await this.validateInput(tool, input, context);
    if (!validationResult.valid) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${validationResult.error}`,
          },
        ],
      });
    }

    const permissionResult = await this.checkPermissions(tool, input, context);
    if (!permissionResult.allowed) {
      return createToolResult(null, {
        newMessages: [
          {
            role: 'system',
            content: `Error: ${permissionResult.error || 'Permission denied'}`,
          },
        ],
      });
    }

    const result = await tool.execute(input, context);

    return result;
  }

  /**
   * 验证输入
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @returns 验证结果
   */
  async validateInput(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<{ valid: boolean; error: string | null }> {
    if (tool.validateInput) {
      try {
        const validationResult = tool.validateInput(input);
        if (!validationResult.result) {
          return {
            valid: false,
            error: validationResult.message || 'Input validation failed',
          };
        }
      } catch (error) {
        return {
          valid: false,
          error:
            error instanceof Error ? error.message : 'Input validation error',
        };
      }
    }

    for (const param of tool.params) {
      if (param.required && !(param.name in input)) {
        return {
          valid: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }
    }

    return {
      valid: true,
      error: null,
    };
  }

  /**
   * 检查权限
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @returns 权限结果
   */
  async checkPermissions(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<{ allowed: boolean; error: string | null }> {
    if (tool.checkPermissions) {
      try {
        const permissionResult = await tool.checkPermissions(input, context);
        return {
          allowed: permissionResult.behavior === 'allow',
          error: permissionResult.reason || null,
        };
      } catch (error) {
        return {
          allowed: false,
          error:
            error instanceof Error ? error.message : 'Permission check error',
        };
      }
    }

    try {
      const decision = await this.permissionManager.checkPermission(
        tool.name,
        input
      );

      if (decision.type === 'deny') {
        return {
          allowed: false,
          error: decision.reason || 'Permission denied',
        };
      }
    } catch (error) {
      return {
        allowed: false,
        error:
          error instanceof Error ? error.message : 'Permission check error',
      };
    }

    return {
      allowed: true,
      error: null,
    };
  }

  /**
   * 处理结果
   * @param tool 工具实例
   * @param result 工具执行结果
   * @param toolUseID 工具使用ID
   * @returns 工具结果块
   */
  processResult(
    tool: Tool,
    result: ToolResult,
    toolUseID: string
  ): ToolResultBlock {
    return {
      toolCallId: toolUseID,
      toolName: tool.name,
      result: result.data,
      error:
        typeof result.metadata?.error === 'string'
          ? result.metadata.error
          : null,
      output:
        typeof result.data === 'string'
          ? result.data
          : JSON.stringify(result.data),
      executionTime: 0,
    };
  }

  /**
   * 中断执行
   */
  interrupt(): void {
    this.interrupted = true;
  }

  /**
   * 检查执行状态
   * @returns 是否正在执行
   */
  isRunning(): boolean {
    return this.isExecuting;
  }

  /**
   * 检查是否被中断
   * @returns 是否被中断
   */
  isInterrupted(): boolean {
    return this.interrupted;
  }

  /**
   * 获取权限管理器
   * @returns 权限管理器实例
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器实例
   */
  setPermissionManager(permissionManager: PermissionManager): void {
    this.permissionManager = permissionManager;
  }

  /**
   * 获取治理管理器
   * @returns 治理管理器实例
   */
  getGovernanceManager(): GovernanceManager {
    return this.governanceManager;
  }

  /**
   * 设置治理管理器
   * @param governanceManager 治理管理器实例
   */
  setGovernanceManager(governanceManager: GovernanceManager): void {
    this.governanceManager = governanceManager;
  }

  /**
   * 启用治理闭环
   */
  enableGovernance(): void {
    this.useGovernance = true;
  }

  /**
   * 禁用治理闭环
   */
  disableGovernance(): void {
    this.useGovernance = false;
  }

  /**
   * 检查是否启用治理闭环
   * @returns 是否启用
   */
  isGovernanceEnabled(): boolean {
    return this.useGovernance;
  }

  /**
   * 执行安全检查
   * @param tool 工具实例
   * @param input 工具输入
   * @returns 安全检查结果
   */
  private performSecurityCheck(
    tool: Tool,
    input: Record<string, unknown>
  ): {
    safe: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // 对于Bash工具，执行额外的安全检查
    if (tool.name === 'Bash') {
      const command = (input.command as string) || '';
      const args = (input.args as string[]) || [];

      // 执行预执行安全检查
      const checkResult = preExecutionCheck(command, args);
      warnings.push(...checkResult.warnings);
      errors.push(...checkResult.errors);
    }

    // 检查路径参数
    for (const [key, value] of Object.entries(input)) {
      if (
        typeof value === 'string' &&
        (key.includes('path') || key.includes('file'))
      ) {
        if (isPathTraversal(value)) {
          errors.push(`Path traversal detected in ${key}: ${value}`);
        }
      }
    }

    return {
      safe: errors.length === 0,
      warnings,
      errors,
    };
  }

  /**
   * 记录工具执行（基于CC源码）
   */
  private recordToolExecution(
    toolName: string,
    executionId: string,
    startTime: number,
    success: boolean
  ): void {
    const executionTime = Date.now() - startTime;
    if (success) {
      this.addExecutionLog(
        toolName,
        'info',
        `工具执行成功: ${toolName} (${executionTime}ms)`
      );
    } else {
      this.addExecutionLog(
        toolName,
        'error',
        `工具执行失败: ${toolName} (${executionTime}ms)`
      );
    }
    this.updateExecutionStats(toolName, executionTime, success);
    this.cleanupExpiredLogs();
  }

  /**
   * 获取执行统计（基于CC源码）
   */
  getExecutionStats(
    toolName?: string
  ): ToolExecutionStats | Map<string, ToolExecutionStats> {
    if (toolName) {
      return (
        this.executionStats.get(toolName) || {
          executionCount: 0,
          averageExecutionTime: 0,
          successRate: 0,
          totalExecutionTime: 0,
          successfulExecutions: 0,
          failedExecutions: 0,
        }
      );
    }
    return new Map(this.executionStats);
  }

  /**
   * 获取执行日志（基于CC源码）
   */
  getExecutionLogs(executionId: string): ToolExecutionLog[] {
    return this.executionLogs.get(executionId) || [];
  }

  /**
   * 获取当前并发执行数（基于CC源码）
   */
  getConcurrentExecutionCount(): number {
    return this.concurrentExecutions.size;
  }

  /**
   * 获取活跃执行ID列表（基于CC源码）
   */
  getActiveExecutionIds(): string[] {
    return Array.from(this.concurrentExecutions.keys());
  }

  /**
   * 取消执行（基于CC源码）
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    const executionPromise = this.concurrentExecutions.get(executionId);
    if (!executionPromise) {
      return false;
    }
    this.concurrentExecutions.delete(executionId);
    return true;
  }

  /**
   * 重置执行器（基于CC源码）
   */
  reset(): void {
    this.concurrentExecutions.clear();
    this.executionStats.clear();
    this.executionLogs.clear();
  }

  /**
   * 更新执行统计（基于CC源码）
   */
  private updateExecutionStats(
    toolName: string,
    executionTime: number,
    success: boolean
  ): void {
    const defaultStats = {
      executionCount: 0,
      averageExecutionTime: 0,
      successRate: 0,
      totalExecutionTime: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
    };
    const stats = this.executionStats.get(toolName) || { ...defaultStats };

    stats.executionCount!++;
    stats.totalExecutionTime! += executionTime;
    stats.averageExecutionTime =
      stats.totalExecutionTime! / stats.executionCount!;

    if (success) {
      stats.successfulExecutions!++;
    } else {
      stats.failedExecutions!++;
    }

    stats.successRate =
      (stats.successfulExecutions! / stats.executionCount!) * 100;

    this.executionStats.set(toolName, stats);
  }

  /**
   * 添加执行日志（基于CC源码）
   */
  private addExecutionLog(
    toolName: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: unknown
  ): void {
    const logs = this.executionLogs.get(toolName) || [];
    logs.push({
      timestamp: new Date(),
      level,
      message,
      data,
    });
    this.executionLogs.set(toolName, logs);
  }

  /**
   * 清理过期的执行日志（基于CC源码）
   */
  private cleanupExpiredLogs(): void {
    const now = Date.now();
    const retentionTime = 24 * 60 * 60 * 1000;

    for (const [key, logs] of this.executionLogs.entries()) {
      if (logs.length > 0) {
        const lastLogTime = logs[logs.length - 1].timestamp.getTime();
        if (now - lastLogTime > retentionTime) {
          this.executionLogs.delete(key);
        }
      }
    }
  }
}

/**
 * 创建工具执行器实例
 * @param permissionManager 权限管理器实例
 * @param governanceManager 治理管理器实例
 * @param useGovernance 是否启用治理闭环
 * @param useHooks 是否启用Hook系统
 * @returns 工具执行器实例
 */
export function createToolExecutor(
  permissionManager?: PermissionManager,
  governanceManager?: GovernanceManager,
  useGovernance: boolean = true,
  useHooks: boolean = true
): ToolExecutor {
  return new ToolExecutor(
    permissionManager,
    governanceManager,
    useGovernance,
    useHooks
  );
}
