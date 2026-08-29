/**
 * 治理闭环管理器
 * 统一管理工具治理的各个组件（权限、Hook、沙箱）
 */
import {
  GovernanceConfig,
  GovernanceExecutionResult,
  GovernanceEvent,
  GovernanceState,
  ToolExecutionContext,
  createDefaultGovernanceConfig,
} from '../types/GovernanceTypes';
import {
  PermissionManager,
  createPermissionManager,
} from '@modules/permission/PermissionManager';
import { ToolHookManager } from '@modules/hooks/managers/ToolHookManager';
import { SandboxManager } from '@modules/sandbox';
import { ToolFilterManager } from '@modules/tools/ToolFilterManager';
import { ToolRegistry, createToolRegistry } from '@modules/tools/ToolRegistry';
import { Tool } from '@modules/tools/types/Tool';
import { ToolHookContext } from '@modules/hooks/types/ToolHooks';
import {
  GovernanceConfigManager,
  governanceConfigManager,
} from './GovernanceConfigManager';
import {
  GovernanceAuditService,
  governanceAuditService,
  type AuditStatistics,
} from './GovernanceAuditService';
import {
  GovernanceStrategyManager,
  governanceStrategyManager,
} from './GovernanceStrategyManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('governance\managers\GovernanceManager');

/**
 * 治理闭环管理器
 */
export class GovernanceManager {
  private static instance: GovernanceManager;

  private config: GovernanceConfig;
  private state: GovernanceState;
  private permissionManager: PermissionManager;
  private toolHookManager: ToolHookManager;
  private sandboxManager: SandboxManager;
  private toolRegistry: ToolRegistry;
  private toolFilterManager: ToolFilterManager;
  private configManager: GovernanceConfigManager;
  private auditService: GovernanceAuditService;
  private strategyManager: GovernanceStrategyManager;

  private constructor() {
    this.configManager = governanceConfigManager;
    this.auditService = governanceAuditService;
    this.strategyManager = governanceStrategyManager;

    this.config = this.configManager.getConfig();
    this.state = {
      config: this.config,
      activeExecutions: new Map(),
      completedExecutions: new Map(),
      pendingPermissions: new Map(),
    };
    this.permissionManager = createPermissionManager();
    this.toolHookManager = ToolHookManager.getInstance();
    this.sandboxManager = SandboxManager.getInstance();
    this.toolRegistry = createToolRegistry();
    this.toolFilterManager = new ToolFilterManager(this.toolRegistry);

    // 监听配置变化
    this.configManager.on('configEvent', (event) => {
      this.config = this.configManager.getConfig();
      this.state.config = this.config;
    });
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): GovernanceManager {
    if (!GovernanceManager.instance) {
      GovernanceManager.instance = new GovernanceManager();
    }
    return GovernanceManager.instance;
  }

  /**
   * 更新治理配置
   */
  public updateConfig(
    config: Partial<GovernanceConfig>,
    reason?: string
  ): void {
    this.configManager.updateConfig(config, reason);
    this.config = this.configManager.getConfig();
    this.state.config = this.config;
  }

  /**
   * 获取当前配置
   */
  public getConfig(): GovernanceConfig {
    return this.configManager.getConfig();
  }

  /**
   * 检查工具是否可执行
   */
  public async canExecute(
    tool: Tool,
    context: ToolExecutionContext
  ): Promise<{ allowed: boolean; reason?: string }> {
    const events: GovernanceEvent[] = [];

    if (!this.config.enabled) {
      return { allowed: true };
    }

    // 应用策略规则
    const strategyAction = this.strategyManager.applyStrategyRules(tool.name, {
      toolName: tool.name,
      input: context.input,
      permissionMode: context.permissionMode,
    });

    if (strategyAction === 'deny') {
      return { allowed: false, reason: 'Denied by governance strategy' };
    }

    if (this.config.enforcePermission) {
      const permissionDecision = await this.permissionManager.checkPermission(
        tool as unknown as Parameters<
          typeof this.permissionManager.checkPermission
        >[0],
        context.input
      );

      const permissionEvent: GovernanceEvent = {
        type: 'permission_check',
        toolName: tool.name,
        toolUseId: context.toolUseId,
        timestamp: new Date(),
        data: { result: permissionDecision },
      };
      events.push(permissionEvent);
      this.auditService.logEvent(permissionEvent);

      if (permissionDecision.type === 'deny') {
        return {
          allowed: false,
          reason: permissionDecision.reason || 'Permission denied',
        };
      }
    }

    if (this.config.enforceSandbox && this.config.enforceHooks) {
      const hookContext: ToolHookContext = {
        toolName: tool.name,
        toolUseID: context.toolUseId,
        input: context.input,
        permissionMode: context.permissionMode as never,
        abortSignal: context.abortSignal,
      };

      for await (const hookResult of this.toolHookManager.executePreToolUseHooks(
        hookContext
      )) {
        if (hookResult.type === 'hookPermissionResult') {
          if (hookResult.permissionBehavior === 'deny') {
            return {
              allowed: false,
              reason: hookResult.reason || 'Hook denied',
            };
          }
        }
        if (hookResult.type === 'stop') {
          return { allowed: false, reason: 'Hook stopped execution' };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * 执行工具（带治理闭环）
   */
  public async executeWithGovernance(
    tool: Tool,
    context: ToolExecutionContext,
    executeFn: (input: Record<string, unknown>) => Promise<unknown>
  ): Promise<GovernanceExecutionResult> {
    const startTime = Date.now();
    const events: GovernanceEvent[] = [];

    this.state.activeExecutions.set(context.toolUseId, 'validating');

    try {
      this.state.activeExecutions.set(
        context.toolUseId,
        'checking_permissions'
      );

      const canExecuteResult = await this.canExecute(tool, context);

      if (!canExecuteResult.allowed) {
        this.state.activeExecutions.set(context.toolUseId, 'failed');
        const result: GovernanceExecutionResult = {
          success: false,
          error: canExecuteResult.reason,
          durationMs: Date.now() - startTime,
          events,
          violations: [],
          governanceCheck: {
            allowed: false,
            reason: canExecuteResult.reason,
            source: 'permission',
          },
        };

        this.auditService.logExecutionResult(result);
        await this.executeGovernanceAudit(tool, context, result);

        this.state.completedExecutions.set(context.toolUseId, result);
        return result;
      }

      this.state.activeExecutions.set(context.toolUseId, 'executing_hooks');

      const hookContext: ToolHookContext = {
        toolName: tool.name,
        toolUseID: context.toolUseId,
        input: context.input,
        permissionMode: context.permissionMode as never,
        abortSignal: context.abortSignal,
      };

      let finalInput = context.input;

      if (this.config.enforceHooks) {
        for await (const hookResult of this.toolHookManager.executePreToolUseHooks(
          hookContext
        )) {
          if (
            hookResult.type === 'hookUpdatedInput' &&
            hookResult.updatedInput
          ) {
            finalInput = hookResult.updatedInput;
          }
        }
      }

      this.state.activeExecutions.set(context.toolUseId, 'executing');

      let output: unknown;
      try {
        const sandboxResult = await this.sandboxManager.executeWithConstraints(
          async () => executeFn(finalInput),
          {
            timeoutMs: this.config.maxExecutionTimeMs,
            command: finalInput.command as string,
          }
        );

        if (!sandboxResult.success) {
          throw new AppError(
            sandboxResult.error || 'Sandbox execution failed',
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
        }

        output = sandboxResult.data;
      } catch (error) {
        throw error;
      }

      if (this.config.enforceHooks) {
        await this.toolHookManager.executePostToolUseHooks(hookContext, {
          output,
        });
      }

      this.state.activeExecutions.set(context.toolUseId, 'completed');

      const result: GovernanceExecutionResult = {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        events,
        violations: this.sandboxManager.getViolations(),
        governanceCheck: {
          allowed: true,
          source: 'permission',
        },
      };

      this.auditService.logExecutionResult(result);
      await this.executeGovernanceAudit(tool, context, result);

      this.state.completedExecutions.set(context.toolUseId, result);

      return result;
    } catch (error) {
      this.state.activeExecutions.set(context.toolUseId, 'failed');

      if (this.config.enforceHooks) {
        const hookContext: ToolHookContext = {
          toolName: tool.name,
          toolUseID: context.toolUseId,
          input: context.input,
          permissionMode: context.permissionMode as never,
          abortSignal: context.abortSignal,
        };

        await this.toolHookManager.executePostToolUseFailureHooks(hookContext, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const result: GovernanceExecutionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        events,
        violations: this.sandboxManager.getViolations(),
        governanceCheck: {
          allowed: false,
          reason: error instanceof Error ? error.message : String(error),
          source: 'validation',
        },
      };

      this.auditService.logExecutionResult(result);
      await this.executeGovernanceAudit(tool, context, result);

      return result;
    }
  }

  /**
   * 获取执行状态
   */
  public getExecutionStatus(toolUseId: string): string | undefined {
    return this.state.activeExecutions.get(toolUseId);
  }

  /**
   * 获取执行结果
   */
  public getExecutionResult(
    toolUseId: string
  ): GovernanceExecutionResult | undefined {
    return this.state.completedExecutions.get(toolUseId);
  }

  /**
   * 获取治理统计
   */
  public getStats(): {
    activeCount: number;
    completedCount: number;
    violations: Record<string, number>;
    auditStats: AuditStatistics;
  } {
    return {
      activeCount: this.state.activeExecutions.size,
      completedCount: this.state.completedExecutions.size,
      violations: this.sandboxManager.getViolationStats(),
      auditStats: this.auditService.getStatistics(),
    };
  }

  /**
   * 获取子系统管理器
   */
  public getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  public getToolHookManager(): ToolHookManager {
    return this.toolHookManager;
  }

  public getSandboxManager(): SandboxManager {
    return this.sandboxManager;
  }

  public getToolFilterManager(): ToolFilterManager {
    return this.toolFilterManager;
  }

  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  public getConfigManager(): GovernanceConfigManager {
    return this.configManager;
  }

  public getAuditService(): GovernanceAuditService {
    return this.auditService;
  }

  public getStrategyManager(): GovernanceStrategyManager {
    return this.strategyManager;
  }

  /**
   * 获取治理过滤后的工具列表
   * @returns 过滤后的工具列表
   */
  public getGovernedTools(): {
    tools: Tool[];
    filteredTools: Array<{ tool: Tool; reason: string; filterType: string }>;
  } {
    return this.toolFilterManager.getFilteredTools();
  }

  /**
   * 执行治理闭环检查
   * @param tool 工具实例
   * @param context 执行上下文
   * @returns 治理检查结果
   */
  public async executeGovernanceCheck(
    tool: Tool,
    context: ToolExecutionContext
  ): Promise<{
    allowed: boolean;
    reason?: string;
    violations: string[];
  }> {
    const violations: string[] = [];

    // 1. 策略检查
    const strategyAction = this.strategyManager.applyStrategyRules(tool.name, {
      toolName: tool.name,
      input: context.input,
      permissionMode: context.permissionMode,
    });

    if (strategyAction === 'deny') {
      violations.push('Denied by governance strategy');
    }

    // 2. 功能开关检查
    if (this.config.enforceFeatureFlags) {
      const filteredResult = this.toolFilterManager.getFilteredTools();
      const isFiltered = filteredResult.filteredTools.some(
        (f) => f.tool.getInfo().name === tool.getInfo().name
      );

      if (isFiltered) {
        violations.push('Tool filtered by feature flag');
      }
    }

    // 3. 权限检查
    if (this.config.enforcePermission) {
      const permissionResult = await this.permissionManager.checkPermission(
        tool as any,
        context.input
      );
      if (permissionResult.type === 'deny') {
        violations.push(`Permission denied: ${permissionResult.reason}`);
      }
    }

    // 4. 沙箱约束检查
    if (this.config.enforceSandbox && context.input.command) {
      const commandCheck = this.sandboxManager.checkCommand(
        context.input.command as string
      );
      if (!commandCheck.allowed) {
        violations.push(`Sandbox constraint violated: ${commandCheck.reason}`);
      }
    }

    return {
      allowed: violations.length === 0,
      reason: violations.length > 0 ? violations.join('; ') : undefined,
      violations,
    };
  }

  /**
   * 执行治理闭环审计
   * @param tool 工具实例
   * @param context 执行上下文
   * @param result 执行结果
   */
  public async executeGovernanceAudit(
    tool: Tool,
    context: ToolExecutionContext,
    result: GovernanceExecutionResult
  ): Promise<void> {
    // 记录审计事件
    const auditEvent: GovernanceEvent = {
      type: 'governance_audit',
      toolName: tool.getInfo().name,
      toolUseId: context.toolUseId,
      timestamp: new Date(),
      data: {
        success: result.success,
        durationMs: result.durationMs,
        violations: result.violations,
        governanceCheck: result.governanceCheck,
      },
    };

    this.auditService.logEvent(auditEvent);
  }

  /**
   * 重置管理器状态
   */
  public reset(): void {
    this.configManager.reset();
    this.auditService.reset();
    this.strategyManager.reset();

    this.config = this.configManager.getConfig();
    this.state = {
      config: this.config,
      activeExecutions: new Map(),
      completedExecutions: new Map(),
      pendingPermissions: new Map(),
    };
    this.sandboxManager.clearViolations();
  }
}
