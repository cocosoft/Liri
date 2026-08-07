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
import { hashCommand } from './ApprovedCommandRegistry';
import { PermissionBehavior, isRuleMatch } from './types/PermissionRule';
import {
  RiskClass,
  inferRiskClass,
  detectChainedCommand,
} from './types/RiskClass';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'permission:checker',
  level: LogLevel.INFO,
});

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
 * P1-2: 交互模式 Inbox 审批提交开关。
 * `PERMISSION_INBOX_APPROVAL_ENABLED` 环境变量控制（默认开启）；
 * 仅作用于非无人值守的 ask 决策路径，无人值守行为不受影响。
 */
export function isInboxApprovalEnabled(): boolean {
  const raw = process.env.PERMISSION_INBOX_APPROVAL_ENABLED;
  if (raw === undefined || raw === '') return true;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

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
    return this._handleDefaultAsk(toolName, input, context);
  }

  /**
   * 提交审批项到 Inbox（风险感知）
   * 根据 RiskClass 决定是自动放行、弹窗确认还是进 Inbox 排队
   */
  private async _handleDefaultAsk(
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    const risk = inferRiskClass(toolName);

    // Shell 链式操作检测：提升风险等级
    if (
      risk === RiskClass.SHELL &&
      typeof input.command === 'string' &&
      detectChainedCommand(input.command)
    ) {
      logger.warn('Shell chain operation detected, elevating risk', {
        toolName,
        command: input.command,
      });
    }

    // 无人值守模式下的降级策略
    try {
      const { unattendedMode } =
        await import('@modules/runtime/UnattendedModeManager.js');
      if (unattendedMode.isUnattended()) {
        switch (risk) {
          case RiskClass.READ:
          case RiskClass.DISCUSS:
            return createAllowDecision(
              'Unattended: auto-allow low-risk operation'
            );
          case RiskClass.WRITE_LOCAL:
          case RiskClass.EXTERNAL:
            if (unattendedMode.shouldAutoApprove()) {
              return createAllowDecision('Unattended: auto-approve write');
            }
            return this._submitToInbox(toolName, input, context, risk);
          case RiskClass.SHELL:
            // Shell 在无人值守下不自动放行，进 Inbox
            return this._submitToInbox(toolName, input, context, risk);
        }
      }
    } catch {
      // UnattendedModeManager 不可用时静默降级
    }

    // 非无人值守：按风险等级处理
    switch (risk) {
      case RiskClass.READ:
      case RiskClass.DISCUSS:
        return createAllowDecision('Low risk: auto-allow');
      case RiskClass.WRITE_LOCAL:
      case RiskClass.EXTERNAL:
      case RiskClass.SHELL:
      default:
        // P1-2: 提交由 PermissionManager.checkPermissionForTool 统一入口触发
        // （submitAskToInbox），此处仅返回 ask 决策
        return createAskDecision(
          `'${toolName}' requires approval (risk: ${risk})`
        );
    }
  }

  /**
   * 提交审批项到 Inbox
   */
  private async _submitToInbox(
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext,
    risk: RiskClass
  ): Promise<PermissionDecision> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      const sessionId = (context as unknown as Record<string, unknown>)
        ?.sessionId as string | undefined;
      if (!sessionId) {
        return createAskDecision(
          `Inbox: no session context for ${toolName}`,
          undefined,
          { submittedToInbox: false }
        );
      }

      const taskId = (context as unknown as Record<string, unknown>)?.taskId as
        | string
        | undefined;

      // P1-2: 命令类工具计算规范化 hash，供批准后写入 ApprovedCommandRegistry（放行缓存）
      const command = typeof input.command === 'string' ? input.command : '';
      const isCommandTool =
        toolName === 'bash' || toolName === 'shell' || toolName === 'command';
      const commandHash =
        isCommandTool && command ? hashCommand(command) : undefined;

      await inboxManager.submit({
        sessionId,
        type: 'approval',
        title: `工具审批: ${toolName}`,
        message: `工具 '${toolName}' 请求执行（风险等级: ${risk}）\n${
          command
            ? `命令: ${command}`
            : `参数: ${JSON.stringify(input).slice(0, 300)}`
        }`,
        options:
          risk === RiskClass.EXTERNAL
            ? ['approve', 'deny', 'standing_rule']
            : ['approve', 'deny'],
        offlineCapable: true,
        source: 'permission',
        metadata: {
          toolName,
          risk,
          taskId,
          commandHash,
          inputPreview: JSON.stringify(input).slice(0, 200),
        },
      });

      logger.info('Tool approval submitted to Inbox', {
        toolName,
        risk,
        sessionId,
        hasCommandHash: !!commandHash,
      });

      return createAskDecision(
        `'${toolName}' queued in Inbox (risk: ${risk}). Awaiting approval.`,
        undefined,
        { submittedToInbox: true, commandHash }
      );
    } catch (err) {
      logger.warn('Failed to submit to Inbox, falling back to ask', {
        toolName,
        error: String(err),
      });
      return createAskDecision(
        `'${toolName}' requires approval (Inbox unavailable)`,
        undefined,
        { submittedToInbox: false }
      );
    }
  }

  /**
   * P1-2: 统一 Inbox 提交入口（唯一提交点）
   *
   * 由 PermissionManager.checkPermissionForTool 在 ask 决策时调用，
   * 内部复用 `_submitToInbox`（含 commandHash 计算与 submittedToInbox 标记）。
   * 无人值守路径不经过此入口，行为不变。
   */
  async submitAskToInbox(
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    const risk = inferRiskClass(toolName);
    return this._submitToInbox(toolName, input, context, risk);
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
