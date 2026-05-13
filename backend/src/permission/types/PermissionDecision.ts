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
