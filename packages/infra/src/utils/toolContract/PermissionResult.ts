/**
 * 权限结果类型
 * 参考CC_CODE的权限系统设计，适应backend现有架构
 */

/**
 * 工具结果侧的权限行为（**与 `permission` 的 `PermissionBehavior` 枚举不同**：这里没有
 * `passthrough`，是工具返回值的最小判别集合）
 *
 * 2026-11-01（B7）：`PermissionBehavior` 这个名字已随枚举下沉到 `common`（security 需要按
 * `DENY` 判等），而 R4「common / utils 不允许同名导出」要求两处不同概念消歧 ⇒
 * 按仓内既有惯例（`Option→CommandOption`、`ValidationResult→ToolValidationResult`）改名。
 */
export type ToolPermissionBehavior = 'allow' | 'deny' | 'ask';

/**
 * 权限结果类型
 */
export interface PermissionResult {
  /**
   * 权限行为
   */
  behavior: ToolPermissionBehavior;

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
