/**
 * 权限决策类型枚举
 */
export enum PermissionDecisionType {
  /**
   * 允许使用工具
   */
  ALLOW = 'allow',

  /**
   * 拒绝使用工具
   */
  DENY = 'deny',

  /**
   * 询问用户是否允许使用工具
   */
  ASK = 'ask',
}

/**
 * 规则拒绝的**结构化回传**（LRO-07，2026-10-26）。
 *
 * 为什么需要：`PermissionDecision.context` 是权限层内部字段，`checkPermissionForTool`
 * 归一化结果时会被截断 ⇒ 工具结果只拿到一句 reason，结构化字段（哪条规则、怎么解除）
 * 到不了上层。本类型是**跨层 DTO**：由 `PermissionManager` 从 context 提取，
 * 由工具执行层原样放进 `ToolResult.metadata.permissionDeny`。
 */
export interface PermissionDenyInfo {
  /** 命中的规则 id（用户可据此定位到具体规则） */
  ruleId?: string;
  /** 规则来源（如 `ruleStore` / `userSettings`），如实反映，不伪造 */
  sourceKind?: string;
  /** 「始终允许/拒绝」档的参数指纹摘要 */
  inputFingerprint?: string;
  /** 怎么解除（面板路径 + 精确 API；settings 来源指向配置文件） */
  removableVia?: string;
  /**
   * F5（2026-10-27）：命中维度 —— `fingerprint`（规则绑定参数指纹，只拦该组合）或
   * `tool`（规则不含指纹，拦整个工具）。用于区分"整工具被一条 deny 笼罩"的真假。
   */
  matchScope?: 'tool' | 'fingerprint';
}

/**
 * 权限决策接口
 */
export interface PermissionDecision {
  /**
   * 决策类型
   */
  type: PermissionDecisionType;

  /**
   * 决策原因
   */
  reason: string;

  /**
   * 相关的权限规则（可选）
   */
  rule?: any; // PermissionRule类型，暂时使用any，后续会导入

  /**
   * 决策上下文（可选）
   */
  context?: Record<string, unknown>;
}

/**
 * 创建允许决策
 * @param reason 决策原因
 * @param rule 相关的权限规则（可选）
 * @param context 决策上下文（可选）
 * @returns 权限决策对象
 */
export function createAllowDecision(
  reason: string,
  rule?: any,
  context?: Record<string, unknown>
): PermissionDecision {
  return {
    type: PermissionDecisionType.ALLOW,
    reason,
    rule,
    context,
  };
}

/**
 * 创建拒绝决策
 * @param reason 决策原因
 * @param rule 相关的权限规则（可选）
 * @param context 决策上下文（可选）
 * @returns 权限决策对象
 */
export function createDenyDecision(
  reason: string,
  rule?: any,
  context?: Record<string, unknown>
): PermissionDecision {
  return {
    type: PermissionDecisionType.DENY,
    reason,
    rule,
    context,
  };
}

/**
 * 创建询问决策
 * @param reason 决策原因
 * @param rule 相关的权限规则（可选）
 * @param context 决策上下文（可选）
 * @returns 权限决策对象
 */
export function createAskDecision(
  reason: string,
  rule?: any,
  context?: Record<string, unknown>
): PermissionDecision {
  return {
    type: PermissionDecisionType.ASK,
    reason,
    rule,
    context,
  };
}

/**
 * 检查决策是否为允许
 * @param decision 权限决策
 * @returns 是否为允许决策
 */
export function isAllowDecision(decision: PermissionDecision): boolean {
  return decision.type === PermissionDecisionType.ALLOW;
}

/**
 * 检查决策是否为拒绝
 * @param decision 权限决策
 * @returns 是否为拒绝决策
 */
export function isDenyDecision(decision: PermissionDecision): boolean {
  return decision.type === PermissionDecisionType.DENY;
}

/**
 * 检查决策是否为询问
 * @param decision 权限决策
 * @returns 是否为询问决策
 */
export function isAskDecision(decision: PermissionDecision): boolean {
  return decision.type === PermissionDecisionType.ASK;
}
