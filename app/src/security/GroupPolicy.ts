/**
 * GroupPolicy 组策略管理
 * 定义基于用户组的工具访问策略，支持角色继承和策略优先级
 * 对标 Hermes security/policies/group-policy.ts
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { EventEmitter } from 'node:events';

/**
 * 策略效果
 */
export type PolicyEffect = 'allow' | 'deny';

/**
 * 策略定义
 */
export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  tools: string[];
  resources?: string[];
  conditions?: Record<string, unknown>;
  priority: number;
  description: string;
}

/**
 * 用户组定义
 */
export interface UserGroup {
  id: string;
  name: string;
  parentIds: string[];
  policies: PolicyRule[];
  inheritable: boolean;
}

/**
 * 组成员
 */
export interface GroupMember {
  userId: string;
  groupId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
}

/**
 * 策略评估结果
 */
export interface PolicyEvaluation {
  allowed: boolean;
  ruleId: string | null;
  ruleDescription: string;
  matchedTool: string;
  reason: string;
}

/**
 * 组策略配置
 */
export interface GroupPolicyConfig {
  defaultEffect: PolicyEffect;
  maxPolicyDepth: number;
  enableInheritance: boolean;
}

const DEFAULT_CONFIG: GroupPolicyConfig = {
  defaultEffect: 'deny',
  maxPolicyDepth: 5,
  enableInheritance: true,
};

/**
 * 组策略管理器
 */
export class GroupPolicy extends EventEmitter {
  private config: GroupPolicyConfig;
  private groups: Map<string, UserGroup>;
  private members: Map<string, GroupMember[]>;

  constructor(config?: Partial<GroupPolicyConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.groups = new Map();
    this.members = new Map();
  }

  /**
   * 注册用户组
   */
  registerGroup(group: UserGroup): void {
    if (this.groups.has(group.id)) {
      throw new AppError(
        `用户组已存在: ${group.id}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'ENTITY_EXISTS',
        { groupId: group.id }
      );
    }

    this.validateGroup(group);
    this.groups.set(group.id, group);
    this.emit('group:registered', { groupId: group.id, name: group.name });
  }

  /**
   * 注销用户组
   */
  unregisterGroup(groupId: string): boolean {
    const removed = this.groups.delete(groupId);

    if (removed) {
      this.members.delete(groupId);
      this.emit('group:unregistered', { groupId });
    }

    return removed;
  }

  /**
   * 添加组成员
   */
  addMember(
    userId: string,
    groupId: string,
    role: GroupMember['role'] = 'member'
  ): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const members = this.members.get(groupId) || [];
    const existing = members.findIndex((m) => m.userId === userId);

    if (existing >= 0) {
      members[existing].role = role;
    } else {
      members.push({ userId, groupId, role, joinedAt: Date.now() });
    }

    this.members.set(groupId, members);
    this.emit('member:added', { userId, groupId, role });

    return true;
  }

  /**
   * 移除组成员
   */
  removeMember(userId: string, groupId: string): boolean {
    const members = this.members.get(groupId);
    if (!members) return false;

    const filtered = members.filter((m) => m.userId !== userId);

    if (filtered.length === members.length) return false;

    this.members.set(groupId, filtered);
    this.emit('member:removed', { userId, groupId });

    return true;
  }

  /**
   * 获取用户所在的所有组
   */
  getUserGroups(userId: string): UserGroup[] {
    const result: UserGroup[] = [];

    for (const [groupId, members] of this.members.entries()) {
      if (members.some((m) => m.userId === userId)) {
        const group = this.groups.get(groupId);
        if (group) result.push(group);
      }
    }

    return result;
  }

  /**
   * 获取用户的所有策略（含继承）
   */
  getUserPolicies(userId: string): PolicyRule[] {
    const policies: PolicyRule[] = [];
    const visited = new Set<string>();
    const userGroups = this.getUserGroups(userId);

    const collectPolicies = (groupId: string, depth: number): void => {
      if (depth > this.config.maxPolicyDepth) return;
      if (visited.has(groupId)) return;
      visited.add(groupId);

      const group = this.groups.get(groupId);
      if (!group) return;

      policies.push(...group.policies);

      if (this.config.enableInheritance) {
        for (const parentId of group.parentIds) {
          const parentGroup = this.groups.get(parentId);
          if (parentGroup && parentGroup.inheritable) {
            collectPolicies(parentId, depth + 1);
          }
        }
      }
    };

    for (const group of userGroups) {
      collectPolicies(group.id, 0);
    }

    return policies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 评估用户对工具的访问权限
   */
  evaluate(userId: string, toolName: string): PolicyEvaluation {
    const policies = this.getUserPolicies(userId);
    const matchedRules = policies.filter(
      (p) => p.tools.includes('*') || p.tools.includes(toolName)
    );

    if (matchedRules.length === 0) {
      return {
        allowed: this.config.defaultEffect === 'allow',
        ruleId: null,
        ruleDescription: '无匹配策略，使用默认效果',
        matchedTool: toolName,
        reason: `默认${this.config.defaultEffect === 'allow' ? '允许' : '拒绝'}`,
      };
    }

    const highestPriorityRule = matchedRules.reduce((max, rule) =>
      rule.priority > max.priority ? rule : max
    );

    return {
      allowed: highestPriorityRule.effect === 'allow',
      ruleId: highestPriorityRule.id,
      ruleDescription: highestPriorityRule.description,
      matchedTool: toolName,
      reason: `策略 "${highestPriorityRule.id}" ${highestPriorityRule.effect === 'allow' ? '允许' : '拒绝'} 访问 ${toolName}`,
    };
  }

  /**
   * 在策略中添加规则到指定组
   */
  addRule(groupId: string, rule: PolicyRule): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const existingIdx = group.policies.findIndex((r) => r.id === rule.id);

    if (existingIdx >= 0) {
      group.policies[existingIdx] = rule;
    } else {
      group.policies.push(rule);
    }

    this.emit('rule:added', { groupId, ruleId: rule.id });
    return true;
  }

  /**
   * 删除组中的策略规则
   */
  removeRule(groupId: string, ruleId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const before = group.policies.length;
    group.policies = group.policies.filter((r) => r.id !== ruleId);

    if (group.policies.length < before) {
      this.emit('rule:removed', { groupId, ruleId });
      return true;
    }

    return false;
  }

  /**
   * 获取指定组的成员列表
   */
  getGroupMembers(groupId: string): GroupMember[] {
    return this.members.get(groupId) || [];
  }

  /**
   * 获取所有注册的组
   */
  getAllGroups(): UserGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * 验证组的合法性
   */
  private validateGroup(group: UserGroup): void {
    if (!group.id || group.id.trim() === '') {
      throw new AppError(
        '组 ID 不能为空',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { field: 'id' }
      );
    }

    if (!group.name || group.name.trim() === '') {
      throw new AppError(
        '组名称不能为空',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { field: 'name' }
      );
    }

    for (const parentId of group.parentIds) {
      if (!this.groups.has(parentId) && parentId !== group.id) {
        throw new AppError(
          `父组不存在: ${parentId}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'ENTITY_NOT_FOUND',
          { parentId }
        );
      }
    }
  }
}
