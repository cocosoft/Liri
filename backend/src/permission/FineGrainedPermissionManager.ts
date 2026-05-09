/**
 * 细粒度权限管理器
 * 负责管理和检查细粒度权限
 */

import type {
  PermissionStorage,
  PermissionRule,
  Role,
  User,
  Resource,
  PermissionContext,
  PermissionDecision,
} from './models/Permission.js';
import {
  PermissionAction,
  RoleType,
  ResourceType,
  OperationType,
} from './models/Permission.js';
import { createFilePermissionStorage } from './storage/FilePermissionStorage.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 细粒度权限管理器类
 */
export class FineGrainedPermissionManager {
  /** 权限存储 */
  private storage: PermissionStorage;
  /** 缓存 */
  private cache: Map<string, PermissionDecision> = new Map();

  /**
   * 构造函数
   * @param storage 权限存储
   */
  constructor(storage?: PermissionStorage) {
    this.storage = storage || createFilePermissionStorage();
  }

  /**
   * 检查权限
   * @param context 权限上下文
   * @returns 权限决策
   */
  async checkPermission(
    context: PermissionContext
  ): Promise<PermissionDecision> {
    // 生成缓存键
    const cacheKey = this.generateCacheKey(context);

    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)! as PermissionDecision;
    }

    try {
      // 获取用户
      let user: User | null = null;
      if (context.userId) {
        user = await this.storage.getUser(context.userId);
      }

      // 获取用户角色
      const roles = user?.roles || [RoleType.GUEST];

      // 收集所有相关规则
      const rules: PermissionRule[] = [];

      // 获取资源规则
      const resourceRules = await this.storage.getRulesByResource(
        context.resource.id
      );
      rules.push(...resourceRules);

      // 获取角色规则
      for (const role of roles) {
        const roleObj = await this.storage.getRoleByName(role);
        if (roleObj) {
          rules.push(...roleObj.permissions);
          const roleRules = await this.storage.getRulesByRole(roleObj.id);
          rules.push(...roleRules);
        }
      }

      // 获取用户规则
      if (user) {
        rules.push(...user.permissions);
        const userRules = await this.storage.getRulesByUser(user.id);
        rules.push(...userRules);
      }

      // 按优先级排序（数字越小优先级越高）
      rules.sort((a, b) => a.priority - b.priority);

      // 检查规则
      for (const rule of rules) {
        // 检查操作类型
        if (
          rule.operation !== OperationType.ALL &&
          rule.operation !== context.operation
        ) {
          continue;
        }

        // 检查条件
        if (
          rule.condition &&
          !this.evaluateCondition(rule.condition, context)
        ) {
          continue;
        }

        // 找到匹配的规则
        const decision: PermissionDecision = {
          action: rule.action,
          reason: `Matched rule ${rule.id}`,
          ruleId: rule.id,
        };

        // 缓存结果
        this.cache.set(cacheKey, decision);

        return decision;
      }

      // 默认决策
      const defaultDecision: PermissionDecision = {
        action: PermissionAction.ASK,
        reason: 'No matching rules found',
      };

      // 缓存结果
      this.cache.set(cacheKey, defaultDecision);

      return defaultDecision;
    } catch (error) {
      logger.error('Error checking permission:', { error });
      return {
        action: PermissionAction.DENY,
        reason: 'Error checking permission',
      };
    }
  }

  /**
   * 生成缓存键
   * @param context 权限上下文
   * @returns 缓存键
   */
  private generateCacheKey(context: PermissionContext): string {
    return `${context.userId || 'anonymous'}-${context.role || 'guest'}-${context.resource.id}-${context.operation}`;
  }

  /**
   * 评估条件
   * @param condition 条件表达式
   * @param context 权限上下文
   * @returns 条件是否满足
   */
  private evaluateCondition(
    condition: string,
    context: PermissionContext
  ): boolean {
    try {
      // 简单的条件评估
      // 实际应用中可能需要更复杂的表达式解析
      const env = {
        input: context.input,
        environment: context.environment,
        resource: context.resource,
      };

      // 这里使用 eval 仅用于演示，实际应用中应该使用更安全的表达式解析

      return eval(condition);
    } catch (error) {
      logger.error('Error evaluating condition:', { error });
      return false;
    }
  }

  /**
   * 添加权限规则
   * @param rule 权限规则
   * @returns 规则ID
   */
  async addRule(rule: PermissionRule): Promise<string> {
    const id = await this.storage.saveRule(rule);
    this.clearCache();
    return id;
  }

  /**
   * 更新权限规则
   * @param rule 权限规则
   */
  async updateRule(rule: PermissionRule): Promise<void> {
    await this.storage.updateRule(rule);
    this.clearCache();
  }

  /**
   * 删除权限规则
   * @param id 规则ID
   */
  async deleteRule(id: string): Promise<void> {
    await this.storage.deleteRule(id);
    this.clearCache();
  }

  /**
   * 添加资源
   * @param resource 资源
   * @returns 资源ID
   */
  async addResource(resource: Resource): Promise<string> {
    return await this.storage.saveResource(resource);
  }

  /**
   * 获取资源
   * @param id 资源ID
   * @returns 资源
   */
  async getResource(id: string): Promise<Resource | null> {
    return await this.storage.getResource(id);
  }

  /**
   * 根据路径获取资源
   * @param path 资源路径
   * @param type 资源类型
   * @returns 资源
   */
  async getResourceByPath(
    path: string,
    type: ResourceType
  ): Promise<Resource | null> {
    return await this.storage.getResourceByPath(path, type);
  }

  /**
   * 添加用户
   * @param user 用户
   * @returns 用户ID
   */
  async addUser(user: User): Promise<string> {
    return await this.storage.saveUser(user);
  }

  /**
   * 获取用户
   * @param id 用户ID
   * @returns 用户
   */
  async getUser(id: string): Promise<User | null> {
    return await this.storage.getUser(id);
  }

  /**
   * 添加角色
   * @param role 角色
   * @returns 角色ID
   */
  async addRole(role: Role): Promise<string> {
    return await this.storage.saveRole(role);
  }

  /**
   * 获取角色
   * @param id 角色ID
   * @returns 角色
   */
  async getRole(id: string): Promise<Role | null> {
    return await this.storage.getRole(id);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取权限存储
   * @returns 权限存储
   */
  getStorage(): PermissionStorage {
    return this.storage;
  }
}

/**
 * 创建细粒度权限管理器实例
 * @param storage 权限存储
 * @returns 细粒度权限管理器实例
 */
export function createFineGrainedPermissionManager(
  storage?: PermissionStorage
): FineGrainedPermissionManager {
  return new FineGrainedPermissionManager(storage);
}
