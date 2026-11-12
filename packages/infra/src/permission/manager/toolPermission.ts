/**
 * 工具权限检查入口（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.checkPermissionForTool` / `_checkPermissionForToolResult` 原样搬出：
 * 构造完整 `PermissionContext` → 走决策主链路 → 标注会话权限档自动放行 → ask 统一提交
 * Inbox 审批卡片 → 归一化返回结构。判定顺序与返回字段**逐字不变**；差异只有一处 ——
 * 实例状态改为经 `ToolPermissionDeps` 显式传入。
 */
import { getLogger } from '@openliri/infra/monitoring';

import { isInboxApprovalEnabled, type PermissionChecker, type Tool } from '../PermissionChecker';
import { PermissionMode } from '../PermissionMode';
import type { SandboxExecutionSignal } from '@openliri/infra/utils/toolContract/Tool';
import {
  createPermissionContext,
  type PermissionContext,
} from '../types/PermissionContext';
import {
  PermissionDecision,
  PermissionDecisionType,
  PermissionDenyInfo,
} from '../types/PermissionDecision';
import type { PermissionBehavior } from '../types/PermissionRule';
import { resolveRiskClass } from '../types/RiskClass';
import { buildDenyInfo, logAutoAllowedOnce, resolveEffectiveMode } from './moduleScope';

const logger = getLogger('permission:manager');

/** 工具权限检查可见的实例状态（拆分前是 `this.*`） */
export interface ToolPermissionDeps {
  /** 当前权限模式（会话级模式缺省时使用） */
  mode: PermissionMode;
  permissionChecker: PermissionChecker;
  /** 决策主链路：`PermissionManager.checkPermission`（含 OTel span 与决策计数） */
  checkPermission: (
    toolOrName: Tool | string,
    input: Record<string, unknown>,
    context?: PermissionContext,
    forceAskReason?: string
  ) => Promise<PermissionDecision>;
}

/** `checkPermissionForTool` 的调用上下文（由执行入口注入） */
export type ToolPermissionCallContext = Pick<
  PermissionContext,
  | 'sessionId'
  | 'toolCallId'
  | 'userId'
  | 'userRole'
  | 'userRoles'
  | 'metadata'
  | 'approvalMode'
  | 'permissionMode'
  | 'workspacePath'
  | 'workspaceRoots'
  | 'taskId'
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
};

/** `checkPermissionForTool` 的归一化返回结构 */
export interface ToolPermissionResult {
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
  /** P3（2026-11-07，方案 §2.3-4）：会话权限档自动放行（非用户逐条批准） */
  autoApproved?: boolean;
  /** 同上：来源编码（`permission-mode:bypass` / `permission-mode:auto` / …） */
  approvalSource?: string;
}

/**
 * 检查工具权限（兼容ToolManager接口）
 * @param toolName 工具名称
 * @param input 输入参数
 * @returns 工具权限检查结果
 */
export async function checkPermissionForTool(
  deps: ToolPermissionDeps,
  toolName: string,
  input: Record<string, unknown> = {},
  context?: ToolPermissionCallContext
): Promise<ToolPermissionResult> {
  // P1-2: 构造完整 PermissionContext（补 toolName/input），透传 sessionId 供统一提交
  const permissionContext = createPermissionContext({
    toolName,
    input,
    sessionId: context?.sessionId,
    // 2026-11-12：透传调用 id（审批卡留证；用户拒绝时据此写终态结果并续跑）
    toolCallId: context?.toolCallId,
    userId: context?.userId,
    // 多租户 P0 阶段 2：请求级角色透传（缺失 ⇒ 本次判定无角色，角色 deny 不参与）
    userRole: context?.userRole,
    // P2-6（2026-11-11）：全部角色透传（RBAC 按并集判定；缺省回落实体里的主角色）
    userRoles: context?.userRoles,
    metadata: context?.metadata,
    // PR-3：会话级审批模式与工作区边界（缺失 ⇒ 与改造前一致：ask + 无自动放行）
    approvalMode: context?.approvalMode,
    // P1（2026-11-04）：会话级权限模式 —— **必须在此透传**，否则执行链（唯一真实入口
    // `checkPermissionForTool`）断在 `createPermissionContext`，会话档位形同未接线。
    permissionMode: context?.permissionMode,
    workspacePath: context?.workspacePath,
    // P1（2026-11-04，§3.6）：工作区根列表（缺省 ⇒ 边界判定回落单根 workspacePath）
    workspaceRoots: context?.workspaceRoots,
    // P2（§3.3）：所属长程任务（缺省 ⇒ 审批卡不提供"本任务都允许"）
    taskId: context?.taskId,
    // PR-3a：沙箱信号（缺失 ⇒ undefined，审批卡不写该字段 ⇒ 视为"未沙箱"）
    sandbox: context?.sandbox,
  });
  const decision = await deps.checkPermission(
    context?.tool ?? toolName,
    input,
    permissionContext,
    context?.forceAskReason
  );

  // P3（2026-11-07，方案 §2.3-4）：会话权限档的**放宽档**（bypass / auto / dontAsk）
  // 会直接放行而不产生审批卡 ⇒ 必须显式标注「自动放行」，不得在日志/审计里与
  // 「用户逐条批准」混同。仅在 allow 时标注；收紧档（plan）不适用。
  const effectivePermissionMode = resolveEffectiveMode(
    permissionContext.permissionMode,
    deps.mode
  );
  const autoSource =
    decision.type === PermissionDecisionType.ALLOW
      ? effectivePermissionMode === PermissionMode.BYPASS
        ? 'permission-mode:bypass'
        : effectivePermissionMode === PermissionMode.AUTO
          ? 'permission-mode:auto'
          : effectivePermissionMode === PermissionMode.DONT_ASK
            ? 'permission-mode:dontAsk'
            : undefined
      : undefined;
  if (autoSource) {
    logAutoAllowedOnce(autoSource, toolName, context?.sessionId);
  }

  // P1-2: ask 决策统一提交 Inbox 审批卡片（唯一提交点，开关控制，避免重复提交）。
  // 提交成功 → 决策携带 submittedToInbox:true + commandHash，供上层返回 awaiting_approval；
  // 提交失败/开关关闭 → 保留原 ask 决策（上层降级为 ask 文本）。
  if (
    decision.type === PermissionDecisionType.ASK &&
    decision.context?.submittedToInbox !== true &&
    isInboxApprovalEnabled()
  ) {
    try {
      const submittedDecision = await deps.permissionChecker.submitAskToInbox(
        toolName,
        input,
        permissionContext,
        resolveRiskClass(context?.tool ?? toolName, input),
        context?.tool
      );
      return normalizeToolPermissionResult(submittedDecision, toolName);
    } catch (err) {
      logger.warn('Failed to submit ask decision to Inbox', {
        toolName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return normalizeToolPermissionResult(decision, toolName, autoSource);
}

/** P1-2: 归一化 checkPermissionForTool 返回结构（含 submittedToInbox/commandHash） */
export function normalizeToolPermissionResult(
  decision: PermissionDecision,
  toolName: string,
  /** P3（2026-11-07）：自动放行来源（会话权限档）；缺省 = 常规判定 */
  autoSource?: string
): ToolPermissionResult {
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
    // P3：只有 allow 才可能带自动来源（ask/deny 由调用方传入 undefined）
    ...(autoSource ? { autoApproved: true, approvalSource: autoSource } : {}),
  };
}
