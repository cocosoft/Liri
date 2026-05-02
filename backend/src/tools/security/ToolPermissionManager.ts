/**
 * 工具权限管理器（基于CC源码）
 * 负责工具权限的验证和管理
 */

import { 
  ToolPermission, 
  ToolExecutionContext,
  ToolPermissionConfig,
  ToolPermissionRule,
  ToolErrorCode
} from '../types/ToolTypes';

/**
 * 权限验证结果（基于CC源码）
 */
export interface PermissionValidationResult {
  /** 是否允许 */
  allowed: boolean;
  
  /** 拒绝原因 */
  reason?: string;
  
  /** 需要的权限 */
  requiredPermissions: ToolPermission[];
  
  /** 授予的权限 */
  grantedPermissions: ToolPermission[];
  
  /** 拒绝的权限 */
  deniedPermissions: ToolPermission[];
}

/**
 * 工具权限管理器类（基于CC源码）
 */
export class ToolPermissionManager {
  private permissionRules: Map<string, ToolPermissionRule> = new Map();
  private config: ToolPermissionConfig;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(config: Partial<ToolPermissionConfig> = {}) {
    this.config = {
      mode: 'strict',
      defaultLevel: 'read',
      rules: [],
      ...config
    };
    
    // 初始化默认权限规则
    this.initializeDefaultRules();
  }

  /**
   * 验证工具权限（基于CC源码）
   */
  async validatePermission(
    toolName: string,
    context: ToolExecutionContext,
    requiredPermissions: ToolPermission[]
  ): Promise<PermissionValidationResult> {
    const result: PermissionValidationResult = {
      allowed: true,
      requiredPermissions,
      grantedPermissions: [],
      deniedPermissions: []
    };

    // 根据配置模式处理
    switch (this.config.mode) {
      case 'permissive':
        // 宽松模式：允许所有权限
        result.grantedPermissions = requiredPermissions;
        break;
        
      case 'strict':
        // 严格模式：验证所有权限
        for (const permission of requiredPermissions) {
          const ruleResult = await this.validatePermissionWithRules(
            toolName,
            context,
            permission
          );
          
          if (ruleResult.allowed) {
            result.grantedPermissions.push(permission);
          } else {
            result.deniedPermissions.push(permission);
            result.allowed = false;
            result.reason = ruleResult.reason || '权限不足';
          }
        }
        break;
        
      case 'custom':
        // 自定义模式：使用自定义规则
        const customResult = await this.validateWithCustomRules(
          toolName,
          context,
          requiredPermissions
        );
        
        result.allowed = customResult.allowed;
        result.grantedPermissions = customResult.grantedPermissions;
        result.deniedPermissions = customResult.deniedPermissions;
        result.reason = customResult.reason;
        break;
    }

    return result;
  }

  /**
   * 添加权限规则（基于CC源码）
   */
  addPermissionRule(rule: ToolPermissionRule): void {
    this.permissionRules.set(rule.name, rule);
    this.config.rules.push(rule);
  }

  /**
   * 移除权限规则（基于CC源码）
   */
  removePermissionRule(ruleName: string): boolean {
    const exists = this.permissionRules.has(ruleName);
    
    if (exists) {
      this.permissionRules.delete(ruleName);
      this.config.rules = this.config.rules.filter(rule => rule.name !== ruleName);
    }
    
    return exists;
  }

  /**
   * 获取权限规则（基于CC源码）
   */
  getPermissionRules(): ToolPermissionRule[] {
    return Array.from(this.permissionRules.values());
  }

  /**
   * 使用规则验证权限（基于CC源码）
   */
  private async validatePermissionWithRules(
    toolName: string,
    context: ToolExecutionContext,
    permission: ToolPermission
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 检查是否有匹配的规则
    for (const rule of this.permissionRules.values()) {
      if (await rule.condition(context)) {
        // 检查允许的权限
        const allowedPermission = rule.allowedPermissions.find(p => 
          this.permissionMatches(p, permission)
        );
        
        if (allowedPermission) {
          return { allowed: true };
        }
        
        // 检查拒绝的权限
        const deniedPermission = rule.deniedPermissions.find(p => 
          this.permissionMatches(p, permission)
        );
        
        if (deniedPermission) {
          return { 
            allowed: false, 
            reason: `权限被规则拒绝: ${rule.name}` 
          };
        }
      }
    }
    
    // 默认情况下，根据默认级别决定
    if (this.isPermissionLevelSufficient(permission.level, this.config.defaultLevel)) {
      return { allowed: true };
    }
    
    return { 
      allowed: false, 
      reason: `权限级别不足: ${permission.level} < ${this.config.defaultLevel}` 
    };
  }

  /**
   * 使用自定义规则验证权限（基于CC源码）
   */
  private async validateWithCustomRules(
    toolName: string,
    context: ToolExecutionContext,
    requiredPermissions: ToolPermission[]
  ): Promise<PermissionValidationResult> {
    const result: PermissionValidationResult = {
      allowed: true,
      requiredPermissions,
      grantedPermissions: [],
      deniedPermissions: []
    };

    // 应用所有自定义规则
    for (const rule of this.config.rules) {
      if (await rule.condition(context)) {
        // 检查每个需要的权限
        for (const permission of requiredPermissions) {
          const allowedPermission = rule.allowedPermissions.find(p => 
            this.permissionMatches(p, permission)
          );
          
          const deniedPermission = rule.deniedPermissions.find(p => 
            this.permissionMatches(p, permission)
          );
          
          if (allowedPermission && !deniedPermission) {
            result.grantedPermissions.push(permission);
          } else if (deniedPermission) {
            result.deniedPermissions.push(permission);
            result.allowed = false;
            result.reason = `权限被规则拒绝: ${rule.name}`;
          }
        }
      }
    }

    return result;
  }

  /**
   * 检查权限是否匹配（基于CC源码）
   */
  private permissionMatches(permission1: ToolPermission, permission2: ToolPermission): boolean {
    return (
      permission1.type === permission2.type &&
      permission1.level === permission2.level &&
      (permission1.scope === permission2.scope || !permission1.scope || !permission2.scope)
    );
  }

  /**
   * 检查权限级别是否足够（基于CC源码）
   */
  private isPermissionLevelSufficient(
    requiredLevel: string,
    grantedLevel: string
  ): boolean {
    const levels = ['read', 'write', 'execute', 'admin'];
    const requiredIndex = levels.indexOf(requiredLevel);
    const grantedIndex = levels.indexOf(grantedLevel);
    
    return grantedIndex >= requiredIndex;
  }

  /**
   * 初始化默认权限规则（基于CC源码）
   */
  private initializeDefaultRules(): void {
    // 文件系统权限规则
    this.addPermissionRule({
      name: 'file-system-read',
      condition: (context) => {
        // 检查是否允许文件系统读取
        return context.userId !== 'anonymous';
      },
      allowedPermissions: [
        { type: 'file', description: '文件读取', level: 'read' },
        { type: 'file', description: '文件列表', level: 'read' }
      ],
      deniedPermissions: []
    });

    // 网络权限规则
    this.addPermissionRule({
      name: 'network-access',
      condition: (context) => {
        // 检查是否允许网络访问
        return context.userId === 'admin';
      },
      allowedPermissions: [
        { type: 'network', description: 'HTTP请求', level: 'execute' },
        { type: 'network', description: 'WebSocket连接', level: 'execute' }
      ],
      deniedPermissions: []
    });

    // 系统权限规则
    this.addPermissionRule({
      name: 'system-access',
      condition: (context) => {
        // 检查是否允许系统访问
        return context.userId === 'admin';
      },
      allowedPermissions: [
        { type: 'system', description: '进程管理', level: 'execute' },
        { type: 'system', description: '系统信息', level: 'read' }
      ],
      deniedPermissions: []
    });
  }

  /**
   * 获取权限管理器配置（基于CC源码）
   */
  getConfig(): ToolPermissionConfig {
    return { ...this.config };
  }

  /**
   * 更新权限管理器配置（基于CC源码）
   */
  updateConfig(newConfig: Partial<ToolPermissionConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig
    };
  }
}

/**
 * 全局工具权限管理器实例（基于CC源码）
 */
export const globalToolPermissionManager = new ToolPermissionManager();

export default ToolPermissionManager;