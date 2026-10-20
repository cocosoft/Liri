import type { ToolExecutionContext, ToolPermission } from '../types/ToolTypes';

/**
 * 工具权限管理器（向后兼容门面）
 *
 * ⚠️ **2026-10-19 实测（U-03 P2 收口）**：`validatePermission()` **全仓零调用点**，且实现恒
 * `allowed: true`（不读任何规则）⇒ 它是"假权限门面"：**今天不会拦住任何东西**，将来若有人接线
 * 会得到"永远允许"的静默放行。按 CD07（安全/权限属关键域，禁止仅凭静态零引用删除）：
 * **暂不删除**，仅做两件事 —— ① 移除从未被读取的 `delegate`（死状态，`createPermissionManager()`
 * 实例化后无任何使用）；② 在本注释与 `validatePermission` 上标注"未接线的放行桩"，
 * 真正接线必须委托 `@modules/permission` 的真实判定，不得直接复用本实现。
 */
export interface PermissionValidationResult {
  allowed: boolean;
  reason?: string;
  requiredPermissions: ToolPermission[];
  grantedPermissions: ToolPermission[];
  deniedPermissions: ToolPermission[];
}

export class ToolPermissionManager {
  /**
   * 放行桩（零调用点；见类注释）。
   *
   * @deprecated 未接线且恒 `allowed: true`；如需权限判定，请直接使用 `@modules/permission`
   * 的 `PermissionManager`，不要接线本方法。
   */
  async validatePermission(
    _toolName: string,
    _context: ToolExecutionContext,
    requiredPermissions: ToolPermission[]
  ): Promise<PermissionValidationResult> {
    const baseResult: PermissionValidationResult = {
      allowed: true,
      requiredPermissions,
      grantedPermissions: requiredPermissions,
      deniedPermissions: [],
    };
    return baseResult;
  }

  getConfig(): Record<string, unknown> {
    return { mode: 'default', delegate: 'PermissionManager' };
  }

  updateConfig(_newConfig: Record<string, unknown>): void {
    // 委托—配置管理统一由 PermissionManager 处理
  }
}

/**
 * 全局工具权限管理器实例（惰性初始化）
 * 避免模块加载时立即实例化触发 TDZ（循环导入，与 logConfigManager 模式一致）
 */
let _globalToolPermissionManager: ToolPermissionManager | undefined;
export function getGlobalToolPermissionManager(): ToolPermissionManager {
  if (!_globalToolPermissionManager) {
    _globalToolPermissionManager = new ToolPermissionManager();
  }
  return _globalToolPermissionManager;
}

export default ToolPermissionManager;
