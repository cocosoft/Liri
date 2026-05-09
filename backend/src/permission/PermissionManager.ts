//
/**
 * 权限管理器
 * 负责协调权限模式、权限检查器、拒绝跟踪器等组件，实现权限管理的核心逻辑
 */
import { PermissionChecker, Tool } from './checkers/PermissionChecker';
import { RuleManager, RuleContext } from './managers/RuleManager';
import { DenialTracker } from './trackers/DenialTracker';
import { PermissionMode } from './types/PermissionMode';
import {
  PermissionDecision,
  PermissionDecisionType,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
  isAllowDecision,
  isDenyDecision,
  isAskDecision,
} from './types/PermissionDecision';
import {
  PermissionContext,
  createPermissionContext,
} from './types/PermissionContext';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
} from './types/PermissionRule';
import {
  ToolPermissionContext,
  getAllowRules,
  getDenyRules,
  getAskRules,
  toolAlwaysAllowedRule,
  getDenyRuleForTool,
  getAskRuleForTool,
  matchRules,
} from './utils/RuleMatcher';
import { PermissionHookService } from './services/PermissionHookService';
import type {
  PermissionHookContext,
  PermissionHookDecision,
} from './types/PermissionHook';
import {
  ClassifierManager,
  classifierManager,
} from './classifiers/AutoModeClassifier';
import {
  SandboxIntegrationService,
  sandboxIntegrationService,
} from './sandbox/SandboxIntegration';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 权限管理器类
 */
export class PermissionManager {
  private static instance: PermissionManager;
  /**
   * 权限模式（默认DEFAULT）
   */
  private mode: PermissionMode = PermissionMode.DEFAULT;

  /**
   * 权限检查器
   */
  private permissionChecker: PermissionChecker;

  /**
   * 拒绝跟踪器
   */
  private denialTracker: DenialTracker;

  /**
   * 规则管理器
   */
  private ruleManager: RuleManager;

  /**
   * 权限钩子服务
   */
  private permissionHookService: PermissionHookService;

  /**
   * 分类器管理器
   */
  private classifierManager: ClassifierManager;

  /**
   * 沙箱集成服务
   */
  private sandboxIntegrationService: SandboxIntegrationService;

  /**
   * 对话历史
   */
  private messages: Array<{ role: string; content: string }> = [];

  /**
   * 获取单例实例
   */
  public static getInstance(): PermissionManager {
    if (!PermissionManager.instance) {
      PermissionManager.instance = new PermissionManager();
    }
    return PermissionManager.instance;
  }

  /**
   * 构造函数
   */
  constructor() {
    this.ruleManager = new RuleManager();
    this.permissionChecker = new PermissionChecker(this.ruleManager);
    this.denialTracker = new DenialTracker();
    this.permissionHookService = PermissionHookService.getInstance();
    this.classifierManager = classifierManager;
    this.sandboxIntegrationService = sandboxIntegrationService;

    // 加载权限规则
    this.ruleManager.loadRules();
  }

  /**
   * 工具权限上下文
   */
  private toolPermissionContext: ToolPermissionContext = {
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
  };

  /**
   * 检查工具权限
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文（可选）
   * @returns 权限决策
   */
  async checkPermission(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context?: PermissionContext
  ): Promise<PermissionDecision> {
    // 获取工具名称
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 创建权限上下文
    const permissionContext =
      context ||
      createPermissionContext({
        toolName,
        input,
      });

    // 创建规则上下文
    const ruleContext: RuleContext = {
      alwaysAllowRules: this.toolPermissionContext.alwaysAllowRules,
      alwaysDenyRules: this.toolPermissionContext.alwaysDenyRules,
      alwaysAskRules: this.toolPermissionContext.alwaysAskRules,
    };

    // 1. 执行权限钩子
    const hookDecision = await this.executePermissionHooks(
      toolName,
      input,
      permissionContext
    );
    if (hookDecision) {
      if (hookDecision.behavior === 'allow') {
        return createAllowDecision(
          hookDecision.message || 'Allowed by permission hook'
        );
      } else if (hookDecision.behavior === 'deny') {
        this.denialTracker.trackDenial(toolName);
        return createDenyDecision(
          hookDecision.message || 'Denied by permission hook'
        );
      } else if (hookDecision.behavior === 'ask') {
        return createAskDecision(
          hookDecision.message || 'Ask requested by permission hook'
        );
      }
    }

    // 2. 检查沙箱自动允许
    if (this.sandboxIntegrationService.canAutoAllowInSandbox(toolName, input)) {
      return createAllowDecision('Auto-allowed in sandbox');
    }

    // 3. 根据权限模式执行不同的检查逻辑
    switch (this.mode) {
      case PermissionMode.BYPASS_PERMISSIONS:
        return this.handleBypassPermissions();
      case PermissionMode.DONT_ASK:
        return this.handleDontAsk(toolOrName, input, permissionContext);
      case PermissionMode.ASK:
        return this.handleAsk(toolOrName, input, permissionContext);
      case PermissionMode.ALWAYS_ASK:
        return this.handleAlwaysAsk(toolOrName, input, permissionContext);
      case PermissionMode.PLAN:
        return this.handlePlan(toolOrName, input, permissionContext);
      case PermissionMode.AUTO:
        return this.handleAuto(
          toolOrName,
          input,
          permissionContext,
          ruleContext
        );
      case PermissionMode.DEFAULT:
      default:
        return this.handleDefault(
          toolOrName,
          input,
          permissionContext,
          ruleContext
        );
    }
  }

  /**
   * 执行权限钩子
   * @param toolName 工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 钩子决策或null
   */
  private async executePermissionHooks(
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionHookDecision | null> {
    const hookContext: PermissionHookContext = {
      toolName,
      toolUseID: '',
      input,
      permissionMode: this.mode,
      context,
      abortSignal: undefined,
    };

    return await this.permissionHookService.executeHooks(hookContext);
  }

  /**
   * 处理绕过权限检查模式
   * @returns 权限决策
   */
  private handleBypassPermissions(): PermissionDecision {
    return createAllowDecision('Bypassing permissions check');
  }

  /**
   * 处理不询问模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  private async handleDontAsk(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 检查工具是否被允许
    if (this.permissionChecker.isToolAllowed(toolOrName, context)) {
      return createAllowDecision('Tool is allowed by permission rule');
    }

    // 跟踪拒绝
    this.denialTracker.trackDenial(toolName);

    // 检查是否应该询问用户
    if (this.denialTracker.shouldAsk(toolName)) {
      return createAskDecision('Too many denials, asking user');
    }

    return createDenyDecision('Dont ask mode, denying permission');
  }

  /**
   * 处理询问模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  private async handleAsk(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    return createAskDecision('Ask mode, requiring user approval');
  }

  /**
   * 处理总是询问模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  private async handleAlwaysAsk(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    return createAskDecision('Always ask mode, requiring user approval');
  }

  /**
   * 处理默认模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @param ruleContext 规则上下文
   * @returns 权限决策
   */
  private async handleDefault(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    ruleContext?: RuleContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 使用新的规则管理器检查
    const denyRule = this.ruleManager.getDenyRuleForTool(toolName, ruleContext);
    if (denyRule) {
      this.denialTracker.trackDenial(toolName);
      return createDenyDecision(`Denied by rule from ${denyRule.source}`);
    }

    const askRule = this.ruleManager.getAskRuleForTool(toolName, ruleContext);
    if (askRule) {
      return createAskDecision(`Asked by rule from ${askRule.source}`);
    }

    const allowRule = this.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      return createAllowDecision(`Allowed by rule from ${allowRule.source}`);
    }

    // 检查内容模式规则
    const matchingDenyRule = this.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.DENY,
      ruleContext
    );
    if (matchingDenyRule) {
      this.denialTracker.trackDenial(toolName);
      return createDenyDecision(
        `Denied by rule from ${matchingDenyRule.source}`
      );
    }

    const matchingAskRule = this.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ASK,
      ruleContext
    );
    if (matchingAskRule) {
      return createAskDecision(`Asked by rule from ${matchingAskRule.source}`);
    }

    const matchingAllowRule = this.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ALLOW,
      ruleContext
    );
    if (matchingAllowRule) {
      return createAllowDecision(
        `Allowed by rule from ${matchingAllowRule.source}`
      );
    }

    // 没有规则匹配，默认询问
    return createAskDecision('No matching rules, requiring user approval');
  }

  /**
   * 处理计划模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @returns 权限决策
   */
  private async handlePlan(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    // 计划模式下，只记录工具使用，不执行
    return createAskDecision('Plan mode, requiring user approval');
  }

  /**
   * 处理自动模式
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文
   * @param ruleContext 规则上下文
   * @returns 权限决策
   */
  private async handleAuto(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    ruleContext?: RuleContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // 1. 检查安全工具白名单
    if (this.classifierManager.isAllowlistedTool(toolName)) {
      this.denialTracker.trackSuccess(toolName);
      return createAllowDecision('Tool is on safe allowlist');
    }

    // 2. 检查规则
    const denyRule = this.ruleManager.getDenyRuleForTool(toolName, ruleContext);
    if (denyRule) {
      this.denialTracker.trackDenial(toolName);

      if (this.denialTracker.shouldAsk(toolName)) {
        return createAskDecision('Too many denials, asking user');
      }

      return createDenyDecision(`Denied by rule from ${denyRule.source}`);
    }

    const askRule = this.ruleManager.getAskRuleForTool(toolName, ruleContext);
    if (askRule) {
      return createAskDecision(`Asked by rule from ${askRule.source}`);
    }

    const allowRule = this.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      this.denialTracker.trackSuccess(toolName);
      return createAllowDecision(`Allowed by rule from ${allowRule.source}`);
    }

    // 3. 使用自动分类器
    try {
      const classifierDecision = await this.classifierManager.classify(
        toolName,
        input,
        this.messages
      );

      if (classifierDecision.shouldBlock) {
        this.denialTracker.trackDenial(toolName);

        if (this.denialTracker.shouldAsk(toolName)) {
          return createAskDecision(
            `${classifierDecision.reason} - Too many denials, asking user`
          );
        }

        return createDenyDecision(
          classifierDecision.reason || 'Blocked by auto classifier'
        );
      } else {
        this.denialTracker.trackSuccess(toolName);
        return createAllowDecision(
          classifierDecision.reason || 'Allowed by auto classifier'
        );
      }
    } catch (error) {
      logger.error('Auto classifier error:', { error });
      // 分类器出错时，回退到询问
      return createAskDecision('Classifier error, requiring user approval');
    }
  }

  /**
   * 设置权限模式
   * @param mode 权限模式
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * 获取权限模式
   * @returns 权限模式
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * 添加权限规则
   * @param behavior 权限行为
   * @param toolName 工具名称
   * @param contentPattern 内容模式（可选）
   */
  addRule(
    behavior: PermissionBehavior,
    toolName: string,
    contentPattern?: string
  ): void {
    const rule = createPermissionRule({
      behavior,
      toolName,
      contentPattern,
    });
    this.ruleManager.addRule(rule);
  }

  /**
   * 移除权限规则
   * @param ruleId 规则ID
   */
  removeRule(ruleId: string): void {
    const rule = this.ruleManager.getRuleById(ruleId);
    if (rule) {
      this.ruleManager.removeRule(rule);
    }
  }

  /**
   * 获取所有权限规则
   * @returns 权限规则数组
   */
  getRules(): any[] {
    return this.ruleManager.getRules();
  }

  /**
   * 重置拒绝跟踪
   */
  resetDenialTracker(): void {
    this.denialTracker.reset();
  }

  /**
   * 获取拒绝跟踪器
   * @returns 拒绝跟踪器
   */
  getDenialTracker(): DenialTracker {
    return this.denialTracker;
  }

  /**
   * 获取权限检查器
   * @returns 权限检查器
   */
  getPermissionChecker(): PermissionChecker {
    return this.permissionChecker;
  }

  /**
   * 获取规则管理器
   * @returns 规则管理器
   */
  getRuleManager(): RuleManager {
    return this.ruleManager;
  }

  /**
   * 获取权限钩子服务
   * @returns 权限钩子服务
   */
  getPermissionHookService(): PermissionHookService {
    return this.permissionHookService;
  }

  /**
   * 获取分类器管理器
   * @returns 分类器管理器
   */
  getClassifierManager(): ClassifierManager {
    return this.classifierManager;
  }

  /**
   * 获取沙箱集成服务
   * @returns 沙箱集成服务
   */
  getSandboxIntegrationService(): SandboxIntegrationService {
    return this.sandboxIntegrationService;
  }

  /**
   * 添加消息到对话历史
   * @param role 角色
   * @param content 内容
   */
  addMessage(role: string, content: string): void {
    this.messages.push({ role, content });
  }

  /**
   * 清空对话历史
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * 从规则上下文加载规则
   * @param context 规则上下文
   */
  loadRulesFromContext(context: RuleContext): void {
    this.ruleManager.loadFromContext(context);
  }

  /**
   * 设置工具权限上下文
   * @param context 工具权限上下文
   */
  setToolPermissionContext(context: ToolPermissionContext): void {
    this.toolPermissionContext = context;
  }

  /**
   * 获取工具权限上下文
   * @returns 工具权限上下文
   */
  getToolPermissionContext(): ToolPermissionContext {
    return this.toolPermissionContext;
  }

  /**
   * 添加规则字符串到指定来源
   * @param behavior 规则行为
   * @param source 规则来源
   * @param ruleString 规则字符串
   */
  addRuleString(
    behavior: PermissionBehavior,
    source: PermissionRuleSource,
    ruleString: string
  ): void {
    const key =
      behavior === PermissionBehavior.ALLOW
        ? 'alwaysAllowRules'
        : behavior === PermissionBehavior.DENY
          ? 'alwaysDenyRules'
          : 'alwaysAskRules';

    if (!this.toolPermissionContext[key][source]) {
      this.toolPermissionContext[key][source] = [];
    }

    this.toolPermissionContext[key][source]!.push(ruleString);
  }

  /**
   * 保存权限规则
   */
  saveRules(): void {
    this.ruleManager.saveRules(this.ruleManager.getRules());
  }

  /**
   * 加载权限规则
   */
  loadRules(): void {
    this.ruleManager.loadRules();
  }

  /**
   * 批量添加权限规则（兼容ToolManager接口）
   * @param rules 权限规则数组
   * @param behavior 权限行为
   * @param source 规则来源
   */
  addRules(
    rules: any[],
    behavior: 'allow' | 'deny' | 'ask',
    source?: string
  ): void {
    for (const rule of rules) {
      const toolName = rule.name || rule.toolName;
      if (toolName) {
        this.addRule(
          behavior as PermissionBehavior,
          toolName,
          rule.contentPattern
        );
      }
    }
  }

  /**
   * 批量移除权限规则（兼容ToolManager接口）
   * @param rules 权限规则数组
   * @param behavior 权限行为
   * @param source 规则来源
   */
  removeRules(
    rules: any[],
    behavior: 'allow' | 'deny' | 'ask',
    source?: string
  ): void {
    for (const rule of rules) {
      const toolName = rule.name || rule.toolName;
      if (toolName) {
        const existingRules = this.ruleManager.getRules();
        const ruleToRemove = existingRules.find(
          (r) => r.toolName === toolName && r.behavior === behavior
        );
        if (ruleToRemove) {
          this.ruleManager.removeRule(ruleToRemove);
        }
      }
    }
  }

  /**
   * 获取规则摘要（兼容ToolManager接口）
   * @returns 规则摘要信息
   */
  getRulesSummary(): {
    total: number;
    allow: number;
    deny: number;
    ask: number;
  } {
    const rules = this.ruleManager.getRules();
    let allow = 0;
    let deny = 0;
    let ask = 0;
    for (const rule of rules) {
      switch (rule.behavior) {
        case 'allow':
          allow++;
          break;
        case 'deny':
          deny++;
          break;
        case 'ask':
          ask++;
          break;
      }
    }
    return { total: rules.length, allow, deny, ask };
  }

  /**
   * 解释权限决策（兼容ToolManager接口）
   * @param toolName 工具名称
   * @param input 输入参数
   * @returns 权限解释字符串
   */
  explainPermission(
    toolName: string,
    input: Record<string, unknown> = {}
  ): string {
    const rules = this.ruleManager.getRules();
    const toolRules = rules.filter((r) => r.toolName === toolName);
    if (toolRules.length > 0) {
      const rule = toolRules[0];
      return `Permission for '${toolName}': ${rule.behavior}${rule.contentPattern ? ` - Pattern: ${rule.contentPattern}` : ''}`;
    }
    return `No explicit rule for '${toolName}', default behavior: ${this.mode}`;
  }

  /**
   * 检查工具权限（兼容ToolManager接口）
   * @param toolName 工具名称
   * @param input 输入参数
   * @returns 工具权限检查结果
   */
  async checkPermissionForTool(
    toolName: string,
    input: Record<string, unknown> = {}
  ): Promise<{
    allowed: boolean;
    decision?: {
      behavior: PermissionBehavior;
      updatedInput?: any;
      reason?: string;
    };
    reason?: string;
  }> {
    const decision = await this.checkPermission(toolName, input);
    const allowed = decision.type === 'allow';
    return {
      allowed,
      decision: {
        behavior: decision.type as unknown as PermissionBehavior,
        updatedInput: undefined,
        reason: decision.reason,
      },
      reason: decision.reason,
    };
  }
}

/**
 * 创建权限管理器实例
 * @returns 权限管理器实例
 */
export function createPermissionManager(): PermissionManager {
  return new PermissionManager();
}
