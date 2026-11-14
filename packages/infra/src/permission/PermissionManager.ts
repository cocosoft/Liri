/**
 * 权限管理器
 * 负责协调权限模式、权限检查器、拒绝跟踪器等组件，实现权限管理的核心逻辑
 */
import { PermissionChecker, Tool } from './PermissionChecker';
import { RuleManager, RuleContext } from './RuleManager';
import { DenialTracker } from './trackers/DenialTracker';
import { PermissionMode } from './PermissionMode';
import type { PermissionDecision } from './types/PermissionDecision';
import type { PermissionContext } from './types/PermissionContext';
import {
  PermissionBehavior,
  PermissionRuleSource,
} from './types/PermissionRule';
// 多租户 P0 阶段 1：请求级角色由调用方显式传入（P2-6 起 RBAC 按角色并集判定）
import { RuleMatcherPermissionContext } from './utils/RuleMatcher';
import { PermissionHookService } from './PermissionHookService';
import {
  ClassifierManager,
  classifierManager,
} from './classifiers/auto-mode-classifier-manager';
// 2026-10-23（PR-3b，CD05/CD07）：原此处导入 `SandboxIntegration` 的
// `SandboxIntegrationService` / `sandboxIntegrationService` —— 该「沙箱自动放行」为**死接线**
// （`autoAllowIfSandboxed` 硬编码 false 且无配置读取 ⇒ 分支恒不命中），且其"是否需要沙箱"
// 按**工具名 includes** 猜测（CS02 违规）。已由 `sandboxExemption`（S1–S4，信号驱动）取代并删除。
import { getLogger, getOTelTracing } from '@openliri/infra/monitoring';
import { configManager } from '@openliri/infra/config';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { loadAllPermissionSettings } from './permissionsLoader';
// ─── P1 拆分（2026-11-12）：共享面 / 遥测 / 决策主链路 / 模式处理器 / 细粒度判定 ──
import { recordDecisionMetric } from './manager/decisionTelemetry';
import { checkPermissionInner } from './manager/decisionPipeline';
import { checkFineGrainedRules } from './manager/fineGrained';
import { ModeHandlerDeps } from './manager/modeHandlers';
import { resolveInitialPermissionMode } from './manager/moduleScope';
import {
  addRule,
  addRuleString,
  addRules,
  explainPermission,
  getRules,
  getRulesSummary,
  getSettingsRuleEntries,
  loadRules,
  removeRule,
  removeRules,
  resetRules,
  saveRules,
} from './manager/rulesFacade';
import {
  checkPermissionForTool,
  type ToolPermissionCallContext,
  type ToolPermissionResult,
} from './manager/toolPermission';
// 兼容既有深路径消费者（`@openliri/infra/permission/PermissionManager`）：
// `ruleLabel` 已搬到 `manager/moduleScope`，此处保留**同名转出**，导出面不变。
export { ruleLabel } from './manager/moduleScope';


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

    // P1-1（2026-11-04）：`PERMISSION_MODE` 此前全仓无读取点 ⇒ 接成进程默认档
    this.mode = resolveInitialPermissionMode();
    if (this.mode !== PermissionMode.DEFAULT) {
      logger.info(
        `权限模式由 PERMISSION_MODE 设为 ${this.mode}（会话级 setMode 仍可覆盖）`
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
      recordDecisionMetric(toolName, decision.type);
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
   * 检查工具权限（内部实现，决策主链路；P1 拆分，2026-11-12：实现见
   * `./manager/decisionPipeline` —— 钩子优先 → 五档分派 → 重试升级 → 审计）
   * @param toolOrName 工具对象或工具名称
   * @param input 工具输入
   * @param context 权限上下文（可选）
   * @returns 权限决策
   */
  private async checkPermissionInner(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context?: PermissionContext,
    forceAskReason?: string
  ): Promise<PermissionDecision> {
    return checkPermissionInner(
      {
        mode: this.mode,
        toolPermissionContext: this.toolPermissionContext,
        permissionHookService: this.permissionHookService,
        denialTracker: this.denialTracker,
        modeHandlerDeps: this.modeHandlerDeps(),
      },
      toolOrName,
      input,
      context,
      forceAskReason
    );
  }

  // ─── 模式处理器（P1 拆分，2026-11-12：实现见 `./manager/modeHandlers`）───────────
  /**
   * 构建处理器依赖（每次调用按**当前**实例状态取，语义与拆分前逐字一致）。
   * 刻意不缓存：`setMode` / `addRule` 等可随时改动实例状态。
   */
  private modeHandlerDeps(): ModeHandlerDeps {
    return {
      ruleManager: this.ruleManager,
      denialTracker: this.denialTracker,
      classifierManager: this.classifierManager,
      messages: this.messages,
      defaultBehavior: this.defaultBehavior,
      permissionChecker: this.permissionChecker,
      checkFineGrainedRules: (toolName, userId, roles, sessionId) =>
        this.checkFineGrainedRules(toolName, userId, roles, sessionId),
    };
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
   * 添加权限规则（P1 拆分，2026-11-12：实现见 `./manager/rulesFacade`）
   *
   * LRO-07（2026-10-26）：**落盘来源必须是 `ruleStore`**（详见 `rulesFacade.addRule`）。
   */
  addRule(
    behavior: PermissionBehavior,
    toolName: string,
    contentPattern?: string
  ): void {
    addRule(this.ruleManager, behavior, toolName, contentPattern);
  }

  /** 移除权限规则 */
  removeRule(ruleId: string): void {
    removeRule(this.ruleManager, ruleId);
  }

  /** 获取所有权限规则 */
  getRules(): any[] {
    return getRules(this.ruleManager);
  }

  /**
   * PR-2（2026-10-23）：settings 文件来源的权限规则（**只读视图**，供合并展示）。
   * 背景与只读约束见 `rulesFacade.getSettingsRuleEntries`。
   */
  getSettingsRuleEntries(): Array<{
    behavior: PermissionBehavior;
    toolName: string;
    contentPattern?: string;
    source: PermissionRuleSource;
  }> {
    return getSettingsRuleEntries(this.toolPermissionContext);
  }

  /**
   * 重置拒绝跟踪
   */
  resetDenialTracker(): void {
    this.denialTracker.reset();
  }

  /**
   * 细粒度 RBAC（D 体系）规则判定（P1 拆分，2026-11-12：实现见 `./manager/fineGrained`）
   * @see checkFineGrainedRules 语义与安全排序说明（deny > ask > allow、fail-closed）
   */
  private async checkFineGrainedRules(
    toolName: string,
    userId: string | undefined,
    effectiveRoles: string[],
    sessionId?: string
  ): Promise<{
    deny?: PermissionDecision;
    ask?: PermissionDecision;
    allow?: PermissionDecision;
  }> {
    return checkFineGrainedRules(
      { denialTracker: this.denialTracker },
      toolName,
      userId,
      effectiveRoles,
      sessionId
    );
  }

  /**
   * 重置所有规则（清空内存和持久化文件；实现见 `./manager/rulesFacade`）
   */
  resetRules(): void {
    this.toolPermissionContext = resetRules(this.ruleManager);
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

  /** 添加规则字符串到指定来源（实现见 `./manager/rulesFacade`） */
  addRuleString(
    behavior: PermissionBehavior,
    source: PermissionRuleSource,
    ruleString: string
  ): void {
    addRuleString(this.toolPermissionContext, behavior, source, ruleString);
  }

  /** 保存权限规则 */
  saveRules(): void {
    saveRules(this.ruleManager);
  }

  /** 加载权限规则 */
  loadRules(): void {
    loadRules(this.ruleManager);
  }

  /** 批量添加权限规则（兼容ToolManager接口；实现见 `./manager/rulesFacade`） */
  addRules(
    rules: any[],
    behavior: 'allow' | 'deny' | 'ask',
    source?: string
  ): void {
    addRules(this.ruleManager, rules, behavior, source);
  }

  /** 批量移除权限规则（兼容ToolManager接口；实现见 `./manager/rulesFacade`） */
  removeRules(
    rules: any[],
    behavior: 'allow' | 'deny' | 'ask',
    source?: string
  ): void {
    removeRules(this.ruleManager, rules, behavior, source);
  }

  /** 获取规则摘要（兼容ToolManager接口；实现见 `./manager/rulesFacade`） */
  getRulesSummary(): {
    total: number;
    allow: number;
    deny: number;
    ask: number;
  } {
    return getRulesSummary(this.ruleManager);
  }

  /** 解释权限决策（兼容ToolManager接口；实现见 `./manager/rulesFacade`） */
  explainPermission(
    toolName: string,
    input: Record<string, unknown> = {}
  ): string {
    return explainPermission(this.ruleManager, this.mode, toolName, input);
  }

  /**
   * 检查工具权限（兼容ToolManager接口；P1 拆分，2026-11-12：实现见 `./manager/toolPermission`）
   * @param toolName 工具名称
   * @param input 输入参数
   * @returns 工具权限检查结果
   */
  async checkPermissionForTool(
    toolName: string,
    input: Record<string, unknown> = {},
    context?: ToolPermissionCallContext
  ): Promise<ToolPermissionResult> {
    return checkPermissionForTool(
      {
        mode: this.mode,
        permissionChecker: this.permissionChecker,
        checkPermission: (toolOrName, toolInput, permissionContext, reason) =>
          this.checkPermission(
            toolOrName,
            toolInput,
            permissionContext,
            reason
          ),
      },
      toolName,
      input,
      context
    );
  }
}

/**
 * 创建权限管理器实例
 * @returns 权限管理器实例
 */
export function createPermissionManager(): PermissionManager {
  return new PermissionManager();
}

/**
 * 查询**持久化规则**是否放行某次工具调用（2026-11-07 真机：命令级白名单批了不生效）。
 *
 * 背景：审批卡「加入命令白名单 / 工具白名单」写入 `tool_rules.json`（A 体系），由
 * `PermissionChecker` 消费；但 bash 的**安全闸 ask** 独立于权限层，只看 `bypassAsk`
 * （命令哈希缓存）⇒ 规则命中也照样弹卡（真机：批准 `^node -e.*` 后同一命令仍弹卡）。
 * 工具层据此把「规则已放行」折算成 `bypassAsk` —— 只免审批交互，硬拦截一条不少。
 *
 * 事实源 = `PermissionManager` 单例（`inboxApproval` 写规则用的同一实例）。
 * 读取失败 ⇒ `false`（不得因读不到规则而放宽，fail-closed）。
 */
export function isCallAllowedByPersistedRules(
  toolName: string,
  input: Record<string, unknown>,
  /** 测试可注入（生产缺省 = 单例的 checker；与审批写规则同一实例） */
  checker?: Pick<PermissionChecker, 'isToolAllowed'>,
  /** G3：本次调用所处的工作区根（命令级「本工作区永久信任」规则据此过滤） */
  workspaceRoots?: string[]
): boolean {
  try {
    const target = checker ?? PermissionManager.getInstance().getPermissionChecker();
    return target.isToolAllowed(toolName, {
      input,
      workspaceRoots,
    } as PermissionContext);
  } catch {
    // @ignore-catch — 规则不可读仅影响"是否免审批"，硬拦截层照旧执行
    return false;
  }
}
