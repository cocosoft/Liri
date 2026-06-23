/**
 * 权限检查器
 * 负责检查工具的权限，包括检查工具是否被拒绝、是否需要询问、调用工具的checkPermissions方法等
 */
import { RuleManager } from './RuleManager';
import {
  PermissionDecision,
  PermissionDecisionType,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
} from './types/PermissionDecision';
import { PermissionContext } from './types/PermissionContext';
import { PermissionBehavior, isRuleMatch } from './types/PermissionRule';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 超时自动拒绝配置
 */
export interface AskTimeoutConfig {
  enabled: boolean;
  timeoutMs: number;
  notifyUserOnTimeout: boolean;
}

/** 默认超时配置 */
const DEFAULT_ASK_TIMEOUT: AskTimeoutConfig = {
  enabled: true,
  timeoutMs: 30000,
  notifyUserOnTimeout: true,
};

/**
 * 带有超时的 ASK 决策
 */
export interface AskDecisionWithTimeout {
  decision: PermissionDecision;
  timeoutConfig?: AskTimeoutConfig;
  createdAt: number;
}

/**
 * 工具接口
 */
export interface Tool {
  /**
   * 工具名称
   */
  name: string;

  /**
   * 检查权限
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  checkPermissions?(
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision>;

  /**
   * 是否需要用户交互
   * @param input 工具输入
   * @returns 是否需要用户交互
   */
  requiresUserInteraction?(input: Record<string, unknown>): boolean;
}

/**
 * 权限检查器类
 */
export class PermissionChecker {
  /**
   * 规则管理器
   */
  private ruleManager: RuleManager;

  /**
   * 超时配置
   */
  private askTimeout: AskTimeoutConfig;

  /**
   * 构造函数
   * @param ruleManager 规则管理器
   * @param askTimeout 超时配置（可选）
   */
  constructor(
    ruleManager: RuleManager,
    askTimeout?: Partial<AskTimeoutConfig>
  ) {
    this.ruleManager = ruleManager;
    this.askTimeout = { ...DEFAULT_ASK_TIMEOUT, ...askTimeout };
  }

  /**
   * 创建带有超时追踪的 ASK 决策
   * @param message 提示消息
   * @returns 带有超时元数据的 ASK 决策
   */
  createAskDecisionWithTimeout(message: string): AskDecisionWithTimeout {
    return {
      decision: createAskDecision(message),
      timeoutConfig: this.askTimeout,
      createdAt: Date.now(),
    };
  }

  /**
   * 检查 ASK 决策是否已超时
   * @param askWithTimeout 带有超时的 ASK 决策
   * @returns 是否已超时
   */
  static isAskTimedOut(askWithTimeout: AskDecisionWithTimeout): boolean {
    if (!askWithTimeout.timeoutConfig?.enabled) {
      return false;
    }
    return (
      Date.now() - askWithTimeout.createdAt >=
      askWithTimeout.timeoutConfig.timeoutMs
    );
  }

  /**
   * 将超时的 ASK 决策转换为 DENY 决策
   * @param askWithTimeout 带有超时的 ASK 决策
   * @returns DENY 决策
   */
  static timeoutToDeny(
    askWithTimeout: AskDecisionWithTimeout
  ): PermissionDecision {
    if (askWithTimeout.timeoutConfig?.notifyUserOnTimeout) {
      logger.warn('安全确认超时，操作已自动拒绝', {
        timeoutMs: askWithTimeout.timeoutConfig?.timeoutMs,
        createdAt: new Date(askWithTimeout.createdAt).toISOString(),
      });
    }
    return createDenyDecision('安全确认超时，操作已自动拒绝');
  }

  /**
   * 检查工具权限
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  async checkPermission(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 检查工具是否被完全拒绝
    if (this.isToolDenied(toolOrName, context)) {
      return createDenyDecision('Tool is denied by permission rule');
    }

    // 检查工具是否需要询问
    if (this.isToolAskRequired(toolOrName, context)) {
      return createAskDecision('Tool requires user approval');
    }

    // 调用工具的checkPermissions方法（仅当toolOrName是工具对象时）
    if (
      typeof toolOrName !== 'string' &&
      typeof toolOrName.checkPermissions === 'function'
    ) {
      const toolDecision = await toolOrName.checkPermissions(input, context);
      if (toolDecision.type !== PermissionDecisionType.ALLOW) {
        return toolDecision;
      }
    }

    // 检查工具是否需要用户交互（仅当toolOrName是工具对象时）
    if (
      typeof toolOrName !== 'string' &&
      typeof toolOrName.requiresUserInteraction === 'function' &&
      toolOrName.requiresUserInteraction(input)
    ) {
      return createAskDecision('Tool requires user interaction');
    }

    // 检查内容特定规则
    const contentRuleDecision = this.checkContentSpecificRules(
      toolOrName,
      input,
      context
    );
    if (contentRuleDecision) {
      return contentRuleDecision;
    }

    // 检查安全规则
    const safetyRuleDecision = this.checkSafetyRules(
      toolOrName,
      input,
      context
    );
    if (safetyRuleDecision) {
      return safetyRuleDecision;
    }

    // 检查工具是否被完全允许
    if (this.isToolAllowed(toolOrName, context)) {
      return createAllowDecision('Tool is allowed by permission rule');
    }

    // 默认返回询问
    return createAskDecision('No specific permission rule found');
  }

  /**
   * 检查工具是否被拒绝
   * @param toolOrName 工具对象或工具名称
   * @param context 权限上下文
   * @returns 是否被拒绝
   */
  isToolDenied(toolOrName: Tool | string, context: PermissionContext): boolean {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
    const denyRules = this.ruleManager.getRules(
      undefined,
      PermissionBehavior.DENY
    );
    return denyRules.some((rule) => isRuleMatch(rule, toolName, context.input));
  }

  /**
   * 检查工具是否需要询问
   * @param toolOrName 工具对象或工具名称
   * @param context 权限上下文
   * @returns 是否需要询问
   */
  isToolAskRequired(
    toolOrName: Tool | string,
    context: PermissionContext
  ): boolean {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
    const askRules = this.ruleManager.getRules(
      undefined,
      PermissionBehavior.ASK
    );
    return askRules.some((rule) => isRuleMatch(rule, toolName, context.input));
  }

  /**
   * 检查工具是否被允许
   * @param toolOrName 工具对象或工具名称
   * @param context 权限上下文
   * @returns 是否被允许
   */
  isToolAllowed(
    toolOrName: Tool | string,
    context: PermissionContext
  ): boolean {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
    const allowRules = this.ruleManager.getRules(
      undefined,
      PermissionBehavior.ALLOW
    );
    return allowRules.some((rule) =>
      isRuleMatch(rule, toolName, context.input)
    );
  }

  /**
   * 检查内容特定规则
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策或null
   */
  checkContentSpecificRules(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): PermissionDecision | null {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
    const rules = this.ruleManager.getRules();
    for (const rule of rules) {
      if (isRuleMatch(rule, toolName, input)) {
        switch (rule.behavior) {
          case PermissionBehavior.ALLOW:
            return createAllowDecision(
              `Content-specific rule matched: ${rule.contentPattern}`,
              rule
            );
          case PermissionBehavior.DENY:
            return createDenyDecision(
              `Content-specific rule matched: ${rule.contentPattern}`,
              rule
            );
          case PermissionBehavior.ASK:
            return createAskDecision(
              `Content-specific rule matched: ${rule.contentPattern}`,
              rule
            );
        }
      }
    }
    return null;
  }

  /**
   * 检查安全规则
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策或null
   */
  checkSafetyRules(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): PermissionDecision | null {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 实现安全检查逻辑
    // 例如检查危险命令、文件路径等

    // 检查Bash工具的危险命令
    if (toolName === 'Bash' && input.command) {
      const command = input.command as string;
      const dangerousCommands = [
        'rm -rf',
        'format',
        'mkfs',
        'dd',
        'shutdown',
        'reboot',
      ];

      for (const dangerousCommand of dangerousCommands) {
        if (command.includes(dangerousCommand)) {
          return this.createAskDecisionWithTimeout(
            'Dangerous Bash command detected'
          ).decision;
        }
      }
    }

    // 检查File工具的危险路径
    if (toolName === 'File' && input.path) {
      const path = input.path as string;

      // 检查路径是否包含..
      if (path.includes('..')) {
        return this.createAskDecisionWithTimeout(
          'Potentially unsafe path detected'
        ).decision;
      }

      // 检查路径是否为绝对路径
      if (
        path.startsWith('/') ||
        path.startsWith('\\') ||
        (path.length >= 2 && path[1] === ':')
      ) {
        return this.createAskDecisionWithTimeout('Absolute path detected')
          .decision;
      }
    }

    return null;
  }

  /**
   * 获取规则管理器
   * @returns 规则管理器
   */
  getRuleManager(): RuleManager {
    return this.ruleManager;
  }
}
