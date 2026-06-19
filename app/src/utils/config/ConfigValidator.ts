/**
 * 配置验证器
 */

export enum ConfigSource {
  DEFAULT = 'default',
  ENV = 'env',
  FILE = 'file',
  RUNTIME = 'runtime',
}

export interface ConfigValidationRule<T = unknown> {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function';
  required?: boolean;
  default?: T;
  validate?: (value: unknown) => boolean;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ValidationWarning[];
}

export interface ConfigValidationError {
  key: string;
  message: string;
  value?: unknown;
}

export interface ValidationWarning {
  key: string;
  message: string;
  value?: unknown;
}

export class ConfigValidator {
  private rules: Map<string, ConfigValidationRule> = new Map();

  addRule(rule: ConfigValidationRule): void {
    this.rules.set(rule.key, rule);
  }

  addRules(rules: ConfigValidationRule[]): void {
    for (const rule of rules) {
      this.addRule(rule);
    }
  }

  removeRule(key: string): void {
    this.rules.delete(key);
  }

  getRule(key: string): ConfigValidationRule | undefined {
    return this.rules.get(key);
  }

  validate(config: Record<string, unknown>): ValidationResult {
    const errors: ConfigValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const [key, rule] of this.rules) {
      const value = config[key];

      if (rule.required && (value === undefined || value === null)) {
        if (rule.default !== undefined) {
          warnings.push({
            key,
            message: `Missing required key, using default: ${rule.default}`,
            value: rule.default,
          });
        } else {
          errors.push({
            key,
            message: rule.message || `Missing required key: ${key}`,
            value,
          });
        }
        continue;
      }

      if (value !== undefined && value !== null) {
        const typeError = this.validateType(key, value, rule);
        if (typeError) {
          errors.push(typeError);
          continue;
        }

        if (rule.validate && !rule.validate(value)) {
          errors.push({
            key,
            message: rule.message || `Validation failed for: ${key}`,
            value,
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateType(
    key: string,
    value: unknown,
    rule: ConfigValidationRule
  ): ValidationError | null {
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (actualType !== rule.type) {
      return {
        key,
        message: `Expected type ${rule.type} for ${key}, got ${actualType}`,
        value,
      };
    }

    return null;
  }

  applyDefaults(config: Record<string, unknown>): Record<string, unknown> {
    const result = { ...config };

    for (const [key, rule] of this.rules) {
      if (
        (result[key] === undefined || result[key] === null) &&
        rule.default !== undefined
      ) {
        result[key] = rule.default;
      }
    }

    return result;
  }

  extractWarnings(config: Record<string, unknown>): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    for (const [key, rule] of this.rules) {
      const value = config[key];

      if (rule.required && value === undefined && rule.default !== undefined) {
        warnings.push({
          key,
          message: `Using default value for required key`,
          value: rule.default,
        });
      }
    }

    return warnings;
  }
}

export function createConfigValidator(
  rules?: ConfigValidationRule[]
): ConfigValidator {
  const validator = new ConfigValidator();
  if (rules) {
    validator.addRules(rules);
  }
  return validator;
}

export function validateRequiredKeys(
  config: Record<string, unknown>,
  requiredKeys: string[]
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const key of requiredKeys) {
    if (config[key] === undefined || config[key] === null) {
      errors.push({
        key,
        message: `Missing required key: ${key}`,
        value: config[key],
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}

export function validateTypes(
  config: Record<string, unknown>,
  typeMap: Record<string, string>
): ValidationResult {
  const errors: ConfigValidationError[] = [];

  for (const [key, expectedType] of Object.entries(typeMap)) {
    const value = config[key];
    if (value === undefined || value === null) continue;

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== expectedType) {
      errors.push({
        key,
        message: `Expected type ${expectedType} for ${key}, got ${actualType}`,
        value,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };
}
