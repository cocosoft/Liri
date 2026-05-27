/**
 * 权限结果类型
 * 参考CC_CODE的权限系统设计，适应backend现有架构
 */

/**
 * 权限行为类型
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask';

/**
 * 权限结果类型
 */
export interface PermissionResult {
  /**
   * 权限行为
   */
  behavior: PermissionBehavior;

  /**
   * 更新后的输入（可选）
   */
  updatedInput?: any;

  /**
   * 原因（可选）
   */
  reason?: string;
}

/**
 * 创建允许权限结果
 */
export function createAllowResult(
  updatedInput?: any,
  reason?: string
): PermissionResult {
  return {
    behavior: 'allow',
    updatedInput,
    reason,
  };
}

/**
 * 创建拒绝权限结果
 */
export function createDenyResult(reason?: string): PermissionResult {
  return {
    behavior: 'deny',
    reason,
  };
}

/**
 * 创建询问权限结果
 */
export function createAskResult(
  updatedInput?: any,
  reason?: string
): PermissionResult {
  return {
    behavior: 'ask',
    updatedInput,
    reason,
  };
}
