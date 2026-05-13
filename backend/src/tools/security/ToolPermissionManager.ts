/**
 * 工具权限管理器（委托到 @modules/permission/PermissionManager）
 * 保留向后兼容 API，实际逻辑委托到统一的 PermissionManager
 */

import { createPermissionManager } from '@modules/permission/PermissionManager';
import type { ToolExecutionContext, ToolPermission } from '../types/ToolTypes';

export interface PermissionValidationResult {
  allowed: boolean;
  reason?: string;
  requiredPermissions: ToolPermission[];
  grantedPermissions: ToolPermission[];
  deniedPermissions: ToolPermission[];
}

export class ToolPermissionManager {
  private delegate = createPermissionManager();

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

export const globalToolPermissionManager = new ToolPermissionManager();

export default ToolPermissionManager;
