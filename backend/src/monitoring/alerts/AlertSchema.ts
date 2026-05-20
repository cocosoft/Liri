/**
 * 告警规则模板 JSON Schema
 * 定义预置告警规则文件的格式规范，支持多条件、路由和抑制配置
 */

/**
 * 告警级别
 */
export type PresetAlertLevel = 'info' | 'warning' | 'error' | 'critical';

/**
 * 告警条件类型
 */
export type PresetConditionType =
  | 'threshold'
  | 'rate'
  | 'anomaly'
  | 'expression';

/**
 * 预置告警条件
 */
export interface AlertPresetCondition {
  type: PresetConditionType;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: number;
  window?: number;
  count?: number;
  expression?: string;
}

/**
 * 预置告警通知渠道
 */
export interface AlertPresetChannel {
  type: 'log' | 'console';
  severity?: PresetAlertLevel[];
  config?: Record<string, unknown>;
}

/**
 * 预置告警规则
 */
export interface AlertPresetRule {
  name: string;
  description: string;
  level: PresetAlertLevel;
  conditions: AlertPresetCondition[];
  conditionOperator: 'and' | 'or';
  cooldown: number;
  enabled: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  channels?: AlertPresetChannel[];
}

/**
 * 预置文件元数据
 */
export interface AlertPresetMetadata {
  name: string;
  version: string;
  description: string;
  category: string;
  author: string;
  created: string;
}

/**
 * 预置告警文件顶层结构
 */
export interface AlertPresetFile {
  $schema: string;
  metadata: AlertPresetMetadata;
  rules: AlertPresetRule[];
}

/**
 * 预置文件校验结果
 */
export interface AlertPresetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 预置模式校验器
 * 校验预置告警规则文件是否符合 JSON Schema
 */
export class AlertPresetValidator {
  private static readonly REQUIRED_RULE_FIELDS: (keyof AlertPresetRule)[] = [
    'name',
    'level',
    'conditions',
    'conditionOperator',
    'cooldown',
    'enabled',
  ];

  private static readonly VALID_LEVELS: PresetAlertLevel[] = [
    'info',
    'warning',
    'error',
    'critical',
  ];

  private static readonly VALID_OPERATORS: string[] = [
    '>',
    '<',
    '>=',
    '<=',
    '==',
    '!=',
  ];

  /**
   * 校验预置文件结构
   * @param data 解析后的预置文件数据
   */
  static validate(data: unknown): AlertPresetValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data || typeof data !== 'object') {
      return {
        valid: false,
        errors: ['预置文件必须是 JSON 对象'],
        warnings: [],
      };
    }

    const preset = data as Record<string, unknown>;

    if (!preset.metadata || typeof preset.metadata !== 'object') {
      errors.push('缺少 metadata 字段');
    } else {
      this.validateMetadata(preset.metadata as Record<string, unknown>, errors);
    }

    if (!Array.isArray(preset.rules)) {
      errors.push('rules 字段必须是数组');
    } else {
      const rules = preset.rules as unknown[];
      for (let i = 0; i < rules.length; i++) {
        this.validateRule(rules[i], i, errors, warnings);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 校验元数据
   */
  private static validateMetadata(
    metadata: Record<string, unknown>,
    errors: string[]
  ): void {
    if (typeof metadata.name !== 'string') {
      errors.push('metadata.name 必须是字符串');
    }
    if (typeof metadata.version !== 'string') {
      errors.push('metadata.version 必须是字符串');
    }
    if (typeof metadata.category !== 'string') {
      errors.push('metadata.category 必须是字符串');
    }
  }

  /**
   * 校验单条规则
   */
  private static validateRule(
    rule: unknown,
    index: number,
    errors: string[],
    warnings: string[]
  ): void {
    if (!rule || typeof rule !== 'object') {
      errors.push(`rules[${index}] 必须是对象`);
      return;
    }

    const r = rule as Record<string, unknown>;
    const prefix = `rules[${index}]`;

    for (const field of this.REQUIRED_RULE_FIELDS) {
      if (r[field] === undefined || r[field] === null) {
        errors.push(`${prefix}.${field} 是必填字段`);
      }
    }

    if (r.name !== undefined && typeof r.name !== 'string') {
      errors.push(`${prefix}.name 必须是字符串`);
    }

    if (
      r.level !== undefined &&
      !this.VALID_LEVELS.includes(r.level as PresetAlertLevel)
    ) {
      errors.push(
        `${prefix}.level 必须是 ${this.VALID_LEVELS.join(', ')} 之一`
      );
    }

    if (Array.isArray(r.conditions)) {
      const conditions = r.conditions as unknown[];
      if (conditions.length === 0) {
        errors.push(`${prefix}.conditions 至少需要一条条件`);
      }
      for (let j = 0; j < conditions.length; j++) {
        this.validateCondition(
          conditions[j],
          `${prefix}.conditions[${j}]`,
          errors
        );
      }
    } else {
      errors.push(`${prefix}.conditions 必须是数组`);
    }

    if (
      r.conditionOperator !== undefined &&
      r.conditionOperator !== 'and' &&
      r.conditionOperator !== 'or'
    ) {
      errors.push(`${prefix}.conditionOperator 必须是 'and' 或 'or'`);
    }

    if (
      r.cooldown !== undefined &&
      (typeof r.cooldown !== 'number' || r.cooldown < 0)
    ) {
      errors.push(`${prefix}.cooldown 必须是非负整数`);
    }

    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') {
      errors.push(`${prefix}.enabled 必须是布尔值`);
    }

    if (
      r.cooldown !== undefined &&
      typeof r.cooldown === 'number' &&
      r.cooldown < 1000
    ) {
      warnings.push(`${prefix}.cooldown 小于 1 秒可能导致频繁告警`);
    }
  }

  /**
   * 校验单条条件
   */
  private static validateCondition(
    condition: unknown,
    prefix: string,
    errors: string[]
  ): void {
    if (!condition || typeof condition !== 'object') {
      errors.push(`${prefix} 必须是对象`);
      return;
    }

    const c = condition as Record<string, unknown>;
    if (typeof c.metric !== 'string') {
      errors.push(`${prefix}.metric 必须是字符串`);
    }
    if (
      c.operator !== undefined &&
      !this.VALID_OPERATORS.includes(c.operator as string)
    ) {
      errors.push(
        `${prefix}.operator 必须是 ${this.VALID_OPERATORS.join(', ')} 之一`
      );
    }
    if (c.value !== undefined && typeof c.value !== 'number') {
      errors.push(`${prefix}.value 必须是数字`);
    }
  }
}

/**
 * 已加载的预置告警规则
 */
export interface LoadedPresetRule {
  presetName: string;
  presetCategory: string;
  presetVersion: string;
  rule: AlertPresetRule;
}

/**
 * 预置加载器配置
 */
export interface AlertPresetLoaderConfig {
  presetsDir: string;
  enabled: boolean;
  validateBeforeLoad: boolean;
}
