/**
 * 账单访问控制服务
 * 基于用户角色的账单访问控制
 */

import { EventEmitter } from 'events';

/**
 * 用户角色
 */
export type UserRole = 'admin' | 'manager' | 'user' | 'guest';

/**
 * 权限级别
 */
export type PermissionLevel = 'none' | 'read' | 'write' | 'admin';

/**
 * 账单访问权限配置
 */
export interface BillingAccessConfig {
  role: UserRole;
  permissionLevel: PermissionLevel;
  canViewOwnCosts: boolean;
  canViewTeamCosts: boolean;
  canViewAllCosts: boolean;
  canExportCosts: boolean;
  canManageBudgets: boolean;
  budgetLimit?: number;
}

/**
 * 账单访问记录
 */
export interface BillingAccessRecord {
  id: string;
  userId: string;
  role: UserRole;
  action: 'view' | 'export' | 'manage';
  target: string;
  timestamp: number;
  success: boolean;
  reason?: string;
}

/**
 * 账单访问统计
 */
export interface BillingAccessStats {
  totalAccessAttempts: number;
  successfulAccess: number;
  deniedAccess: number;
  accessByRole: Record<UserRole, number>;
  accessByAction: Record<string, number>;
}

/**
 * 角色权限映射
 */
const ROLE_PERMISSIONS: Record<UserRole, BillingAccessConfig> = {
  admin: {
    role: 'admin',
    permissionLevel: 'admin',
    canViewOwnCosts: true,
    canViewTeamCosts: true,
    canViewAllCosts: true,
    canExportCosts: true,
    canManageBudgets: true,
  },
  manager: {
    role: 'manager',
    permissionLevel: 'write',
    canViewOwnCosts: true,
    canViewTeamCosts: true,
    canViewAllCosts: false,
    canExportCosts: true,
    canManageBudgets: true,
    budgetLimit: 1000,
  },
  user: {
    role: 'user',
    permissionLevel: 'read',
    canViewOwnCosts: true,
    canViewTeamCosts: false,
    canViewAllCosts: false,
    canExportCosts: false,
    canManageBudgets: false,
  },
  guest: {
    role: 'guest',
    permissionLevel: 'none',
    canViewOwnCosts: false,
    canViewTeamCosts: false,
    canViewAllCosts: false,
    canExportCosts: false,
    canManageBudgets: false,
  },
};

/**
 * 账单访问控制服务
 */
export class BillingAccessControlService extends EventEmitter {
  private static instance: BillingAccessControlService;
  private userRoles: Map<string, UserRole> = new Map();
  private accessRecords: BillingAccessRecord[] = [];
  private customPermissions: Map<string, BillingAccessConfig> = new Map();
  private maxRecords: number = 1000;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): BillingAccessControlService {
    if (!BillingAccessControlService.instance) {
      BillingAccessControlService.instance = new BillingAccessControlService();
    }
    return BillingAccessControlService.instance;
  }

  /**
   * 设置用户角色
   */
  public setUserRole(userId: string, role: UserRole): void {
    this.userRoles.set(userId, role);
    this.emit('roleChanged', { userId, role });
  }

  /**
   * 获取用户角色
   */
  public getUserRole(userId: string): UserRole {
    return this.userRoles.get(userId) || 'guest';
  }

  /**
   * 获取用户权限配置
   */
  public getUserPermissions(userId: string): BillingAccessConfig {
    const customPermission = this.customPermissions.get(userId);
    if (customPermission) {
      return customPermission;
    }

    const role = this.getUserRole(userId);
    return ROLE_PERMISSIONS[role];
  }

  /**
   * 设置自定义权限
   */
  public setCustomPermissions(userId: string, config: Partial<BillingAccessConfig>): void {
    const role = this.getUserRole(userId);
    const baseConfig = ROLE_PERMISSIONS[role];

    this.customPermissions.set(userId, {
      ...baseConfig,
      ...config,
    });

    this.emit('permissionsChanged', { userId, config: this.customPermissions.get(userId) });
  }

  /**
   * 清除自定义权限
   */
  public clearCustomPermissions(userId: string): void {
    this.customPermissions.delete(userId);
  }

  /**
   * 检查是否可以查看成本
   */
  public canViewCosts(userId: string, targetUserId?: string): boolean {
    const permissions = this.getUserPermissions(userId);

    if (permissions.permissionLevel === 'none') {
      this.recordAccess(userId, 'view', targetUserId || 'self', false, 'No permission');
      return false;
    }

    if (!targetUserId || targetUserId === userId) {
      if (permissions.canViewOwnCosts) {
        this.recordAccess(userId, 'view', targetUserId || 'self', true);
        return true;
      }
      this.recordAccess(userId, 'view', targetUserId || 'self', false, 'Cannot view own costs');
      return false;
    }

    if (permissions.canViewAllCosts) {
      this.recordAccess(userId, 'view', targetUserId, true);
      return true;
    }

    if (permissions.canViewTeamCosts) {
      this.recordAccess(userId, 'view', targetUserId, true);
      return true;
    }

    this.recordAccess(userId, 'view', targetUserId, false, 'No access to target costs');
    return false;
  }

  /**
   * 检查是否可以导出成本
   */
  public canExportCosts(userId: string): boolean {
    const permissions = this.getUserPermissions(userId);

    if (!permissions.canExportCosts) {
      this.recordAccess(userId, 'export', 'all', false, 'No export permission');
      return false;
    }

    this.recordAccess(userId, 'export', 'all', true);
    return true;
  }

  /**
   * 检查是否可以管理预算
   */
  public canManageBudgets(userId: string): boolean {
    const permissions = this.getUserPermissions(userId);

    if (!permissions.canManageBudgets) {
      this.recordAccess(userId, 'manage', 'budgets', false, 'No budget management permission');
      return false;
    }

    this.recordAccess(userId, 'manage', 'budgets', true);
    return true;
  }

  /**
   * 检查预算限制
   */
  public checkBudgetLimit(userId: string, amount: number): { allowed: boolean; reason?: string } {
    const permissions = this.getUserPermissions(userId);

    if (permissions.permissionLevel === 'admin') {
      return { allowed: true };
    }

    if (permissions.budgetLimit !== undefined) {
      if (amount > permissions.budgetLimit) {
        this.recordAccess(userId, 'manage', 'budget', false, `Amount ${amount} exceeds limit ${permissions.budgetLimit}`);
        return {
          allowed: false,
          reason: `Amount ${amount} exceeds your budget limit of ${permissions.budgetLimit}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 记录访问尝试
   */
  private recordAccess(
    userId: string,
    action: 'view' | 'export' | 'manage',
    target: string,
    success: boolean,
    reason?: string
  ): void {
    const record: BillingAccessRecord = {
      id: `access_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      role: this.getUserRole(userId),
      action,
      target,
      timestamp: Date.now(),
      success,
      reason,
    };

    this.accessRecords.push(record);

    if (this.accessRecords.length > this.maxRecords) {
      this.accessRecords.shift();
    }

    this.emit('accessRecorded', record);
  }

  /**
   * 获取访问记录
   */
  public getAccessRecords(userId?: string, limit?: number): BillingAccessRecord[] {
    let records = userId
      ? this.accessRecords.filter(r => r.userId === userId)
      : [...this.accessRecords];

    if (limit) {
      records = records.slice(-limit);
    }

    return records;
  }

  /**
   * 获取访问统计
   */
  public getAccessStats(): BillingAccessStats {
    const stats: BillingAccessStats = {
      totalAccessAttempts: this.accessRecords.length,
      successfulAccess: this.accessRecords.filter(r => r.success).length,
      deniedAccess: this.accessRecords.filter(r => !r.success).length,
      accessByRole: { admin: 0, manager: 0, user: 0, guest: 0 },
      accessByAction: { view: 0, export: 0, manage: 0 },
    };

    for (const record of this.accessRecords) {
      stats.accessByRole[record.role]++;
      stats.accessByAction[record.action]++;
    }

    return stats;
  }

  /**
   * 清空访问记录
   */
  public clearAccessRecords(): void {
    this.accessRecords = [];
  }

  /**
   * 获取角色权限
   */
  public getRolePermissions(role: UserRole): BillingAccessConfig {
    return ROLE_PERMISSIONS[role];
  }

  /**
   * 获取所有角色权限
   */
  public getAllRolePermissions(): Record<UserRole, BillingAccessConfig> {
    return { ...ROLE_PERMISSIONS };
  }

  /**
   * 重置服务
   */
  public reset(): void {
    this.userRoles.clear();
    this.customPermissions.clear();
    this.accessRecords = [];
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const billingAccessControl = BillingAccessControlService.getInstance();

/**
 * 便捷函数：设置用户角色
 */
export function setBillingUserRole(userId: string, role: UserRole): void {
  billingAccessControl.setUserRole(userId, role);
}

/**
 * 便捷函数：获取用户角色
 */
export function getBillingUserRole(userId: string): UserRole {
  return billingAccessControl.getUserRole(userId);
}

/**
 * 便捷函数：检查是否可以查看成本
 */
export function canViewBillingCosts(userId: string, targetUserId?: string): boolean {
  return billingAccessControl.canViewCosts(userId, targetUserId);
}

/**
 * 便捷函数：检查是否可以导出成本
 */
export function canExportBillingCosts(userId: string): boolean {
  return billingAccessControl.canExportCosts(userId);
}

/**
 * 便捷函数：检查是否可以管理预算
 */
export function canManageBillingBudgets(userId: string): boolean {
  return billingAccessControl.canManageBudgets(userId);
}

/**
 * 便捷函数：检查预算限制
 */
export function checkBillingBudgetLimit(userId: string, amount: number): { allowed: boolean; reason?: string } {
  return billingAccessControl.checkBudgetLimit(userId, amount);
}

/**
 * 便捷函数：获取访问统计
 */
export function getBillingAccessStats(): BillingAccessStats {
  return billingAccessControl.getAccessStats();
}
