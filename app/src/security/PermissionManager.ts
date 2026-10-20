/**
 * 权限管理�?
 * 管理用户权限，控制工具和功能的访�?
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { RuleManager } from '@modules/permission';
import { PermissionBehavior } from '@modules/permission/types/PermissionRule';

const logger = getLogger('PermissionManager');

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
 * 权限管理视图（T-①05 D1 改名消歧）
 *
 * 原名 `PermissionManager`，与 `permission/PermissionManager.ts`（主权限管理器）**同名**易混。
 * 本类自述定位为 **SecurityIntegration 的同步补充视图**（与主模块共用同一规则存储，
 * 见 `syncRulesFromMainModule()`），故改名以体现该语义。
 */
export class SecurityPermissionView {
  private static instance: SecurityPermissionView;
  private rules: Map<string, PermissionRule> = new Map();
  private defaultAllow: boolean = true;
  /** 主模块 deny 规则是否已同步成功 */
  private rulesSynced = false;
  /** 是否已尝试过同步（失败不重复重试，避免每次判定刷日志） */
  private rulesSyncAttempted = false;

  constructor(defaultAllow: boolean = true) {
    this.defaultAllow = defaultAllow;
    // P0-3：从主权限模块（permission_rules.json）同步 deny 规则，消除"空壳恒放行"。
    //
    // ⚠️ 2026-10-20（静态导入图瘦身 P2）：**不再在构造期同步**。
    // `security ↔ permission` 是**循环依赖**，构造期 `new RuleManager()` 的成败取决于
    // import 求值顺序 —— 把 `chronos` 移出启动图后即实测到
    // `ReferenceError: Cannot access 'RuleManager' before initialization` ⇒ 规则同步被
    // catch 吞掉、静默退回默认放行（安全姿态被悄悄削弱，属 CD07 类问题）。
    // ⇒ 改为**首次判定时惰性同步**（`ensureRulesSynced()`）：语义不变（判定前规则必已就绪）、
    //    且与 import 顺序无关。见 `dev_docs/20261020/静态导入图瘦身-方案.md` §4.3。
  }

  /**
   * 惰性同步主模块 deny 规则（幂等）
   *
   * 所有**读取规则**的入口都先调本方法 ⇒ 判定永远发生在同步之后；
   * 失败时只尝试一次（与改造前的"构造期一次性尝试"同口径），不每次判定都刷 warn。
   */
  private ensureRulesSynced(): void {
    if (this.rulesSynced || this.rulesSyncAttempted) return;
    this.rulesSyncAttempted = true;
    this.rulesSynced = this.syncRulesFromMainModule();
  }

  /**
   * P0-3：同步主权限模块的 deny 规则（只读），使本管理器能拒绝已配置禁止的工具。
   * 主模块为异步决策链路（ChatManager 工具执行门禁），本管理器为 SecurityIntegration 的同步补充视图；
   * 两者共用同一规则存储，杜绝双实现规则不一致。
   */
  private syncRulesFromMainModule(): boolean {
    try {
      const mainRules = new RuleManager().loadRules();
      for (const rule of mainRules) {
        if (rule.behavior === PermissionBehavior.DENY && rule.toolName) {
          this.rules.set(`deny:${rule.toolName}`, {
            id: `deny:${rule.toolName}`,
            type: PermissionType.TOOL,
            name: rule.toolName,
            allowed: false,
            description: rule.contentPattern
              ? `Deny ${rule.toolName} (pattern: ${rule.contentPattern})`
              : `Deny ${rule.toolName}`,
            createdAt: new Date(),
          });
        }
      }
      if (this.rules.size > 0) {
        logger.info(`已从主权限模块同步 ${this.rules.size} 条 deny 规则`);
      }
      return true;
    } catch (error) {
      logger.warn('从主权限模块同步规则失败（保持默认行为）', {
        error: String(error),
      });
      return false;
    }
  }

  public static getInstance(): SecurityPermissionView {
    if (!SecurityPermissionView.instance) {
      SecurityPermissionView.instance = new SecurityPermissionView();
    }
    return SecurityPermissionView.instance;
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
      void handleError(error, {
        module: 'security:permMgr',
        action: '初始化权限管理器失败',
      });
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
    // 判定前先确保主模块 deny 规则已同步（惰性、幂等；见 `ensureRulesSynced()`）
    this.ensureRulesSynced();
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
    this.ensureRulesSynced();
    return Array.from(this.rules.values());
  }

  /**
   * 获取规则数量
   */
  getRuleCount(): number {
    this.ensureRulesSynced();
    return this.rules.size;
  }

  /**
   * 获取规则
   * @param ruleId 规则ID
   */
  getRule(ruleId: string): PermissionRule | undefined {
    this.ensureRulesSynced();
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
    this.ensureRulesSynced();
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
      void handleError(error, {
        module: 'security:permMgr',
        action: '停止权限管理器失败',
      });
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
