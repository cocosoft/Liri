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
// LRO-D1（2026-10-26）：指纹规则的匹配维度 —— 与审批落盘**同一摘要**（`hashApprovalFingerprint(resolveApprovalFingerprint(...))`）
import { resolveApprovalFingerprint } from './approvalFingerprint';
import { hashApprovalFingerprint } from './ApprovedCommandRegistry';
import { DenialTracker } from './trackers/DenialTracker';
import { PermissionMode } from './PermissionMode';
import {
  PermissionDecision,
  PermissionDecisionType,
  PermissionDenyInfo,
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
import { resolveRiskClass } from './types/RiskClass';
import {
  PermissionBehavior,
  PermissionRuleSource,
  createPermissionRule,
  permissionRuleValueFromString,
} from './types/PermissionRule';
import { logSecurityAuditEvent, truncateCommand } from '@modules/security';
// 多租户 P0 阶段 1：请求级角色优先、缺失回退进程级（纯函数，零依赖）
import { resolveEffectiveRole } from '@openliri/kernel/identity/principal.js';
// 语义护栏「便宜版」（2026-10-21）：规则化意图-动作偏离检查（纯函数）
import { feature } from '@openliri/kernel';
import { detectIntentActionDeviation } from '@modules/utils/toolContract/intentActionDeviation';
// PR-3a（2026-10-23）：沙箱上下文信号（执行入口注入，审批卡留证用）
import type { SandboxExecutionSignal } from '@modules/utils/toolContract/Tool';
import { isShellToolName } from '@modules/utils/toolContract/toolRoles';
import type { SecurityAuditEvent } from '@modules/security';
import {
  RuleMatcherPermissionContext,
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
// 2026-10-23（PR-3b，CD05/CD07）：原此处导入 `SandboxIntegration` 的
// `SandboxIntegrationService` / `sandboxIntegrationService` —— 该「沙箱自动放行」为**死接线**
// （`autoAllowIfSandboxed` 硬编码 false 且无配置读取 ⇒ 分支恒不命中），且其"是否需要沙箱"
// 按**工具名 includes** 猜测（CS02 违规）。已由 `sandboxExemption`（S1–S4，信号驱动）取代并删除。
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';
import { SpanStatusCode, metrics } from '@opentelemetry/api';
import type { Span, Counter } from '@opentelemetry/api';
import { PermissionAction, OperationType, RoleType } from './Permission';
import { createFineGrainedPermissionManager } from './FineGrainedPermissionManager';
import { permissionMetrics } from './metrics/PermissionMetricsStore';
import { loadAllPermissionSettings } from './permissionsLoader';

const logger = getLogger('permission:manager');

/**
 * P0-3（2026-10-27，权限归一化）：三处"静默放行"的可观测去重状态。
 * - `defaultAllowWarnedTools`：`defaultBehavior=allow` 无规则命中（按工具去重，避免刷屏）
 * - `bypassObservabilityLogged`：`bypass` 模式无条件放行（进程内只记一次）
 */
const defaultAllowWarnedTools = new Set<string>();
let bypassObservabilityLogged = false;

/**
 * LRO-07（2026-10-26）：规则拒绝时告诉调用方「这条规则怎么解除」。
 *
 * 为什么必须有：deny 文案此前只写来源（且来源还被伪造成 `userSettings`），既没给出
 * 「去哪删」也没给出「删哪条」⇒ 用户只能翻盘，模型只会重复同一个被拒调用
 * （真机实测：`file_write` 连续 6 次全被拒，元数据里连 ruleId 都没有）。
 *
 * 分档依据是**真实可删性**：`ruleStore`（`tool_rules.json`）可经面板 / API 删除；
 * settings 来源是配置文件维护的只读视图，只能改文件。
 */
function resolveRuleRemovalHint(
  ruleId: string | undefined,
  source: string | undefined
): string {
  if (source === PermissionRuleSource.RULE_STORE) {
    return ruleId
      ? `在「设置 → 权限管理 → 工具权限规则」删除该规则，或 DELETE /v1/permissions/rules/${ruleId}`
      : '在「设置 → 权限管理 → 工具权限规则」删除对应规则';
  }
  if (source) {
    return `在设置文件的 permissions 段修改（来源 ${source} 由配置文件维护，面板不可删除）`;
  }
  return '在「设置 → 权限管理 → 工具权限规则」删除对应规则';
}

/**
 * LRO-07（2026-10-26）：把 deny 决策的 `context` 收敛成**跨层 DTO**。
 *
 * 只搬运真实存在且为字符串的字段（缺省不臆造）；没有任何可回传字段 ⇒ `undefined`
 * （避免给上层一个空对象冒充"有依据"）。
 */
function buildDenyInfo(
  context: Record<string, unknown> | undefined
): PermissionDenyInfo | undefined {
  if (!context) return undefined;
  const info: PermissionDenyInfo = {};
  if (typeof context.ruleId === 'string') info.ruleId = context.ruleId;
  if (typeof context.sourceKind === 'string') {
    info.sourceKind = context.sourceKind;
  }
  if (typeof context.inputFingerprint === 'string') {
    info.inputFingerprint = context.inputFingerprint;
  }
  if (typeof context.removableVia === 'string') {
    info.removableVia = context.removableVia;
  }
  if (context.matchScope === 'tool' || context.matchScope === 'fingerprint') {
    info.matchScope = context.matchScope;
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

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

    // 2026-10-07 接线：settings 文件（user / project / local）的 `permissions.allow|deny|ask`
    // 此前**整体未接线**（`loadAllPermissionSettings` 零消费者）⇒ 用户写进 settings 的权限规则
    // 不生效。现并入决策上下文（来源优先级见 `PERMISSION_RULE_SOURCES`：
    // user < project < local < policy）。
    // 失败安全：加载器内部逐来源 try/catch（`handleError`），读取失败仅告警、不阻断启动。
    const settingsContext = loadAllPermissionSettings();
    this.toolPermissionContext = {
      alwaysAllowRules: settingsContext.alwaysAllowRules,
      alwaysDenyRules: settingsContext.alwaysDenyRules,
      alwaysAskRules: settingsContext.alwaysAskRules,
    };
  }

  /**
   * 工具权限上下文
   */
  private toolPermissionContext: RuleMatcherPermissionContext = {
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
    context?: PermissionContext,
    /**
     * R07-3（2026-10-07）：非幂等工具「重试」理由。提供 ⇒ 把**本该放行**的决策升级为 `ask`
     * （见 `checkPermissionInner` 的模式豁免与 `non-idempotent-retry-approval.md` D2/D4）。
     */
    forceAskReason?: string
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
        context,
        forceAskReason
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
    context?: PermissionContext,
    /** R07-3（2026-10-07）：非幂等工具「重试」理由（见本方法末的模式豁免升级） */
    forceAskReason?: string
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

    // 2. 根据权限模式执行不同的检查逻辑
    // （2026-10-23 PR-3b：原「沙箱自动允许」分支已删除 —— 死接线 + 按工具名猜；）
    // （其职责由 `PermissionChecker` 风险默认档前的沙箱豁免 S1–S4 承担。）
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

    // R07-3（2026-10-07）：非幂等工具「重试」⇒ 把**本该放行**的调用升级为 `ask`（审批）。
    // 复用既有 ask⇒Inbox 通路（本方法调用方 `checkPermissionForTool` 提交卡片）⇒ 不新建审批机制。
    // - D4：**只升级 `allow`** ⇒ `deny` 永不被削弱（安全姿态单调）；
    // - D2：`bypass` / `dontAsk` 是用户/自动化**显式**"不要打断"（无人值守依赖），不覆盖
    //   —— 否则无人值守流程会永久挂在 `awaiting_approval`。
    if (
      forceAskReason &&
      decision.type === PermissionDecisionType.ALLOW &&
      this.mode !== PermissionMode.BYPASS &&
      this.mode !== PermissionMode.DONT_ASK
    ) {
      decision = createAskDecision(forceAskReason);
      logger.info('permission:non_idempotent_retry_escalated', {
        tool: toolName,
        mode: this.mode,
      });
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
    // P0-3（2026-10-27，权限归一化）：bypass 无条件放行且**不查 killswitch**
    // （`BypassPermissionsKillswitch` 在决策链零调用点）。此处只加可观测，不改语义。
    if (!bypassObservabilityLogged) {
      bypassObservabilityLogged = true;
      logger.warn('权限模式为 bypass：无条件放行且未校验 killswitch', {
        reasonCode: 'bypass_no_killswitch',
      });
    }
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
   * 规则拒绝的**统一出口**（LRO-09 步骤 2，2026-10-26）。
   *
   * 为什么单独抽：此前两处 deny 只回 `Denied by rule from <source>`，而 `<source>` 是
   * `RuleManager.parseRuleString()` 的**硬编码默认值**（`userSettings`），真实来源是
   * `tool_rules.json` ⇒ 用户按提示去 `settings.json` 里找永远找不到（2026-10-26 实测）。
   * 现在把 **ruleId + 解除入口**一并带出（文案 + 决策上下文 + 结构化日志；LRO-07）。
   */
  private _denyByRule(
    toolName: string,
    rule:
      | { id?: string; source?: string; inputFingerprint?: string }
      | undefined,
    /**
     * F5（2026-10-27）：**本次调用**的指纹摘要（`hashApprovalFingerprint(...)`）。
     * 与 `rule.inputFingerprint` 并列落日志，才能区分"指纹级命中"与"工具级命中"
     * —— 真机曾出现「一条 deny 笼罩整个 file_write」的误判（Liri 报告 R4）。
     */
    callFingerprint?: string
  ): PermissionDecision {
    const ruleId = rule?.id;
    const source = rule?.source;
    const marker = ruleId ? ` [rule=${ruleId}]` : '';
    const from = source ? ` from ${source}` : '';
    const removableVia = resolveRuleRemovalHint(ruleId, source);
    // 命中维度：规则带指纹 ⇒ 指纹级（只管该参数组合）；否则工具级（管整个工具）
    const matchScope = rule?.inputFingerprint ? 'fingerprint' : 'tool';
    logger.warn('permission:deny', {
      toolName,
      ruleId,
      ruleSource: source,
      fingerprint: rule?.inputFingerprint,
      callFingerprint,
      matchScope,
      removableVia,
    });
    return createDenyDecision(
      `Denied by rule${from}${marker}（解除：${removableVia}）`,
      rule,
      {
        ruleId,
        toolName,
        inputFingerprint: rule?.inputFingerprint,
        callFingerprint,
        matchScope,
        sourceKind: source,
        removableVia,
      }
    );
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
      return this._denyByRule(toolName, denyRule);
    }

    // E↔A 打通（演进项）：当前认证角色存在时，D 体系角色 deny 规则优先（角色 deny 优先）
    // 多租户 P0 阶段 1：**请求级角色优先**（context.userRole），缺失才回退进程级 currentUserRole
    // ⇒ 未传请求级角色的调用方行为与改造前完全一致（桌面端零变更）
    const effectiveRole = resolveEffectiveRole(
      context.userRole,
      this.currentUserRole
    );
    if (effectiveRole) {
      const roleDeny = await this.checkFineGrainedRoleDeny(
        toolName,
        input,
        effectiveRole
      );
      if (roleDeny) return roleDeny;
    }

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）—
    // 黑名单命中 deny；whitelist 模式命中 allow（覆盖工具级 ask 规则，实现"白名单免审批"）
    if (isShellToolName(toolName) && typeof input.command === 'string') {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) return cmdDecision;
    }

    // LRO-D1（2026-10-26）：**内容级 / 指纹级 deny 必须先于一切 ask / allow 评估**。
    // 原顺序把"工具级 ask / 工具级 allow"排在内容 deny 之前 ⇒ 一条「始终允许此工具」
    // 会静默越过针对该工具的内容 deny（安全排序不对称）。
    // 指纹摘要与审批落盘**同源**：`hashApprovalFingerprint(resolveApprovalFingerprint(...))`。
    const approvalFingerprint = hashApprovalFingerprint(
      resolveApprovalFingerprint(toolOrName, input)
    );
    const matchOptions = { fingerprint: approvalFingerprint };

    const matchingDenyRule = this.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.DENY,
      ruleContext,
      matchOptions
    );
    if (matchingDenyRule) {
      this.denialTracker.trackDenial(toolName);
      return this._denyByRule(toolName, matchingDenyRule, approvalFingerprint);
    }

    const askRule = this.ruleManager.getAskRuleForTool(toolName, ruleContext);
    if (askRule) {
      return createAskDecision(`Asked by rule from ${askRule.source}`);
    }

    const matchingAskRule = this.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ASK,
      ruleContext,
      matchOptions
    );
    if (matchingAskRule) {
      return createAskDecision(`Asked by rule from ${matchingAskRule.source}`);
    }

    const allowRule = this.ruleManager.toolAlwaysAllowedRule(
      toolName,
      ruleContext
    );
    if (allowRule) {
      return createAllowDecision(`Allowed by rule from ${allowRule.source}`);
    }

    const matchingAllowRule = this.ruleManager.getMatchingRule(
      toolName,
      input,
      PermissionBehavior.ALLOW,
      ruleContext,
      matchOptions
    );
    if (matchingAllowRule) {
      return createAllowDecision(
        `Allowed by rule from ${matchingAllowRule.source}`
      );
    }

    // 语义护栏「便宜版」（2026-10-21）：意图-动作偏离 ⇒ 升级为 ask（**不直接拒绝**）。
    // 位置在所有显式规则之后、默认行为之前 —— 用户显式 allow/deny/ask 规则始终优先。
    if (feature('INTENT_ACTION_DEVIATION_GUARD')) {
      const goalText =
        typeof context.metadata?.['goalText'] === 'string'
          ? (context.metadata['goalText'] as string)
          : undefined;
      const deviation = detectIntentActionDeviation({
        ...(goalText !== undefined ? { goalText } : {}),
        toolName,
        input,
      });
      if (deviation.deviated && deviation.reason) {
        return createAskDecision(deviation.reason);
      }
    }

    // 没有规则匹配，按默认行为决定（P0-2：PERMISSION_DEFAULT_BEHAVIOR=deny 时 fail-closed）
    if (this.defaultBehavior === 'deny') {
      return createDenyDecision('No matching rules, default denying');
    }
    // P0-3（2026-10-27，权限归一化）：`defaultBehavior='allow'` 属"无规则即放行"，
    // 是与 fail-closed 相反的默认；按**工具**去重记一次，便于统计"权限空转"面。
    if (!defaultAllowWarnedTools.has(toolName)) {
      defaultAllowWarnedTools.add(toolName);
      logger.warn('权限默认放行（无规则匹配，defaultBehavior=allow）', {
        reasonCode: 'default_allow',
        toolName,
      });
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

      return this._denyByRule(toolName, denyRule);
    }

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）— 与 handleDefault 一致
    if (isShellToolName(toolName) && typeof input.command === 'string') {
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
      // P0-3（2026-10-27，权限归一化）：分类器异常是**fail-open** —— 必须留痕，
      // 否则"安全组件坏了 ⇒ 全部放行"在日志里看不出来。
      logger.warn('权限分类器异常，按放行处理（fail-open）', {
        reasonCode: 'classifier_fail_open',
        toolName,
        error: error instanceof Error ? error.message : String(error),
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
   *
   * LRO-07（2026-10-26）：**落盘来源必须是 `ruleStore`**。此前走 `createPermissionRule`
   * 的默认值 `userSettings` ⇒ `tool_rules.json` 里的规则全被标成「用户设置」，
   * deny 文案随之指错地方（磁盘上没有 settings.json）。这里显式标注真实来源。
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
      source: PermissionRuleSource.RULE_STORE,
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
   * PR-2（2026-10-23）：settings 文件来源的权限规则（**只读视图**，供合并展示）。
   *
   * 背景（方案 §3.7.2）：工具规则有两条来源 —— 运行期 `tool_rules.json`（可写）与
   * settings `permissions.{allow,ask,deny}`（手工维护，启动时并入决策上下文）。
   * `GET /v1/permissions/rules` 必须同时返回两者并标注 `source`，否则 UI 与用户认知不一致
   * （用户在 settings 里写了 allow，面板却显示"默认"）。
   *
   * 本方法只读；写入口仍是 `tool_rules.json`（单一写路径）。
   */
  getSettingsRuleEntries(): Array<{
    behavior: PermissionBehavior;
    toolName: string;
    contentPattern?: string;
    source: PermissionRuleSource;
  }> {
    const ctx = this.toolPermissionContext as unknown as {
      alwaysAllowRules: Record<PermissionRuleSource, string[]>;
      alwaysDenyRules: Record<PermissionRuleSource, string[]>;
      alwaysAskRules: Record<PermissionRuleSource, string[]>;
    };
    return [
      ...[
        [PermissionBehavior.ALLOW, ctx.alwaysAllowRules] as const,
        [PermissionBehavior.DENY, ctx.alwaysDenyRules] as const,
        [PermissionBehavior.ASK, ctx.alwaysAskRules] as const,
      ].flatMap(([behavior, record]) =>
        Object.entries(record ?? {}).flatMap(([source, list]) =>
          (list ?? []).map((raw) => {
            const value = permissionRuleValueFromString(raw);
            return {
              behavior,
              toolName: value.toolName,
              contentPattern: value.ruleContent,
              source: source as PermissionRuleSource,
            };
          })
        )
      ),
    ];
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
   * E↔A 打通：查询 D 体系（FineGrained）中**本次请求生效角色**的 deny 规则
   * 工具以 Tool 类型资源参与决策（resourceId = toolName, operation = execute）。
   * 直接按角色查询 storage（D 的 checkPermission 依赖 userId→roles，无 userId 时恒按 guest，
   * 故此处按 effectiveRole 精确匹配角色规则）。
   * 返回 deny 决策或 null（未配置/未命中 → 继续走 A 规则）。
   *
   * 多租户 P0 阶段 1：角色由**调用方显式传入**（`context.userRole ?? currentUserRole`），
   * 方法内不再读进程级字段 ⇒ 并发请求各自判定、互不覆盖。
   */
  private async checkFineGrainedRoleDeny(
    toolName: string,
    input: Record<string, unknown>,
    effectiveRole: string
  ): Promise<PermissionDecision | null> {
    try {
      const storage = createFineGrainedPermissionManager().getStorage();
      const roleObj = await storage.getRoleByName(effectiveRole as RoleType);
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
  setToolPermissionContext(context: RuleMatcherPermissionContext): void {
    this.toolPermissionContext = context;
  }

  /**
   * 获取工具权限上下文
   * @returns 工具权限上下文
   */
  getToolPermissionContext(): RuleMatcherPermissionContext {
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
    context?: Pick<
      PermissionContext,
      | 'sessionId'
      | 'userId'
      | 'userRole'
      | 'metadata'
      | 'approvalMode'
      | 'workspacePath'
    > & {
      /**
       * PR-3a（2026-10-23）：本次执行的沙箱上下文（由执行入口注入）。
       * 仅供审批卡留证；**不参与** allow/ask/deny 判定（豁免判定在 PR-3b）。
       */
      sandbox?: SandboxExecutionSignal;
      /**
       * R07-3（2026-10-07）：非幂等工具「重试」理由（由调用方判定后传入）。
       * 提供 ⇒ 本该放行的决策升级为 `ask` ⇒ 走下方既有 Inbox 提交通路（见 `checkPermissionInner`）。
       */
      forceAskReason?: string;
      /**
       * PR-0（2026-10-23）：工具对象。提供 ⇒ 风险按**声明式**派生
       * （`riskClass`/`riskClassFor`/`TOOL_EFFECTS`/`sandboxLevel`）；
       * 缺省 ⇒ 回退已弃用的名字启发式（仅过渡，行为零变更）。
       */
      tool?: Tool;
    }
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
    /** U-06-5: 已提交的 Inbox 项 id（前端工具卡片就地审批用） */
    inboxItemId?: string;
    /**
     * LRO-07（2026-10-26）：规则拒绝的**结构化**依据（ruleId / sourceKind /
     * inputFingerprint / removableVia）。此前它只存在 `decision.context`，
     * 归一化时被截断 ⇒ 工具结果拿不到「哪条规则、怎么解除」。
     */
    denyInfo?: PermissionDenyInfo;
  }> {
    // P1-2: 构造完整 PermissionContext（补 toolName/input），透传 sessionId 供统一提交
    const permissionContext = createPermissionContext({
      toolName,
      input,
      sessionId: context?.sessionId,
      userId: context?.userId,
      // 多租户 P0 阶段 2：请求级角色透传（缺失 ⇒ handleDefault 回退进程级 currentUserRole）
      userRole: context?.userRole,
      metadata: context?.metadata,
      // PR-3：会话级审批模式与工作区边界（缺失 ⇒ 与改造前一致：ask + 无自动放行）
      approvalMode: context?.approvalMode,
      workspacePath: context?.workspacePath,
      // PR-3a：沙箱信号（缺失 ⇒ undefined，审批卡不写该字段 ⇒ 视为"未沙箱"）
      sandbox: context?.sandbox,
    });
    const decision = await this.checkPermission(
      context?.tool ?? toolName,
      input,
      permissionContext,
      context?.forceAskReason
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
          permissionContext,
          resolveRiskClass(context?.tool ?? toolName, input),
          context?.tool
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
    inboxItemId?: string;
    denyInfo?: PermissionDenyInfo;
  } {
    const allowed = decision.type === 'allow';
    const submittedToInbox = decision.context?.submittedToInbox === true;
    const commandHash =
      typeof decision.context?.commandHash === 'string'
        ? (decision.context.commandHash as string)
        : undefined;
    const inboxItemId =
      typeof decision.context?.inboxItemId === 'string'
        ? (decision.context.inboxItemId as string)
        : undefined;
    // LRO-07：DENY 才回传结构化依据（ask/allow 的 context 里有别的字段，不可混用）
    const denyInfo =
      decision.type === PermissionDecisionType.DENY
        ? buildDenyInfo(decision.context)
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
      inboxItemId,
      denyInfo,
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
