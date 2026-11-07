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
import { hashApprovalFingerprint } from './ApprovedCommandRegistry';
import { resolveApprovalFingerprint } from './approvalFingerprint';
// P1（2026-11-04）：审批卡唯一构造点 + 审计②段（①段在构造点内落）
import { buildToolApprovalCard } from './toolApprovalSubmission';
import { emitApprovalAudit } from './approvalAudit';
import {
  findPendingApprovalId,
  type PendingApprovalLookup,
} from './inboxApprovalDedupe';
import { PermissionBehavior, isRuleMatch } from './types/PermissionRule';
import type { RuleMatchOptions } from './types/PermissionRule';
import {
  RiskClass,
  inferRiskClass,
  resolveRiskClass,
  detectChainedCommand,
} from './types/RiskClass';
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { isCommandToolName } from '@openliri/infra/utils/toolContract/toolRoles';
import type { ToolSandboxLevel } from '@openliri/infra/utils/toolContract/Tool';
import { findWorkspaceEscapeInRoots } from '@openliri/infra/utils/toolContract/pathBoundary';
import { PATH_ARG_KEYS } from '@openliri/infra/utils/toolContract/pathArgs';
// P2（§3.3）：会话活跃长程任务（任务档审批选项的可用性判定）
import { getActiveTaskId } from './activeTaskScope';
// PR-3b（2026-10-23）：沙箱豁免判定（纯函数，§3.9.4 S1–S4）
import { resolveSandboxExemption } from './sandboxExemption';
// Q-16（2026-10-23）：命令规则匹配语义（prefix / regex，单点实现，见 utils）
import { matchesAnyCommandRule } from '@openliri/infra/utils/commandRuleMatch';
import { feature } from '@openliri/kernel';
const logger = getLogger('permission:checker');

/**
 * 权限检查器的**运行时依赖**（由入口在启动时注入）——
 * 2026-09-30 台账 D-126（`R00-003` P6-b / G6-b）
 *
 * **为什么注入而非直接导入**：`permission`（**infra**）原**动态导入** `runtime`（**service**）的
 * `unattendedMode` / `inboxManager` ⇒ 构成 `infra -> service` 跨层引用（`R00-003` 盲区）。
 * 改由 **entry** 注入（`service -> infra` **合法**）⇒ **零新增跨层对**。
 * 未注入时相关分支静默降级 —— 与原 `catch {}` 语义一致。
 */
export interface PermissionRuntimeDeps {
  unattendedMode: {
    isUnattended(): boolean;
    shouldAutoApprove(): boolean;
  };
  inboxManager: {
    submit(item: Record<string, unknown>): Promise<unknown>;
    /**
     * PR-1（2026-10-23）：待审批项查询（**提交前去重**用）。缺省 ⇒ 跳过去重（照常建卡）。
     * 真实 `InboxManager` 已实现该方法；测试桩可不提供。
     */
    list?(params?: Record<string, unknown>): Promise<{
      items: Array<{
        id: string;
        status?: string;
        metadata?: Record<string, unknown>;
      }>;
    }>;
  };
  /**
   * PR-3c（2026-10-23）：**自动放行**类决策的审计落盘（可选）。
   *
   * 由**入口**注入（包装 `security/SecurityAuditLogger.logSecurityAuditEvent`）——
   * `permission`（infra）**不**静态导入 `security`：后者又导入 `@modules/permission`，
   * 会形成 `permission → security → permission` 循环（R00-001 视角同层，但运行时是环）。
   * 未注入 ⇒ 仅保留结构化日志（不阻断，CS03）。
   */
  auditAutoAllow?(event: {
    rule: 'approval:sandbox' | 'approval:auto';
    toolName: string;
    risk: string;
    sessionId?: string;
    detail: string;
  }): void;
}

let _runtimeDeps: PermissionRuntimeDeps | null = null;

/** 注入运行时依赖（幂等，入口启动时调用一次） */
export function setPermissionRuntimeDeps(deps: PermissionRuntimeDeps): void {
  _runtimeDeps = deps;
}

/**
 * P1-2: 命令内容级黑白名单决策（「设置→自定义规则」B 体系）。
 *
 * 读取与 BashSecurityAnalyzer 相同的配置 `permission.customRules.commandRules`：
 * - 黑名单命中 → deny（无论模式）
 * - whitelist 模式：白名单命中 → allow（免审批）；未命中 → deny（严格白名单）
 * - blacklist 模式且未命中黑名单 → null（不阻断，交回工具级决策）
 * 配置缺失/异常 → null（不阻断决策，安全底线不变）。
 *
 * **匹配语义（Q-16，2026-10-23 拍板）**：`prefix`（默认）/ `regex` 二选一，
 * 缺省按**前缀**匹配；不再用 `includes`（`echo dir` 不会命中白名单 `dir`）。
 * 语义单点在 `./commandRuleMatch`，与 `BashSecurityAnalyzer` 共用。
 *
 * 由 PermissionChecker.checkPermission 与 PermissionManager.handleDefault/handleAuto 共用，
 * 保证「设置→自定义规则」的命令黑白名单在主决策链路生效。
 */
export function checkCommandCustomRules(
  command: string
): PermissionDecision | null {
  try {
    const permission = configManager.getConfigValue<{
      customRules?: {
        commandRules?: {
          blacklist: Array<{ pattern: string; matchType?: 'prefix' | 'regex' }>;
          whitelist: Array<{ pattern: string; matchType?: 'prefix' | 'regex' }>;
          mode: 'whitelist' | 'blacklist';
        };
      };
    }>('permission');
    const rules = permission?.customRules?.commandRules;
    if (!rules) return null;

    const blacklist = rules.blacklist || [];
    if (matchesAnyCommandRule(command, blacklist)) {
      return createDenyDecision('命令命中自定义黑名单');
    }

    if (rules.mode === 'whitelist') {
      const whitelist = rules.whitelist || [];
      if (matchesAnyCommandRule(command, whitelist)) {
        return createAllowDecision('命令命中自定义白名单');
      }
      return createDenyDecision('命令未命中自定义白名单（whitelist 模式）');
    }

    // blacklist 模式且未命中黑名单 → 正常继续决策
    return null;
  } catch {
    // 配置读取失败不阻断决策，安全底线不变
    return null;
  }
}

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
  const raw = configManager.env('PERMISSION_INBOX_APPROVAL_ENABLED');
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
   * PR-3b（2026-10-23）：沙箱能力声明位（与工具契约同域）。
   * 沙箱豁免（S2）要求工具**显式声明**；缺省/`none` ⇒ 不豁免。
   */
  sandboxLevel?: ToolSandboxLevel;

  /**
   * 文件类工具的**实际落点根**（宿主绝对路径；可选契约，2026-10-23 §12.15）。
   *
   * 为什么需要：`write_project_file` 落在项目 sandbox（不在会话工作区根下），
   * 仅凭 `sandboxLevel` + `fileIoIsolated` 无法证明"这次写"落在隔离环境内。
   * 提供 ⇒ 沙箱豁免的 S4b 额外要求该根被挂载；缺省 ⇒ 不做额外要求（不影响既有工具）。
   */
  resolveFileIoRoot?(input: Record<string, unknown>): string | undefined;

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
 * 归一化**工具侧** `checkPermissions()` 的返回值 → 权限决策（2026-10-23）。
 *
 * 两套契约并存（历史原因）：
 * - 工具契约（`utils/toolContract/Tool.ts`）：`{ behavior: 'allow' | 'deny' | 'ask' }`；
 * - 权限内部契约（`permission/types/PermissionDecision.ts`）：`{ type: 'allow' | 'deny' | 'ask' }`。
 *
 * 修复前直接把工具返回值当决策用 ⇒ `type` 为 `undefined` ⇒ 上层 `allowed=false` 视为**拒绝**。
 * 实证：PR-0 把注册表工具对象（`ToolLazyWrapper`）传进本层后，未覆写 `checkPermissions` 的工具
 * 拿到包装器兜底的 `{ behavior: 'allow' }` ⇒ 正常调用被判"拒绝"（`writeProjectFileIsolation` 用例复现）。
 *
 * 语义：`allow` / 未表态 ⇒ **不短路**（交回正常判定链：内容规则 → 安全规则 → 风险默认档）。
 */
function normalizeToolCheckPermissionsResult(
  raw: { type?: string; behavior?: string; reason?: string } | undefined
): PermissionDecision {
  if (raw && typeof raw.type === 'string') {
    return raw as PermissionDecision;
  }
  const reason = raw?.reason || '';
  switch (raw?.behavior) {
    case 'deny':
      return createDenyDecision(reason || 'Denied by tool checkPermissions');
    case 'ask':
      return createAskDecision(reason || 'Tool requires approval');
    default:
      // `allow` 与"工具未实现该钩子"（包装器兜底）⇒ 不表态
      return createAllowDecision(
        reason || 'Tool checkPermissions: no objection'
      );
  }
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

    // P1-2: 命令内容级黑白名单（「设置→自定义规则」B 体系）参与决策 —
    // 与 BashSecurityAnalyzer 消费同一配置（permission.customRules.commandRules），
    // 黑名单命中 deny、whitelist 模式命中 allow，使 UI 白名单能真正免审批。
    // P1（2026-11-07）：命令类工具扩到 powershell/pwsh —— 此前设置里的命令黑名单/白名单
    // 对 PowerShell 工具完全不生效（用户反馈「只有 bash 接了」）。
    if (isCommandToolName(toolName) && typeof input.command === 'string') {
      const cmdDecision = checkCommandCustomRules(input.command);
      if (cmdDecision) return cmdDecision;
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
      // 工具侧返回 `{behavior}`、本层需要 `{type}` ⇒ 先归一（见 normalizeToolCheckPermissionsResult）
      const toolDecision = normalizeToolCheckPermissionsResult(
        await toolOrName.checkPermissions(input, context)
      );
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
    return this._handleDefaultAsk(toolOrName, input, context);
  }

  /**
   * 提交审批项到 Inbox（风险感知）
   * 根据 RiskClass 决定是自动放行、弹窗确认还是进 Inbox 排队
   *
   * PR-0（2026-10-23）：风险改为**工具声明式**（`resolveRiskClass`）——
   * 传工具对象时按 `riskClass`/`riskClassFor`/`TOOL_EFFECTS`/`sandboxLevel` 派生；
   * 仅传名字的过渡调用方仍走已弃用的 `inferRiskClass`（行为零变更）。
   */
  private async _handleDefaultAsk(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
    const risk = resolveRiskClass(toolOrName, input);
    // 过渡护栏：无人值守的"写/外部自动批准"仍以旧口径排除 shell 类，
    // 防止声明式改造把原本按 shell 对待的工具**放宽**为自动批准。
    const legacyRisk = inferRiskClass(toolName);

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

    // 无人值守模式下的降级策略（运行时依赖由入口注入；未注入 ⇒ 跳过本分支）
    const unattendedMode = _runtimeDeps?.unattendedMode;
    if (unattendedMode?.isUnattended()) {
      switch (risk) {
        case RiskClass.READ:
        case RiskClass.DISCUSS:
          return createAllowDecision(
            'Unattended: auto-allow low-risk operation'
          );
        case RiskClass.WRITE_LOCAL:
        case RiskClass.EXTERNAL:
          if (
            legacyRisk !== RiskClass.SHELL &&
            unattendedMode.shouldAutoApprove()
          ) {
            return createAllowDecision('Unattended: auto-approve write');
          }
          return this._submitToInbox(toolOrName, input, context, risk);
        case RiskClass.SHELL:
        case RiskClass.UNDECLARED:
        default:
          // Shell / 未声明：无人值守下不自动放行，进 Inbox
          return this._submitToInbox(toolOrName, input, context, risk);
      }
    }

    // PR-3（2026-10-23）：会话级自动执行（仅只读 + 本地写）。
    // 只作用于**风险默认档**——前面的 deny / 显式 ask / 用户白名单已各自返回，
    // 因此不会越过任何人工拦截。
    const autoLocal = this._resolveSessionAutoLocal(
      toolName,
      risk,
      input,
      context
    );
    if (autoLocal) return autoLocal;

    // PR-3b（2026-10-23）：沙箱豁免（§3.9.3 第 4 步）—— 只把"风险默认 ask"变 allow。
    // 前面的 deny / 显式 ask / 用户 allow 规则已各自返回 ⇒ 不会越过任何人工拦截。
    const sandboxExempt = this._resolveSandboxExemption(
      toolName,
      toolOrName,
      risk,
      input,
      context
    );
    if (sandboxExempt) return sandboxExempt;

    // 非无人值守：按风险等级处理
    switch (risk) {
      case RiskClass.READ:
      case RiskClass.DISCUSS:
        return createAllowDecision('Low risk: auto-allow');
      case RiskClass.UNDECLARED:
        return createAskDecision(
          `'${toolName}' requires approval (risk: undeclared)`
        );
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
   * PR-3（2026-10-23）：会话级 `auto-local` 的**唯一**自动放行点（审计不可关闭）。
   *
   * 放行条件（全部满足才返回 allow，否则 `null` 交回既有风险默认档）：
   * 1. `FEATURE_SESSION_AUTO_LOCAL` 开启（默认关 ⇒ 零行为变更）；
   * 2. 会话声明 `approvalMode='auto-local'`；
   * 3. 风险级为 `WRITE_LOCAL`（SHELL / EXTERNAL / UNDECLARED 永远人工）；
   * 4. 会话有工作区边界，且入参**至少包含一个路径参数**（无路径语义的写操作不自动放行，
   *    如 `media_delete`）；
   * 5. 全部路径参数都在工作区内（含符号链接展开，复用 `findWorkspaceEscape`）。
   *
   * 审计：`approval:auto`（sessionId / toolName / 风险级 / 依据），不做开关。
   */
  private _resolveSessionAutoLocal(
    toolName: string,
    risk: RiskClass,
    input: Record<string, unknown>,
    context: PermissionContext
  ): PermissionDecision | null {
    if (!feature('SESSION_AUTO_LOCAL')) return null;
    if (context.approvalMode !== 'auto-local') return null;
    if (risk !== RiskClass.WRITE_LOCAL) return null;

    const auditSkip = (reason: string, extra: Record<string, unknown> = {}) => {
      logger.info('approval:auto 跳过', {
        sessionId: context.sessionId,
        toolName,
        risk,
        reason,
        ...extra,
      });
    };

    // P1（2026-11-04，方案 §3.6）：边界判定统一用**工作区根列表**（由执行入口的
    // `resolveRoots` 注入）。灰度口径与执行前严格边界一致：`WORKSPACE_MULTI_ROOT` 关
    // ⇒ 只认单根 `workspacePath`（与改造前逐字一致）；开 ⇒ 任一根之内即视为界内。
    const roots =
      feature('WORKSPACE_MULTI_ROOT') &&
      context.workspaceRoots &&
      context.workspaceRoots.length > 0
        ? context.workspaceRoots
        : context.workspacePath
          ? [context.workspacePath]
          : [];
    if (roots.length === 0) {
      auditSkip('no-workspace');
      return null;
    }
    const hasPathArg = PATH_ARG_KEYS.some(
      (key) => typeof input[key] === 'string' && (input[key] as string).trim()
    );
    if (!hasPathArg) {
      auditSkip('no-path-arg');
      return null;
    }
    const escape = findWorkspaceEscapeInRoots(roots, input);
    if (escape) {
      auditSkip('outside-workspace', {
        argKey: escape.key,
        resolved: escape.resolved,
        via: escape.via,
        roots,
      });
      return null;
    }

    logger.info('approval:auto', {
      sessionId: context.sessionId,
      toolName,
      risk,
      basis: 'auto-local + workspace-bounded write',
      roots,
    });
    // PR-3c（2026-10-23）：同一决策落安全审计通道（可查 / 可统计）
    this._auditAutoAllow(
      'approval:auto',
      toolName,
      risk,
      context,
      'session auto-local: workspace-bounded write'
    );
    return createAllowDecision('Session auto-local: write inside workspace');
  }

  /**
   * PR-3c（2026-10-23）：把**自动放行**类决策交给注入的审计出口。
   *
   * 落点（由入口注入）= `security-audit.log`（`GET /v1/security/audit-logs` 可查；
   * `matchedRules` 标记来源 `approval:sandbox` / `approval:auto`）。
   * 未注入或写入失败 ⇒ 只丢审计、**不影响**放行决策本身（CS03）。
   */
  private _auditAutoAllow(
    rule: 'approval:sandbox' | 'approval:auto',
    toolName: string,
    risk: RiskClass,
    context: PermissionContext,
    detail: string
  ): void {
    try {
      _runtimeDeps?.auditAutoAllow?.({
        rule,
        toolName,
        risk,
        sessionId: context.sessionId,
        detail,
      });
    } catch (err) {
      // 审计失败不得影响放行决策本身（与 logSecurityAuditEvent 的内部降级同口径）
      logger.warn('approval 审计写入失败（已忽略）', {
        rule,
        toolName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * PR-3b（2026-10-23）：沙箱豁免的**唯一调用点**（判定在 `./sandboxExemption` 的纯函数）。
   *
   * 位置语义：位于「deny / 显式 ask / 用户 allow 规则」之后、「风险默认档」之前 ——
   * 即 §3.9.3 的第 4 步，只能把"本来要问"变成"不问"，**永不**越过 deny 或用户显式 ask。
   *
   * 审计：`approval:sandbox`（记录模式 / 权限位 / 工作区），不可关闭。
   */
  private _resolveSandboxExemption(
    toolName: string,
    toolOrName: Tool | string,
    risk: RiskClass,
    input: Record<string, unknown>,
    context: PermissionContext
  ): PermissionDecision | null {
    const result = resolveSandboxExemption({
      signal: context.sandbox,
      risk,
      sandboxLevel:
        typeof toolOrName === 'string' ? undefined : toolOrName.sandboxLevel,
      input,
      workspacePath: context.workspacePath,
      // §12.15：工具**实际落点根**（如 `write_project_file` 的项目 sandbox）——
      // 提供时 S4b 额外要求它被挂载；取不到 ⇒ 不传（不影响既有工具）。
      targetRoot:
        typeof toolOrName === 'string'
          ? undefined
          : toolOrName.resolveFileIoRoot?.(input),
    });
    if (!result.exempt) return null;

    logger.info('approval:sandbox', {
      sessionId: context.sessionId,
      toolName,
      risk,
      mode: context.sandbox?.mode,
      permissionLevel: context.sandbox?.permissionLevel,
      workspace: context.workspacePath,
      basis:
        'S1-S4 satisfied（isolation + capability + permission + workspace）',
    });
    this._auditAutoAllow(
      'approval:sandbox',
      toolName,
      risk,
      context,
      `sandbox exemption: mode=${context.sandbox?.mode} permission=${context.sandbox?.permissionLevel}`
    );
    return createAllowDecision(
      'Sandbox: isolated execution, workspace-bounded'
    );
  }

  /**
   * 提交审批项到 Inbox
   */
  private async _submitToInbox(
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context: PermissionContext,
    risk: RiskClass = inferRiskClass(
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name
    )
  ): Promise<PermissionDecision> {
    const toolName =
      typeof toolOrName === 'string' ? toolOrName : toolOrName.name;
    const inboxManager = _runtimeDeps?.inboxManager;
    if (!inboxManager) {
      // 依赖未注入（启动早期 / 非标准入口）⇒ 降级为 ask（与既有 catch 分支同语义）
      return createAskDecision(`Inbox unavailable for ${toolName}`, undefined, {
        submittedToInbox: false,
      });
    }

    try {
      const sessionId = (context as unknown as Record<string, unknown>)
        ?.sessionId as string | undefined;
      if (!sessionId) {
        return createAskDecision(
          `Inbox: no session context for ${toolName}`,
          undefined,
          { submittedToInbox: false }
        );
      }

      // P2（§3.3）：任务档审批 —— 优先用上下文显式声明，其次按会话活跃任务兜底解析
      const taskId =
        context.taskId ?? getActiveTaskId(sessionId);

      // P1（2026-11-04）：审批卡**唯一的构造点**（与执行后路径共用，见
      // `toolApprovalSubmission.ts`）。指纹 / 选项 / 文案 / metadata / 审计①段都在那里，
      // 本方法只负责"同指纹复用 → submit → 审计②段"。
      // P0（2026-11-07）：卡片选项已收敛为三档 + 拒绝，`taskId` 仅作为留证写入 metadata。
      const card = buildToolApprovalCard({
        toolOrName,
        input,
        sessionId,
        taskId,
        sandbox: context.sandbox,
      });
      const commandHash = card.commandHash;

      // PR-1：提交前**先查是否已有同一指纹的待审批项**，有则复用（避免僵尸卡）。
      const existingId = inboxManager.list
        ? await findPendingApprovalId(
            inboxManager as unknown as PendingApprovalLookup,
            { sessionId, toolName, approvalHash: commandHash }
          )
        : undefined;
      if (existingId) {
        logger.info('同指纹审批卡已存在，复用而非新建', {
          toolName,
          sessionId,
          inboxItemId: existingId,
        });
        return createAskDecision(
          `'${toolName}' queued in Inbox (risk: ${risk}). Awaiting approval.`,
          undefined,
          { submittedToInbox: true, commandHash, inboxItemId: existingId }
        );
      }

      // P5-1：① 申请（**只在新卡真正要建时**开链 —— 复用既有卡的那条链更早已落过 ①②）
      emitApprovalAudit(sessionId, {
        stage: 'requested',
        approvalId: card.approvalId,
        toolName,
        risk: card.risk,
        inputPreview: JSON.stringify(input).slice(0, 200),
      });

      const submitted = await inboxManager.submit({
        sessionId,
        type: 'approval',
        title: card.title,
        message: card.message,
        options: card.options,
        offlineCapable: true,
        source: 'permission',
        metadata: card.metadata,
      });

      // U-06-5（2026-10-19）：把 Inbox 项 id 回传给工具结果，前端工具卡片可**就地审批**
      // （此前只有"等待审批"徽标，用户必须另找 Inbox 卡片）。
      const inboxItemId = (submitted as { id?: string } | null | undefined)?.id;

      // P5-1：② 呈现（卡片已落成 ⇒ 用户侧可见，含可选项与授权维度摘要）
      emitApprovalAudit(sessionId, {
        stage: 'presented',
        approvalId: card.approvalId,
        toolName,
        risk: card.risk,
        options: card.options,
        fingerprintHash: card.fingerprintHash,
        ...(inboxItemId ? { inboxItemId } : {}),
      });

      logger.info('Tool approval submitted to Inbox', {
        toolName,
        risk: card.risk,
        sessionId,
        inboxItemId,
        hasCommandHash: !!card.commandHash,
      });

      return createAskDecision(
        `'${toolName}' queued in Inbox (risk: ${card.risk}). Awaiting approval.`,
        undefined,
        { submittedToInbox: true, commandHash: card.commandHash, inboxItemId }
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
    context: PermissionContext,
    /** PR-0：调用方已解析的风险类别（传工具对象时应有值；缺省回退名字启发式） */
    resolvedRisk?: RiskClass,
    /** PR-2：工具对象（提供 ⇒ 指纹按工具声明的授权维度计算） */
    tool?: Tool
  ): Promise<PermissionDecision> {
    const risk = resolvedRisk ?? inferRiskClass(toolName);
    return this._submitToInbox(tool ?? toolName, input, context, risk);
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
    const options = this._ruleMatchOptions(toolOrName, context.input ?? {});
    return denyRules.some((rule) =>
      isRuleMatch(rule, toolName, context.input, options)
    );
  }

  /**
   * PR-2（2026-10-23）：「始终允许」规则（`inputFingerprint`）的匹配选项。
   *
   * 指纹由工具声明（`approvalFingerprint`）决定，缺省为全参数稳定 JSON —— 与提交审批、
   * 放行缓存同源；调用方不提供指纹时指纹规则不匹配（fail-closed）。
   */
  private _ruleMatchOptions(
    toolOrName: Tool | string,
    input: Record<string, unknown>
  ): RuleMatchOptions {
    return {
      fingerprint: hashApprovalFingerprint(
        resolveApprovalFingerprint(toolOrName, input)
      ),
    };
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
    const options = this._ruleMatchOptions(toolOrName, context.input ?? {});
    return askRules.some((rule) =>
      isRuleMatch(rule, toolName, context.input, options)
    );
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
    const options = this._ruleMatchOptions(toolOrName, context.input ?? {});
    return allowRules.some((rule) =>
      isRuleMatch(rule, toolName, context.input, options)
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
    const options = this._ruleMatchOptions(toolOrName, input ?? {});
    for (const rule of rules) {
      if (isRuleMatch(rule, toolName, input, options)) {
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

    // ⚠️ A-4（2026-10-18）存量保留：`'Bash'` / `'File'` 是**历史规则名/大小写别名**，
    // 注册名域（`constants/toolNames.generated.ts`）中不存在 ⇒ 这两段**静态不可达**。
    // 按 CD07（permission 属关键域，禁止以「无静态引用/不可达」为依据删除）**保留不删**；
    // 也**不**改写为 `isShellToolName()` / `isFileWriteToolName()` —— 那会把死分支激活成
    // 「真实 bash/powershell 的危险命令额外转 ask」「所有绝对路径写入转 ask」，属**行为变更**，
    // 须独立评审（A-4 后续批次）。执行类工具的危险命令拦截现由
    // `ToolExecutor.performSecurityCheck`（按 `sandboxLevel === 'execution'`）+ `utils/bash/registry`
    // 承担，不在本函数。
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

    // ⚠️ A-4 存量保留：同上（`'File'` 非注册名，静态不可达；按 CD07 不删不激活）。
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
