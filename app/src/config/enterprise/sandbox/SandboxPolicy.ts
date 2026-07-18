/**
 * SandboxPolicy — 企业版沙箱策略
 *
 * 定义沙箱操作权限的細粒度策略规则。
 * 每条策略包含多个规则，规则按优先级排序。
 */

import { Logger, LogLevel } from '../../../monitoring/logs/Logger.js';

const logger = new Logger({
  module: 'config:enterprise:sandbox:sandboxPolicy',
  level: LogLevel.INFO,
});

/** 策略规则条件操作符 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'matches'
  | 'in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

/** 策略规则条件 */
export interface PolicyCondition {
  /** 条件字段路径 */
  field: string;
  /** 操作符 */
  operator: ConditionOperator;
  /** 目标值 */
  value: unknown;
}

/** 策略规则效果 */
export type RuleEffect = 'allow' | 'deny';

/** 策略规则 */
export interface PolicyRule {
  /** 规则名称 */
  name: string;
  /** 操作标识 */
  operation: string;
  /** 效果 */
  effect: RuleEffect;
  /** 优先级（数值越小优先级越高） */
  priority: number;
  /** 生效条件 */
  conditions: PolicyCondition[];
  /** 规则描述 */
  description?: string;
}

/** 策略决策 */
export interface PolicyDecision {
  /** 是否允许 */
  allowed: boolean;
  /** 原因 */
  reason?: string;
  /** 触发规则的名称 */
  matchedRule?: string;
}

/** 沙箱策略配置 */
export interface SandboxPolicyConfig {
  /** 策略名称 */
  name: string;
  /** 策略版本 */
  version?: string;
  /** 规则列表 */
  rules: PolicyRule[];
  /** 默认决策 */
  defaultEffect?: RuleEffect;
  /** 策略描述 */
  description?: string;
}

/** 策略评估上下文 */
export interface EvaluationContext {
  /** 操作参数字段 */
  [key: string]: unknown;
}

/**
 * 沙箱策略
 * 包含多条规则，按优先级评估。
 */
export class SandboxPolicy {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly defaultEffect: RuleEffect;
  private rules: PolicyRule[];

  constructor(config: SandboxPolicyConfig) {
    this.name = config.name;
    this.version = config.version || '1.0.0';
    this.description = config.description || '';
    this.defaultEffect = config.defaultEffect || 'deny';
    this.rules = [...config.rules].sort((a, b) => a.priority - b.priority);
  }

  /**
   * 评估给定操作在此策略下是否允许
   */
  evaluate(operation: string, context: EvaluationContext): PolicyDecision {
    const matchedRules = this.rules.filter((r) =>
      this.matchOperation(r.operation, operation)
    );

    for (const rule of matchedRules) {
      if (this.evaluateConditions(rule.conditions, context)) {
        if (rule.effect === 'allow') {
          return {
            allowed: true,
            reason: rule.description,
            matchedRule: rule.name,
          };
        }
        return {
          allowed: false,
          reason: rule.description || '策略拒绝',
          matchedRule: rule.name,
        };
      }
    }

    if (this.defaultEffect === 'allow') {
      return { allowed: true, reason: `默认允许（未匹配到规则）` };
    }
    return { allowed: false, reason: `默认拒绝（未匹配到规则）` };
  }

  private matchOperation(pattern: string, operation: string): boolean {
    if (pattern === '*') return true;
    if (pattern === operation) return true;

    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return operation.startsWith(prefix);
    }

    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(operation);
    }

    return false;
  }

  private evaluateConditions(
    conditions: PolicyCondition[],
    context: EvaluationContext
  ): boolean {
    return conditions.every((c) => this.evaluateCondition(c, context));
  }

  private evaluateCondition(
    condition: PolicyCondition,
    context: EvaluationContext
  ): boolean {
    const actualValue = this.resolveField(condition.field, context);
    const expectedValue = condition.value;

    switch (condition.operator) {
      case 'equals':
        return actualValue === expectedValue;
      case 'not_equals':
        return actualValue !== expectedValue;
      case 'contains':
        if (
          typeof actualValue === 'string' &&
          typeof expectedValue === 'string'
        ) {
          return actualValue.includes(expectedValue);
        }
        if (Array.isArray(actualValue)) {
          return actualValue.includes(expectedValue);
        }
        return false;
      case 'starts_with':
        return (
          typeof actualValue === 'string' &&
          typeof expectedValue === 'string' &&
          actualValue.startsWith(expectedValue)
        );
      case 'matches':
        if (
          typeof actualValue === 'string' &&
          typeof expectedValue === 'string'
        ) {
          try {
            return new RegExp(expectedValue).test(actualValue);
          } catch {
            return false;
          }
        }
        return false;
      case 'in':
        return (
          Array.isArray(expectedValue) && expectedValue.includes(actualValue)
        );
      case 'gt':
        return (
          typeof actualValue === 'number' &&
          typeof expectedValue === 'number' &&
          actualValue > expectedValue
        );
      case 'gte':
        return (
          typeof actualValue === 'number' &&
          typeof expectedValue === 'number' &&
          actualValue >= expectedValue
        );
      case 'lt':
        return (
          typeof actualValue === 'number' &&
          typeof expectedValue === 'number' &&
          actualValue < expectedValue
        );
      case 'lte':
        return (
          typeof actualValue === 'number' &&
          typeof expectedValue === 'number' &&
          actualValue <= expectedValue
        );
      default:
        return false;
    }
  }

  private resolveField(field: string, context: EvaluationContext): unknown {
    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      if (
        typeof value === 'object' &&
        part in (value as Record<string, unknown>)
      ) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * 添加规则
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 移除规则
   */
  removeRule(ruleName: string): boolean {
    const index = this.rules.findIndex((r) => r.name === ruleName);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取所有规则
   */
  getRules(): readonly PolicyRule[] {
    return [...this.rules];
  }

  /**
   * 创建默认的沙箱策略
   */
  static createDefault(name: string = 'default'): SandboxPolicy {
    const rules: PolicyRule[] = [
      {
        name: 'allow-file-read-temp',
        operation: 'file.read',
        effect: 'allow',
        priority: 10,
        conditions: [{ field: 'path', operator: 'starts_with', value: '/tmp' }],
        description: '允许读取临时目录文件',
      },
      {
        name: 'deny-file-read-etc',
        operation: 'file.read',
        effect: 'deny',
        priority: 20,
        conditions: [{ field: 'path', operator: 'starts_with', value: '/etc' }],
        description: '禁止读取系统配置目录',
      },
      {
        name: 'deny-network-all',
        operation: 'network.*',
        effect: 'deny',
        priority: 30,
        conditions: [],
        description: '禁止所有网络访问',
      },
      {
        name: 'allow-process-read',
        operation: 'process.read',
        effect: 'allow',
        priority: 40,
        conditions: [],
        description: '允许读取进程信息',
      },
      {
        name: 'deny-process-write',
        operation: 'process.write',
        effect: 'deny',
        priority: 50,
        conditions: [],
        description: '禁止写入进程信息',
      },
    ];

    return new SandboxPolicy({
      name,
      rules,
      defaultEffect: 'deny',
      description: '默认沙箱安全策略',
    });
  }

  /**
   * 创建宽松沙箱策略（适用于个人版）
   */
  static createPermissive(name: string = 'permissive'): SandboxPolicy {
    return new SandboxPolicy({
      name,
      rules: [
        {
          name: 'allow-all-file-temp',
          operation: 'file.*',
          effect: 'allow',
          priority: 10,
          conditions: [
            { field: 'path', operator: 'starts_with', value: '/tmp' },
          ],
          description: '允许临时目录的所有文件操作',
        },
        {
          name: 'allow-file-read',
          operation: 'file.read',
          effect: 'allow',
          priority: 20,
          conditions: [],
          description: '允许读取所有文件',
        },
        {
          name: 'deny-file-write-system',
          operation: 'file.write',
          effect: 'deny',
          priority: 30,
          conditions: [
            { field: 'path', operator: 'starts_with', value: '/etc' },
          ],
          description: '禁止写入系统配置',
        },
      ],
      defaultEffect: 'allow',
      description: '宽松沙箱策略（个人版使用）',
    });
  }
}
