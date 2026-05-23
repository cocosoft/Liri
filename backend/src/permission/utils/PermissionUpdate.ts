/**
 * 权限更新管理器
 * 支持运行时动态更新权限规则
 * 参考CC源码 cc_code/backend/utils/permissions/permissionUpdate.ts 实现
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });
import type { PermissionRule } from '../types/PermissionRule.js';

/**
 * 权限更新类型
 */
export type PermissionUpdateType =
  | 'add_rule'
  | 'remove_rule'
  | 'update_rule'
  | 'replace_all';

/**
 * 权限更新范围
 */
export type PermissionUpdateScope = 'session' | 'permanent';

/**
 * 权限更新
 */
export interface PermissionUpdate {
  /** 更新ID */
  id: string;
  /** 更新类型 */
  type: PermissionUpdateType;
  /** 规则ID（用于update和remove） */
  ruleId?: string;
  /** 新规则（用于add和update） */
  rule?: PermissionRule;
  /** 规则列表（用于replace_all） */
  rules?: PermissionRule[];
  /** 更新范围 */
  scope: PermissionUpdateScope;
  /** 更新时间 */
  timestamp: number;
  /** 更新原因 */
  reason: string;
  /** 是否已应用 */
  applied: boolean;
}

/**
 * 权限更新验证结果
 */
export interface PermissionUpdateValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 权限更新配置
 */
export interface PermissionUpdateConfig {
  /** 是否允许临时更新 */
  allowSessionUpdates: boolean;
  /** 是否允许永久更新 */
  allowPermanentUpdates: boolean;
  /** 最大规则数 */
  maxRules: number;
  /** 需要确认的操作 */
  requireConfirmation: PermissionUpdateType[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PermissionUpdateConfig = {
  allowSessionUpdates: true,
  allowPermanentUpdates: false,
  maxRules: 1000,
  requireConfirmation: ['replace_all'],
};

/**
 * 权限更新验证器
 */
export class PermissionUpdateValidator {
  /**
   * 验证更新
   */
  validate(
    update: PermissionUpdate,
    existingRules: PermissionRule[]
  ): PermissionUpdateValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证更新类型
    if (
      !['add_rule', 'remove_rule', 'update_rule', 'replace_all'].includes(
        update.type
      )
    ) {
      errors.push(`Invalid update type: ${update.type}`);
    }

    // 验证范围
    if (!['session', 'permanent'].includes(update.scope)) {
      errors.push(`Invalid scope: ${update.scope}`);
    }

    // 验证规则
    switch (update.type) {
      case 'add_rule':
        if (!update.rule) {
          errors.push('Missing rule for add_rule update');
        } else {
          const ruleValidation = this.validateRule(update.rule, existingRules);
          errors.push(...ruleValidation.errors);
          warnings.push(...ruleValidation.warnings);
        }
        break;

      case 'update_rule':
        if (!update.ruleId) {
          errors.push('Missing ruleId for update_rule update');
        }
        if (!update.rule) {
          errors.push('Missing rule for update_rule update');
        } else {
          const ruleValidation = this.validateRule(
            update.rule,
            existingRules,
            update.ruleId
          );
          errors.push(...ruleValidation.errors);
          warnings.push(...ruleValidation.warnings);
        }
        break;

      case 'remove_rule':
        if (!update.ruleId) {
          errors.push('Missing ruleId for remove_rule update');
        } else {
          const exists = existingRules.some((r) => r.id === update.ruleId);
          if (!exists) {
            warnings.push(`Rule ${update.ruleId} does not exist`);
          }
        }
        break;

      case 'replace_all':
        if (!update.rules) {
          errors.push('Missing rules for replace_all update');
        } else {
          if (update.rules.length > DEFAULT_CONFIG.maxRules) {
            errors.push(
              `Too many rules: ${update.rules.length}, max: ${DEFAULT_CONFIG.maxRules}`
            );
          }
          for (const rule of update.rules) {
            const ruleValidation = this.validateRule(rule, []);
            errors.push(...ruleValidation.errors);
          }
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 验证规则
   */
  private validateRule(
    rule: PermissionRule,
    existingRules: PermissionRule[],
    excludeId?: string
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rule.id) {
      errors.push('Rule missing id');
    }

    if (!rule.toolName) {
      errors.push('Rule missing tool name');
    }

    if (!rule.behavior) {
      errors.push('Rule missing behavior');
    }

    if (rule.id) {
      const duplicate = existingRules.find(
        (r) => r.id === rule.id && r.id !== excludeId
      );
      if (duplicate) {
        errors.push(`Duplicate rule id: ${rule.id}`);
      }
    }

    return { errors, warnings };
  }
}

/**
 * 权限更新管理器
 */
export class PermissionUpdateManager {
  private updates: PermissionUpdate[] = [];
  private config: PermissionUpdateConfig;
  private validator: PermissionUpdateValidator;
  private listeners: Array<(update: PermissionUpdate) => void> = [];

  constructor(config: Partial<PermissionUpdateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.validator = new PermissionUpdateValidator();
  }

  /**
   * 创建更新
   */
  createUpdate(params: {
    type: PermissionUpdateType;
    ruleId?: string;
    rule?: PermissionRule;
    rules?: PermissionRule[];
    scope: PermissionUpdateScope;
    reason: string;
  }): PermissionUpdate {
    return {
      id: this.generateId(),
      type: params.type,
      ruleId: params.ruleId,
      rule: params.rule,
      rules: params.rules,
      scope: params.scope,
      timestamp: Date.now(),
      reason: params.reason,
      applied: false,
    };
  }

  /**
   * 应用更新
   */
  applyUpdate(
    update: PermissionUpdate,
    existingRules: PermissionRule[]
  ): { success: boolean; rules: PermissionRule[]; errors: string[] } {
    // 验证更新
    const validation = this.validator.validate(update, existingRules);
    if (!validation.valid) {
      return {
        success: false,
        rules: existingRules,
        errors: validation.errors,
      };
    }

    let newRules = [...existingRules];

    switch (update.type) {
      case 'add_rule':
        if (update.rule) {
          newRules.push(update.rule);
        }
        break;

      case 'update_rule':
        if (update.ruleId && update.rule) {
          const index = newRules.findIndex((r) => r.id === update.ruleId);
          if (index >= 0) {
            newRules[index] = update.rule;
          }
        }
        break;

      case 'remove_rule':
        if (update.ruleId) {
          newRules = newRules.filter((r) => r.id !== update.ruleId);
        }
        break;

      case 'replace_all':
        if (update.rules) {
          newRules = update.rules;
        }
        break;
    }

    // 标记更新为已应用
    update.applied = true;
    this.updates.push(update);

    // 限制更新历史
    if (this.updates.length > 100) {
      this.updates = this.updates.slice(-100);
    }

    logger.info(
      `PermissionUpdate: Applied ${update.type} in ${update.scope} scope`
    );

    // 通知监听器
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch (error) {
        logger.error('PermissionUpdate: Listener error:', error);
      }
    }

    return {
      success: true,
      rules: newRules,
      errors: validation.warnings,
    };
  }

  /**
   * 验证更新
   */
  validate(
    update: PermissionUpdate,
    existingRules: PermissionRule[]
  ): PermissionUpdateValidation {
    return this.validator.validate(update, existingRules);
  }

  /**
   * 获取更新历史
   */
  getHistory(): PermissionUpdate[] {
    return [...this.updates];
  }

  /**
   * 获取会话更新
   */
  getSessionUpdates(): PermissionUpdate[] {
    return this.updates.filter((u) => u.scope === 'session');
  }

  /**
   * 获取永久更新
   */
  getPermanentUpdates(): PermissionUpdate[] {
    return this.updates.filter((u) => u.scope === 'permanent');
  }

  /**
   * 添加监听器
   */
  addListener(listener: (update: PermissionUpdate) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: (update: PermissionUpdate) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 清除会话更新
   */
  clearSessionUpdates(): void {
    this.updates = this.updates.filter((u) => u.scope !== 'session');
  }

  /**
   * 获取配置
   */
  getConfig(): PermissionUpdateConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PermissionUpdateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `perm_update_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * 导出单例
 */
export const permissionUpdateManager = new PermissionUpdateManager();
