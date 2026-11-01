//
/**
 * 增强权限规则引擎
 * 提供细粒度权限控制、动态规则评估、规则组合等高级功能
 */

import {
  PermissionBehavior,
  PermissionRuleSource,
} from './types/PermissionRule';
import { PermissionContext } from './types/PermissionContext';
import {
  PermissionDecision,
  createAllowDecision,
  createDenyDecision,
  createAskDecision,
} from './types/PermissionDecision';
import { PermissionMode } from './PermissionMode';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('permission\EnhancedPermissionEngine');

/**
 * 规则条件类型
 */
export type RuleCondition =
  | { type: 'always' }
  | { type: 'tool_name'; pattern: string; caseSensitive?: boolean }
  | { type: 'input_pattern'; field: string; pattern: string }
  | {
      type: 'input_value';
      field: string;
      value: unknown;
      operator?: 'equals' | 'contains' | 'startsWith' | 'endsWith';
    }
  | {
      type: 'context_field';
      field: string;
      value: unknown;
      operator?: 'equals' | 'contains';
    }
  | { type: 'role'; roles: string[] }
  | { type: 'time_range'; start: string; end: string }
  | { type: 'ip_address'; allowedIps: string[] }
  | { type: 'custom'; evaluator: (context: PermissionContext) => boolean };

/**
 * 规则效果类型
 */
export type RuleEffect =
  | { type: 'allow'; reason?: string }
  | { type: 'deny'; reason?: string }
  | { type: 'ask'; reason?: string };

/**
 * 增强权限规则
 */
export interface EnhancedPermissionRule {
  /** 规则ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description?: string;
  /** 规则优先级（数值越大优先级越高） */
  priority: number;
  /** 规则条件 */
  conditions: RuleCondition[];
  /** 规则效果 */
  effect: RuleEffect;
  /** 规则来源 */
  source: PermissionRuleSource;
  /** 规则是否启用 */
  enabled: boolean;
  /** 规则创建时间 */
  createdAt?: Date;
  /** 规则更新时间 */
  updatedAt?: Date;
}

/**
 * 规则评估结果
 */
export interface RuleEvaluationResult {
  /** 规则ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 是否匹配 */
  matched: boolean;
  /** 评估的行为 */
  behavior?: PermissionBehavior;
  /** 原因 */
  reason?: string;
}

/**
 * 规则引擎配置
 */
export interface RuleEngineConfig {
  /** 是否启用规则优先级 */
  enablePriority: boolean;
  /** 默认行为 */
  defaultBehavior: PermissionBehavior;
  /** 是否允许规则继承 */
  enableRuleInheritance: boolean;
  /** 是否记录规则评估日志 */
  enableEvaluationLogging: boolean;
}

/**
 * 增强权限规则引擎
 */
export class EnhancedPermissionEngine {
  private rules: EnhancedPermissionRule[] = [];
  private config: RuleEngineConfig;

  constructor(config?: Partial<RuleEngineConfig>) {
    this.config = {
      enablePriority: true,
      defaultBehavior: PermissionBehavior.ALLOW,
      enableRuleInheritance: true,
      enableEvaluationLogging: false,
      ...config,
    };

    // 加载默认规则
    this.loadDefaultRules();
  }

  /**
   * 加载默认规则
   */
  private loadDefaultRules(): void {
    this.rules = [
      // 拒绝危险工具
      {
        id: 'deny-dangerous-tools',
        name: '拒绝危险工具',
        description: '拒绝执行具有潜在危险的工具',
        priority: 100,
        conditions: [
          {
            type: 'tool_name',
            pattern: '^(rm|delete|format|sudo|su|exec|system|shell)$',
          },
        ],
        effect: { type: 'deny', reason: '危险工具已被拒绝' },
        source: PermissionRuleSource.SYSTEM,
        enabled: true,
      },
      // 允许安全工具
      {
        id: 'allow-safe-tools',
        name: '允许安全工具',
        description: '允许执行安全的工具',
        priority: 50,
        conditions: [
          { type: 'tool_name', pattern: '^(list|read|view|get|search|query)$' },
        ],
        effect: { type: 'allow', reason: '安全工具已允许' },
        source: PermissionRuleSource.SYSTEM,
        enabled: true,
      },
      // 限制敏感路径访问
      {
        id: 'deny-sensitive-paths',
        name: '拒绝敏感路径访问',
        description: '拒绝访问系统敏感路径',
        priority: 90,
        conditions: [
          {
            type: 'input_pattern',
            field: 'path',
            pattern: '^(/etc/|/root/|/sys/|/proc/|C:\\\\Windows\\\\)',
          },
        ],
        effect: { type: 'deny', reason: '访问敏感路径已被拒绝' },
        source: PermissionRuleSource.SYSTEM,
        enabled: true,
      },
    ];
  }

  /**
   * 添加规则
   * @param rule 规则对象
   */
  addRule(rule: EnhancedPermissionRule): void {
    const existingIndex = this.rules.findIndex((r) => r.id === rule.id);
    if (existingIndex >= 0) {
      this.rules[existingIndex] = rule;
    } else {
      this.rules.push(rule);
      // 按优先级排序
      if (this.config.enablePriority) {
        this.rules.sort((a, b) => b.priority - a.priority);
      }
    }
  }

  /**
   * 移除规则
   * @param ruleId 规则ID
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  /**
   * 获取所有规则
   * @returns 规则列表
   */
  getRules(): EnhancedPermissionRule[] {
    return [...this.rules];
  }

  /**
   * 根据ID获取规则
   * @param ruleId 规则ID
   * @returns 规则对象
   */
  getRuleById(ruleId: string): EnhancedPermissionRule | undefined {
    return this.rules.find((r) => r.id === ruleId);
  }

  /**
   * 启用/禁用规则
   * @param ruleId 规则ID
   * @param enabled 是否启用
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * 评估单个条件
   * @param condition 条件对象
   * @param context 权限上下文
   * @returns 是否匹配
   */
  private evaluateCondition(
    condition: RuleCondition,
    context: PermissionContext
  ): boolean {
    switch (condition.type) {
      case 'always':
        return true;

      case 'tool_name': {
        const pattern = condition.caseSensitive
          ? condition.pattern
          : condition.pattern.toLowerCase();
        const toolName = condition.caseSensitive
          ? context.toolName
          : context.toolName.toLowerCase();
        return new RegExp(pattern).test(toolName);
      }

      case 'input_pattern': {
        const value = context.input?.[condition.field] as string;
        if (!value) return false;
        return new RegExp(condition.pattern).test(value);
      }

      case 'input_value': {
        const value = context.input?.[condition.field];
        if (value === undefined) return false;

        const operator = condition.operator || 'equals';
        const stringValue = String(value);
        const stringConditionValue = String(condition.value);

        switch (operator) {
          case 'equals':
            return stringValue === stringConditionValue;
          case 'contains':
            return stringValue.includes(stringConditionValue);
          case 'startsWith':
            return stringValue.startsWith(stringConditionValue);
          case 'endsWith':
            return stringValue.endsWith(stringConditionValue);
          default:
            return false;
        }
      }

      case 'context_field': {
        const value = (context as any)?.[condition.field];
        if (value === undefined) return false;

        const operator = condition.operator || 'equals';
        const stringValue = String(value);
        const stringConditionValue = String(condition.value);

        switch (operator) {
          case 'equals':
            return stringValue === stringConditionValue;
          case 'contains':
            return stringValue.includes(stringConditionValue);
          default:
            return false;
        }
      }

      case 'role': {
        const userRole =
          (context.metadata?.userRole as string) || context.userRole || '';
        return (condition.roles as string[]).includes(userRole);
      }

      case 'time_range': {
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5); // HH:MM
        return currentTime >= condition.start && currentTime <= condition.end;
      }

      case 'ip_address': {
        const clientIp = context.clientIp;
        if (!clientIp) return false;

        for (const allowedIp of condition.allowedIps) {
          if (this.matchesIpPattern(clientIp, allowedIp)) {
            return true;
          }
        }
        return false;
      }

      case 'custom': {
        try {
          return condition.evaluator(context);
        } catch {
          // @ignore-catch: custom 条件求值器异常视为不匹配（fail-closed 方向）
          return false;
        }
      }

      default:
        return false;
    }
  }

  /**
   * IP地址模式匹配
   * @param ip IP地址
   * @param pattern IP模式（支持CIDR或通配符）
   * @returns 是否匹配
   */
  private matchesIpPattern(ip: string, pattern: string): boolean {
    // 支持通配符模式
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '\\d+');
      return new RegExp(`^${regexPattern}$`).test(ip);
    }

    // 支持CIDR表示法（简化实现）
    if (pattern.includes('/')) {
      const [network, prefix] = pattern.split('/');
      const prefixNum = parseInt(prefix, 10);

      const ipToBinary = (ipStr: string) =>
        ipStr
          .split('.')
          .map((octet) => parseInt(octet, 10).toString(2).padStart(8, '0'))
          .join('');

      const ipBinary = ipToBinary(ip);
      const networkBinary = ipToBinary(network);

      return ipBinary.startsWith(networkBinary.slice(0, prefixNum));
    }

    // 精确匹配
    return ip === pattern;
  }

  /**
   * 评估规则
   * @param rule 规则对象
   * @param context 权限上下文
   * @returns 评估结果
   */
  evaluateRule(
    rule: EnhancedPermissionRule,
    context: PermissionContext
  ): RuleEvaluationResult {
    // 检查规则是否启用
    if (!rule.enabled) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        matched: false,
      };
    }

    // 评估所有条件（所有条件都必须满足）
    const allConditionsMet = rule.conditions.every((condition) =>
      this.evaluateCondition(condition, context)
    );

    if (allConditionsMet) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        matched: true,
        behavior: rule.effect.type as PermissionBehavior,
        reason: rule.effect.reason,
      };
    }

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: false,
    };
  }

  /**
   * 执行规则评估
   * @param context 权限上下文
   * @param permissionMode 权限模式
   * @returns 权限决策
   */
  evaluate(
    context: PermissionContext,
    permissionMode?: PermissionMode
  ): PermissionDecision {
    const mode = permissionMode || PermissionMode.DEFAULT;

    // 根据权限模式设置默认行为
    let defaultBehavior: PermissionBehavior;
    switch (mode) {
      case PermissionMode.PLAN:
        defaultBehavior = PermissionBehavior.DENY;
        break;
      case PermissionMode.DONT_ASK:
        defaultBehavior = PermissionBehavior.ALLOW;
        break;
      case PermissionMode.BYPASS:
        return createAllowDecision('Bypass mode: all permissions granted');
      case PermissionMode.ACCEPT_EDITS:
        defaultBehavior = PermissionBehavior.ALLOW;
        break;
      default:
        defaultBehavior = PermissionBehavior.ASK;
    }

    // 评估所有规则
    const results: RuleEvaluationResult[] = [];
    let matchedRule: RuleEvaluationResult | null = null;

    for (const rule of this.rules) {
      const result = this.evaluateRule(rule, context);
      results.push(result);

      if (result.matched) {
        // 如果启用优先级，找到第一个匹配的规则后停止
        if (this.config.enablePriority) {
          matchedRule = result;
          break;
        }
        // 否则记录所有匹配的规则
        matchedRule = result;
      }
    }

    // 如果有匹配的规则，返回规则的决策
    if (matchedRule) {
      switch (matchedRule.behavior) {
        case 'allow':
          return createAllowDecision(matchedRule.reason || 'Allowed by rule');
        case 'deny':
          return createDenyDecision(matchedRule.reason || 'Denied by rule');
        case 'ask':
          return createAskDecision(
            matchedRule.reason || 'Requires user approval'
          );
        default:
          break;
      }
    }

    // 返回默认行为
    switch (defaultBehavior) {
      case 'allow':
        return createAllowDecision('Allowed by default');
      case 'deny':
        return createDenyDecision('Denied by default');
      case 'ask':
      default:
        return createAskDecision('Requires user approval by default');
    }
  }

  /**
   * 批量评估规则
   * @param context 权限上下文
   * @returns 所有规则的评估结果
   */
  evaluateAllRules(context: PermissionContext): RuleEvaluationResult[] {
    return this.rules.map((rule) => this.evaluateRule(rule, context));
  }

  /**
   * 获取规则统计信息
   * @returns 统计信息
   */
  getStatistics(): {
    totalRules: number;
    enabledRules: number;
    disabledRules: number;
    allowRules: number;
    denyRules: number;
    askRules: number;
  } {
    return {
      totalRules: this.rules.length,
      enabledRules: this.rules.filter((r) => r.enabled).length,
      disabledRules: this.rules.filter((r) => !r.enabled).length,
      allowRules: this.rules.filter((r) => r.effect.type === 'allow').length,
      denyRules: this.rules.filter((r) => r.effect.type === 'deny').length,
      askRules: this.rules.filter((r) => r.effect.type === 'ask').length,
    };
  }

  /**
   * 导出规则为JSON格式
   * @returns JSON字符串
   */
  exportRules(): string {
    return JSON.stringify(this.rules, null, 2);
  }

  /**
   * 从JSON导入规则
   * @param json JSON字符串
   */
  importRules(json: string): void {
    try {
      const rules = JSON.parse(json) as EnhancedPermissionRule[];
      this.rules = rules;
      if (this.config.enablePriority) {
        this.rules.sort((a, b) => b.priority - a.priority);
      }
    } catch (error) {
      throw new AppError(
        `Failed to import rules: ${(error as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }
}
