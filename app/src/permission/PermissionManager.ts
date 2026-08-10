/**
 * 权限管理器
 * 负责协调权限模式、权限检查器、拒绝跟踪器等组件，实现权限管理的核心逻辑
 */
import {
  PermissionChecker,
  Tool,
  isInboxApprovalEnabled,
  checkCommandCustomRules,
} from './PermissionChecker';
import { RuleManager, RuleContext } from './RuleManager';
import { DenialTracker } from './trackers/DenialTracker';
import { PermissionMode } from './PermissionMode';
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
import { logSecurityAuditEvent, truncateCommand } from '@modules/security';
import type { SecurityAuditEvent } from '@modules/security';
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
import { PermissionHookService } from './PermissionHookService';
import type {
  PermissionHookContext,
  PermissionHookDecision,
} from './types/PermissionHook';
import {
  ClassifierManager,
  classifierManager,
} from './classifiers/auto-mode-classifier-manager';
import {
  SandboxIntegrationService,
  sandboxIntegrationService,
} from './SandboxIntegration';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';
import { SpanStatusCode, metrics } from '@opentelemetry/api';
import type { Span, Counter } from '@opentelemetry/api';
import { PermissionAction, OperationType, RoleType } from './Permission';
import { createFineGrainedPermissionManager } from './FineGrainedPermissionManager';
import { permissionMetrics } from './metrics/PermissionMetricsStore';

const logger = getLogger('permission:manager');

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
   * 默认行为（无规则匹配时）：allow = 默认放行（现状兼容）；deny = fail-closed（P0-2）
   * 通过环境变量 PERMISSION_DEFAULT_BEHAVIOR 配置（值为 'deny' 时收窄，默认 'allow'）
   */
  private defaultBehavior: 'allow' | 'deny' = 'allow';

  /**
   * 当前认证用户角色（E↔A 打通，演进项）
   * 由 auth 层登录时注入（setCurrentUserRole）；为 null 时行为与以往完全一致。
   * 非 null 时，D 体系（FineGrained）中该角色的 deny 规则优先于工具决策（角色 deny 优先）。
   */
  private currentUserRole: string | null = null;

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

    // P0-2：读取默认行为配置（fail-closed 路径：PERMISSION_DEFAULT_BEHAVIOR=deny）
    const configuredDefault = configManager
      .env('PERMISSION_DEFAULT_BEHAVIOR', 'allow')
      ?.toLowerCase();
    this.defaultBehavior = configuredDefault === 'deny' ? 'deny' : 'allow';
    if (this.defaultBehavior === 'deny') {
      logger.warn(
        '权限默认行为已配置为 deny（fail-closed），无规则匹配的工具将被拒绝'
      );
    }

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
   * 检查工具权限（Otel 插桩入口：span + 决策计数）
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
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;

    // Otel span：每次权限决策可观测（OTel 未初始化时 noop 兜底，不影响主链路）
    let span: Span | null = null;
    try {
      span = getOTelTracing().startSpan('permission.check', {
        tool: toolName,
        mode: this.mode,
      });
    } catch {
      // @ignore-catch: OTel 未初始化时跳过插桩
    }

    try {
      const decision = await this.checkPermissionInner(
        toolOrName,
        input,
        context
      );
      if (span) {
        span.setAttribute('decision', String(decision.type));
        getOTelTracing().endSpan(span, SpanStatusCode.OK);
      }
      this.recordDecisionMetric(toolName, decision.type);
      return decision;
    } catch (error) {
      if (span) {
        getOTelTracing().recordError(
          span,
          error instanceof Error ? error : new Error(String(error))
        );
        getOTelTracing().endSpan(span, SpanStatusCode.ERROR);
      }
      throw error;
    }
  }

  /**
   * 检查工具权限（内部实现，决策主链路）
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文（可选）
   * @returns 权限决策
   */
  private async checkPermissionInner(
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
      let decision: PermissionDecision;
      if (hookDecision.behavior === 'allow') {
        decision = createAllowDecision(
          hookDecision.message || 'Allowed by permission hook'
        );
      } else if (hookDecision.behavior === 'deny') {
        this.denialTracker.trackDenial(toolName);
        decision = createDenyDecision(
          hookDecision.message || 'Denied by permission hook'
        );
      } else {
        decision = createAskDecision(
          hookDecision.message || 'Ask requested by permission hook'
        );
      }
      this.auditDecision(decision, toolName, input);
      return decision;
    }

    // 2. 检查沙箱自动允许
    if (this.sandboxIntegrationService.canAutoAllowInSandbox(toolName, input)) {
      const decision = createAllowDecision('Auto-allowed in sandbox');
      this.auditDecision(decision, toolName, input);
      return decision;
    }

    // 3. 根据权限模式执行不同的检查逻辑
    let decision: PermissionDecision;
    switch (this.mode) {
      case PermissionMode.BYPASS:
        decision = this.handleBypassPermissions();
        break;
      case PermissionMode.DONT_ASK:
        decision = await this.handleDontAsk(
          toolOrName,
          input,
          permissionContext
        );
        break;
      case PermissionMode.ASK:
        decision = await this.handleAsk(toolOrName, input, permissionContext);
        break;
      case PermissionMode.ALWAYS_ASK:
        decision = await this.handleAlwaysAsk(
          toolOrName,
          input,
          permissionContext
        );
        break;
      case PermissionMode.PLAN:
        decision = await this.handlePlan(toolOrName, input, permissionContext);
        break;
      case PermissionMode.AUTO:
        decision = await this.handleAuto(
          toolOrName,
          input,
          permissionContext,
          ruleContext
        );
        break;
      case PermissionMode.DEFAULT:
      default:
        decision = await this.handleDefault(
          toolOrName,
          input,
          permissionContext,
          ruleContext
        );
        break;
    }

    this.auditDecision(decision, toolName, input);
    return decision;
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
   * OTel 决策计数器（惰性初始化；Meter 未就绪时 noop 兜底）
   */
  private decisionCounter: Counter | null = null;

  /**
   * 确保决策计数器已创建
   */
  private ensureDecisionCounter(): void {
    if (this.decisionCounter) return;
    try {
      this.decisionCounter = metrics
        .getMeter('liri-permission')
        .createCounter('Liri.permission.decisions', {
          description: '权限决策计数（allow/deny/ask）',
        });
    } catch {
      // @ignore-catch: metrics 未初始化时不启用计数
    }
  }

  /**
   * 记录权限决策指标（每次决策 +1）
   * @param toolName 工具名称
   * @param type 决策类型
   */
  private recordDecisionMetric(
    toolName: string,
    type: PermissionDecisionType
  ): void {
    this.ensureDecisionCounter();
    this.decisionCounter?.add(1, {
      decision: String(type),
      tool: toolName,
    });
    permissionMetrics.record('decision', {
      decision: String(type),
      tool: toolName,
    });
  }

  /**
   * OTel 角色 deny 计数器（惰性初始化；Meter 未就绪时 noop 兜底）
   */
  private roleDenyCounter: Counter | null = null;

  /**
   * 确保角色 deny 计数器已创建
   */
  private ensureRoleDenyCounter(): void {
    if (this.roleDenyCounter) return;
    try {
      this.roleDenyCounter = metrics
        .getMeter('liri-permission')
        .createCounter('Liri.permission.role_denies', {
          description: '角色规则权限拒绝次数（tool+role 维度）',
        });
    } catch {
      // @ignore-catch: metrics 未初始化时不启用计数
    }
  }

  /**
   * 记录角色 deny 指标（每次角色规则拒绝 +1）
   * @param toolName 工具名称
   * @param role 角色名
   */
  private recordRoleDeny(toolName: string, role: string): void {
    this.ensureRoleDenyCounter();
    this.roleDenyCounter?.add(1, {
      tool: toolName,
      role,
    });
    permissionMetrics.record('role_deny', { tool: toolName, role });
  }

  /**
   * 审计权限决策：将每次权限决策记录到安全审计日志
   * @param decision 权限决策
   * @param toolName 工具名称
   * @param input 工具输入
   */
  private auditDecision(
    decision: PermissionDecision,
    toolName: string,
    input: Record<string, unknown>
  ): void {
    try {
      const command = (input.command as string) || toolName;
      const event: SecurityAuditEvent = {
        timestamp: new Date(),
        command,
        originalCommand: command,
        truncatedResult: truncateCommand(command),
        sessionContext: {
          sessionId: 'permission-manager',
          taskDescription: decision.reason,
          currentMode: 'auto',
        },
        matchedRules: decision.rule ? [String(decision.rule)] : [],
        behavior:
          decision.type === PermissionDecisionType.ALLOW
            ? 'allow'
            : decision.type === PermissionDecisionType.DENY
              ? 'deny'
              : 'ask',
        decision:
          decision.type === PermissionDecisionType.ALLOW
            ? 'auto_allowed'
            : decision.type === PermissionDecisionType.DENY
              ? 'auto_denied'
              : 'pending',
        // P0-2：默认放行（无规则匹配空转）标记为高危，便于发现权限空转
        riskLevel:
          decision.type === PermissionDecisionType.DENY ||
          decision.reason === 'No matching rules, default allowing'
            ? 'high'
            : 'medium',
      };
      logSecurityAuditEvent(event);
    } catch (err) {
      // 审计日志异常不应影响主流程
    }
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

    // 检查安全工具白名单
    if (this.classifierManager.isAllowlistedTool(toolName)) {
      return createAllowDecision('Tool is on safe allowlist');
    }

    // 使用新的规则管理器检查
    const denyRule = this.ruleManager.getDenyRuleForTool(toolName, ruleContext);
    if (denyRule) {
      this.denialTracker.trackDenial(toolName);
      return createDenyDecision(`Denied by rule from ${denyRule.source}`);
    }

    // E↔A 打通（演进项）：当前认证角色存在时，D 体系角色 deny 规则优先（角色 deny 优先）
    if (this.currentUserRole) {
      const roleDeny = await this.checkFineGrainedRoleDeny(toolName, input);
      if (roleDeny) return roleDeny;
    }

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）—
    // 黑名单命中 deny；whitelist 模式命中 allow（覆盖工具级 ask 规则，实现"白名单免审批"）
    if (
      (toolName === 'bash' || toolName === 'shell' || toolName === 'command') &&
      typeof input.command === 'string'
    ) {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) return cmdDecision;
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

    // 没有规则匹配，按默认行为决定（P0-2：PERMISSION_DEFAULT_BEHAVIOR=deny 时 fail-closed）
    if (this.defaultBehavior === 'deny') {
      return createDenyDecision('No matching rules, default denying');
    }
    return createAllowDecision('No matching rules, default allowing');
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

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）— 与 handleDefault 一致
    if (
      (toolName === 'bash' || toolName === 'shell' || toolName === 'command') &&
      typeof input.command === 'string'
    ) {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) return cmdDecision;
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
      await handleError(error, {
        module: 'permission:manager',
        action: 'classifier_check',
      });
      // 分类器出错时，回退到允许
      return createAllowDecision('Classifier error, default allowing');
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
   * 设置当前认证用户角色（E↔A 打通，演进项）
   * 由 auth 层登录/登出时调用；传 null 清除（恢复默认行为）。
   */
  setCurrentUserRole(role: string | null): void {
    this.currentUserRole = role;
    logger.info('permission:currentUserRole', { role });
  }

  /**
   * 获取当前认证用户角色
   */
  getCurrentUserRole(): string | null {
    return this.currentUserRole;
  }

  /**
   * E↔A 打通：查询 D 体系（FineGrained）中当前角色的 deny 规则
   * 工具以 Tool 类型资源参与决策（resourceId = toolName, operation = execute）。
   * 直接按角色查询 storage（D 的 checkPermission 依赖 userId→roles，无 userId 时恒按 guest，
   * 故此处按 currentUserRole 精确匹配角色规则）。
   * 返回 deny 决策或 null（未配置/未命中 → 继续走 A 规则）。
   */
  private async checkFineGrainedRoleDeny(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionDecision | null> {
    try {
      const storage = createFineGrainedPermissionManager().getStorage();
      const roleObj = await storage.getRoleByName(
        this.currentUserRole as RoleType
      );
      if (!roleObj) return null;

      const roleRules = [
        ...roleObj.permissions,
        ...(await storage.getRulesByRole(roleObj.id)),
      ];
      const denyRule = roleRules.find(
        (r) =>
          r.action === PermissionAction.DENY &&
          (r.operation === OperationType.ALL ||
            r.operation === OperationType.EXECUTE) &&
          r.resourceId === toolName
      );
      if (denyRule) {
        this.denialTracker.trackDenial(toolName);
        this.recordRoleDeny(toolName, roleObj.name);
        return createDenyDecision(
          `Denied by role rule: ${denyRule.id} (${roleObj.name})`
        );
      }
    } catch (error) {
      // 角色规则查询失败不应阻塞主决策链路（fail-open 于 A 规则）
      void handleError(error, {
        module: 'permission:manager',
        action: 'check_role_rule',
      });
    }
    return null;
  }

  /**
   * 重置所有规则（清空内存和持久化文件）
   */
  resetRules(): void {
    this.ruleManager.clearRules();
    this.toolPermissionContext = {
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
    };
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
    input: Record<string, unknown> = {},
    context?: Pick<PermissionContext, 'sessionId' | 'userId' | 'metadata'>
  ): Promise<{
    allowed: boolean;
    decision?: {
      behavior: PermissionBehavior;
      updatedInput?: any;
      reason?: string;
    };
    reason?: string;
    /** P1-2: 审批卡片是否已由 PermissionChecker 提交到 Inbox */
    submittedToInbox?: boolean;
    /** P1-2: 命令类工具的规范化 hash（批准后写入放行缓存） */
    commandHash?: string;
  }> {
    // P1-2: 构造完整 PermissionContext（补 toolName/input），透传 sessionId 供统一提交
    const permissionContext = createPermissionContext({
      toolName,
      input,
      sessionId: context?.sessionId,
      userId: context?.userId,
      metadata: context?.metadata,
    });
    const decision = await this.checkPermission(
      toolName,
      input,
      permissionContext
    );

    // P1-2: ask 决策统一提交 Inbox 审批卡片（唯一提交点，开关控制，避免重复提交）。
    // 提交成功 → 决策携带 submittedToInbox:true + commandHash，供上层返回 awaiting_approval；
    // 提交失败/开关关闭 → 保留原 ask 决策（上层降级为 ask 文本）。
    if (
      decision.type === PermissionDecisionType.ASK &&
      decision.context?.submittedToInbox !== true &&
      isInboxApprovalEnabled()
    ) {
      try {
        const submittedDecision = await this.permissionChecker.submitAskToInbox(
          toolName,
          input,
          permissionContext
        );
        return this._checkPermissionForToolResult(submittedDecision, toolName);
      } catch (err) {
        logger.warn('Failed to submit ask decision to Inbox', {
          toolName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return this._checkPermissionForToolResult(decision, toolName);
  }

  /** P1-2: 归一化 checkPermissionForTool 返回结构（含 submittedToInbox/commandHash） */
  private _checkPermissionForToolResult(
    decision: PermissionDecision,
    toolName: string
  ): {
    allowed: boolean;
    decision?: {
      behavior: PermissionBehavior;
      updatedInput?: any;
      reason?: string;
    };
    reason?: string;
    submittedToInbox?: boolean;
    commandHash?: string;
  } {
    const allowed = decision.type === 'allow';
    const submittedToInbox = decision.context?.submittedToInbox === true;
    const commandHash =
      typeof decision.context?.commandHash === 'string'
        ? (decision.context.commandHash as string)
        : undefined;
    return {
      allowed,
      decision: {
        behavior: decision.type as unknown as PermissionBehavior,
        updatedInput: undefined,
        reason: decision.reason,
      },
      reason: decision.reason,
      submittedToInbox,
      commandHash,
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
