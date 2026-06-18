/**
 * 权限管理�?
 * 管理用户权限，控制工具和功能的访�?
 */

import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ module: 'PermissionManager' });

/**
 * 权限类型
 */
export enum PermissionType {
  /**
   * 工具权限
   */
  TOOL = 'tool',
  /**
   * 功能权限
   */
  FEATURE = 'feature',
  /**
   * 资源权限
   */
  RESOURCE = 'resource',
  /**
   * 操作权限
   */
  OPERATION = 'operation',
  /**
   * 自定义权�?
   */
  CUSTOM = 'custom',
}

/**
 * 安全模块权限规则
 *
 * @remarks 这是 security 模块的本地权限规则类型，与 @modules/permission/types/PermissionRule
 * 中的领域模型不同。本类型专注于安全模块内部的条件判断与权限控制。
 * 模块间数据交换应使用 permission/types/PermissionRule 的规范类型。
 */
export interface PermissionRule {
  /**
   * 规则ID
   */
  id: string;
  /**
   * 权限类型
   */
  type: PermissionType;
  /**
   * 权限名称
   */
  name: string;
  /**
   * 是否允许
   */
  allowed: boolean;
  /**
   * 规则描述
   */
  description?: string;
  /**
   * 条件
   */
  condition?: (context: any) => boolean;
  /**
   * 过期时间
   */
  expiresAt?: Date;
  /**
   * 创建时间
   */
  createdAt: Date;
}

/**
 * 权限上下�?
 */
export interface PermissionContext {
  /**
   * 用户ID
   */
  userId?: string;
  /**
   * 角色
   */
  roles?: string[];
  /**
   * 工具名称
   */
  toolName?: string;
  /**
   * 功能名称
   */
  featureName?: string;
  /**
   * 资源名称
   */
  resourceName?: string;
  /**
   * 操作名称
   */
  operationName?: string;
  /**
   * 自定义数�?
   */
  [key: string]: any;
}

/**
 * 权限管理�?
 */
export class PermissionManager {
  private static instance: PermissionManager;
  private rules: Map<string, PermissionRule> = new Map();
  private defaultAllow: boolean = true;

  constructor(defaultAllow: boolean = true) {
    this.defaultAllow = defaultAllow;
  }

  public static getInstance(): PermissionManager {
    if (!PermissionManager.instance) {
      PermissionManager.instance = new PermissionManager();
    }
    return PermissionManager.instance;
  }

  /**
   * 初始化权限管理器
   */
  async init(): Promise<void> {
    try {
      logger.info('Initializing permission manager');
      // 可以从配置或数据库加载规�?
      this.loadDefaultRules();
      logger.info('Permission manager initialized');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize permission manager:', e);
      throw error;
    }
  }

  /**
   * 加载默认规则
   */
  private loadDefaultRules(): void {
    // 添加默认规则
    this.addRule({
      id: 'default-tool-allow',
      type: PermissionType.TOOL,
      name: '*',
      allowed: this.defaultAllow,
      description: 'Default tool permission',
      createdAt: new Date(),
    });

    this.addRule({
      id: 'default-feature-allow',
      type: PermissionType.FEATURE,
      name: '*',
      allowed: this.defaultAllow,
      description: 'Default feature permission',
      createdAt: new Date(),
    });
  }

  /**
   * 添加权限规则
   * @param rule 权限规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.set(rule.id, rule);
    logger.info(`Added permission rule: ${rule.id}`);
  }

  /**
   * 移除权限规则
   * @param ruleId 规则ID
   */
  removeRule(ruleId: string): void {
    if (this.rules.has(ruleId)) {
      this.rules.delete(ruleId);
      logger.info(`Removed permission rule: ${ruleId}`);
    } else {
      logger.warn(`Permission rule ${ruleId} not found`);
    }
  }

  /**
   * 检查权�?
   * @param type 权限类型
   * @param name 权限名称
   * @param context 权限上下�?
   */
  checkPermission(
    type: PermissionType,
    name: string,
    context: PermissionContext = {}
  ): boolean {
    // 查找匹配的规�?
    const matchingRules = Array.from(this.rules.values()).filter((rule) => {
      if (rule.type !== type) return false;
      if (rule.name !== '*' && rule.name !== name) return false;
      if (rule.expiresAt && rule.expiresAt < new Date()) return false;
      if (rule.condition && !rule.condition(context)) return false;
      return true;
    });

    // 按ID排序，确保规则的一致�?
    matchingRules.sort((a, b) => a.id.localeCompare(b.id));

    // 如果有匹配的规则，返回最后一个规则的结果
    if (matchingRules.length > 0) {
      const lastRule = matchingRules[matchingRules.length - 1];
      logger.debug(
        `Permission check for ${type}:${name} - ${lastRule.allowed ? 'allowed' : 'denied'} (rule: ${lastRule.id})`
      );
      return lastRule.allowed;
    }

    // 如果没有匹配的规则，返回默认�?
    logger.debug(
      `Permission check for ${type}:${name} - ${this.defaultAllow ? 'allowed' : 'denied'} (default)`
    );
    return this.defaultAllow;
  }

  /**
   * 检查工具权�?
   * @param toolName 工具名称
   * @param context 权限上下�?
   */
  checkToolPermission(
    toolName: string,
    context: PermissionContext = {}
  ): boolean {
    return this.checkPermission(PermissionType.TOOL, toolName, context);
  }

  /**
   * 检查功能权�?
   * @param featureName 功能名称
   * @param context 权限上下�?
   */
  checkFeaturePermission(
    featureName: string,
    context: PermissionContext = {}
  ): boolean {
    return this.checkPermission(PermissionType.FEATURE, featureName, context);
  }

  /**
   * 检查资源权�?
   * @param resourceName 资源名称
   * @param context 权限上下�?
   */
  checkResourcePermission(
    resourceName: string,
    context: PermissionContext = {}
  ): boolean {
    return this.checkPermission(PermissionType.RESOURCE, resourceName, context);
  }

  /**
   * 检查操作权�?
   * @param operationName 操作名称
   * @param context 权限上下�?
   */
  checkOperationPermission(
    operationName: string,
    context: PermissionContext = {}
  ): boolean {
    return this.checkPermission(
      PermissionType.OPERATION,
      operationName,
      context
    );
  }

  /**
   * 检查自定义权限
   * @param customName 自定义权限名�?
   * @param context 权限上下�?
   */
  checkCustomPermission(
    customName: string,
    context: PermissionContext = {}
  ): boolean {
    return this.checkPermission(PermissionType.CUSTOM, customName, context);
  }

  /**
   * 获取所有规�?
   */
  getRules(): PermissionRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 获取规则数量
   */
  getRuleCount(): number {
    return this.rules.size;
  }

  /**
   * 获取规则
   * @param ruleId 规则ID
   */
  getRule(ruleId: string): PermissionRule | undefined {
    return this.rules.get(ruleId);
  }

  /**
   * 更新规则
   * @param ruleId 规则ID
   * @param updates 更新内容
   */
  updateRule(ruleId: string, updates: Partial<PermissionRule>): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      const updatedRule = {
        ...rule,
        ...updates,
      };
      this.rules.set(ruleId, updatedRule);
      logger.info(`Updated permission rule: ${ruleId}`);
    } else {
      logger.warn(`Permission rule ${ruleId} not found`);
    }
  }

  /**
   * 清除所有规�?
   */
  clearRules(): void {
    this.rules.clear();
    logger.info('Cleared all permission rules');
  }

  /**
   * 导出规则
   */
  exportRules(): PermissionRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 导入规则
   * @param rules 规则列表
   */
  importRules(rules: PermissionRule[]): void {
    for (const rule of rules) {
      this.addRule(rule);
    }
    logger.info(`Imported ${rules.length} permission rules`);
  }

  /**
   * 停止权限管理�?
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping permission manager');
      this.clearRules();
      logger.info('Permission manager stopped');
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to stop permission manager:', e);
      throw error;
    }
  }

  /**
   * 获取默认权限
   */
  getDefaultAllow(): boolean {
    return this.defaultAllow;
  }

  /**
   * 设置默认权限
   * @param defaultAllow 默认是否允许
   */
  setDefaultAllow(defaultAllow: boolean): void {
    this.defaultAllow = defaultAllow;
    logger.info(`Set default allow to ${defaultAllow}`);
  }
}

/**
 * 创建权限管理�?
 */
export function createPermissionManager(
  defaultAllow: boolean = true
): PermissionManager {
  return new PermissionManager(defaultAllow);
}
