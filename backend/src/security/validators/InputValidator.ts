/**
 * 输入验证器
 * 负责验证用户输入的安全性
 */

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  field?: string;
}

/**
 * 验证规则
 */
export interface ValidationRule {
  name: string;
  validate: (value: any, options?: any) => ValidationResult;
}

/**
 * 输入验证器类
 */
export class InputValidator {
  /** 验证规则 */
  private rules: Map<string, ValidationRule> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    this.registerDefaultRules();
  }

  /**
   * 注册默认规则
   */
  private registerDefaultRules(): void {
    // 必需字段
    this.registerRule('required', {
      name: 'required',
      validate: (value) => {
        if (value === undefined || value === null || value === '') {
          return { valid: false, error: '此字段为必填项' };
        }
        return { valid: true };
      },
    });

    // 最小长度
    this.registerRule('minLength', {
      name: 'minLength',
      validate: (value, options) => {
        if (value && value.length < options.min) {
          return { valid: false, error: `长度不能小于 ${options.min} 个字符` };
        }
        return { valid: true };
      },
    });

    // 最大长度
    this.registerRule('maxLength', {
      name: 'maxLength',
      validate: (value, options) => {
        if (value && value.length > options.max) {
          return { valid: false, error: `长度不能超过 ${options.max} 个字符` };
        }
        return { valid: true };
      },
    });

    // 正则表达式
    this.registerRule('pattern', {
      name: 'pattern',
      validate: (value, options) => {
        if (value && !options.pattern.test(value)) {
          return { valid: false, error: options.message || '格式不正确' };
        }
        return { valid: true };
      },
    });

    // 数字范围
    this.registerRule('range', {
      name: 'range',
      validate: (value, options) => {
        const num = Number(value);
        if (isNaN(num)) {
          return { valid: false, error: '必须是数字' };
        }
        if (options.min !== undefined && num < options.min) {
          return { valid: false, error: `不能小于 ${options.min}` };
        }
        if (options.max !== undefined && num > options.max) {
          return { valid: false, error: `不能大于 ${options.max}` };
        }
        return { valid: true };
      },
    });

    // 电子邮件
    this.registerRule('email', {
      name: 'email',
      validate: (value) => {
        if (value) {
          const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailPattern.test(value)) {
            return { valid: false, error: '电子邮件格式不正确' };
          }
        }
        return { valid: true };
      },
    });

    // URL
    this.registerRule('url', {
      name: 'url',
      validate: (value) => {
        if (value) {
          try {
            new URL(value);
          } catch {
            return { valid: false, error: 'URL格式不正确' };
          }
        }
        return { valid: true };
      },
    });

    // 安全字符串（防止XSS）
    this.registerRule('safeString', {
      name: 'safeString',
      validate: (value) => {
        if (value) {
          const unsafePatterns = [
            /<script[^>]*>.*?<\/script>/gi,
            /<iframe[^>]*>.*?<\/iframe>/gi,
            /<object[^>]*>.*?<\/object>/gi,
            /<embed[^>]*>.*?<\/embed>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
          ];

          for (const pattern of unsafePatterns) {
            if (pattern.test(value)) {
              return { valid: false, error: '包含不安全的内容' };
            }
          }
        }
        return { valid: true };
      },
    });

    // 文件名安全
    this.registerRule('safeFileName', {
      name: 'safeFileName',
      validate: (value) => {
        if (value) {
          const unsafePatterns = [
            /\.\./,
            /\//,
            /\\/,
            /:/,
            /\*/,
            /\?/,
            /"/,
            /</,
            />/,
            /[\|]/,
          ];

          for (const pattern of unsafePatterns) {
            if (pattern.test(value)) {
              return { valid: false, error: '文件名包含不安全的字符' };
            }
          }
        }
        return { valid: true };
      },
    });

    // 命令注入防护
    this.registerRule('noCommandInjection', {
      name: 'noCommandInjection',
      validate: (value) => {
        if (value) {
          const unsafePatterns = [
            /;\s*[&|]?\s*/,
            /\|\|\s*/,
            /&&\s*/,
            /\$\(.*\)/,
            /`.*`/,
            /eval\(/,
            /exec\(/,
            /system\(/,
            /passthru\(/,
            /shell_exec\(/,
            /popen\(/,
            /proc_open\(/,
            /\/bin\/sh\s*-c\s*/,
            /\/bin\/bash\s*-c\s*/,
          ];

          for (const pattern of unsafePatterns) {
            if (pattern.test(value)) {
              return { valid: false, error: '包含不安全的命令' };
            }
          }
        }
        return { valid: true };
      },
    });

    // SQL注入防护
    this.registerRule('noSqlInjection', {
      name: 'noSqlInjection',
      validate: (value) => {
        if (value) {
          const unsafePatterns = [
            /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|RENAME|GRANT|REVOKE)\b/i,
            /\b(OR|AND|NOT)\b\s*\d+\s*=/i,
            /\bUNION\b\s+\bSELECT\b/i,
            /\bFROM\b\s+\bINFORMATION_SCHEMA\b/i,
            /\bEXEC\b/i,
            /\bEXECUTE\b/i,
            /\bxp_\w+\b/i,
            /;\s*--/,
            /;\s*#/,
            /\'\s*OR\s*\'1\'\s*=\s*\'1/,
            /\"\s*OR\s*\"1\"\s*=\s*\"1/,
          ];

          for (const pattern of unsafePatterns) {
            if (pattern.test(value)) {
              return { valid: false, error: '包含不安全的SQL语句' };
            }
          }
        }
        return { valid: true };
      },
    });
  }

  /**
   * 注册验证规则
   * @param name 规则名称
   * @param rule 验证规则
   */
  registerRule(name: string, rule: ValidationRule): void {
    this.rules.set(name, rule);
  }

  /**
   * 验证单个值
   * @param value 要验证的值
   * @param rules 验证规则
   * @returns 验证结果
   */
  validate(
    value: any,
    rules: Array<{ name: string; options?: any }>
  ): ValidationResult {
    for (const ruleDef of rules) {
      const rule = this.rules.get(ruleDef.name);
      if (!rule) {
        continue;
      }

      const result = rule.validate(value, ruleDef.options);
      if (!result.valid) {
        return result;
      }
    }

    return { valid: true };
  }

  /**
   * 验证对象
   * @param data 要验证的数据对象
   * @param schema 验证 schema
   * @returns 验证结果
   */
  validateObject(
    data: Record<string, any>,
    schema: Record<string, Array<{ name: string; options?: any }>>
  ): ValidationResult {
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      const result = this.validate(value, rules);
      if (!result.valid) {
        return { ...result, field };
      }
    }

    return { valid: true };
  }

  /**
   * 清理输入（防止XSS）
   * @param input 输入值
   * @returns 清理后的值
   */
  sanitize(input: any): any {
    if (typeof input === 'string') {
      return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else if (Array.isArray(input)) {
      return input.map((item) => this.sanitize(item));
    } else if (typeof input === 'object' && input !== null) {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitize(value);
      }
      return sanitized;
    }
    return input;
  }

  /**
   * 获取所有验证规则
   * @returns 验证规则映射
   */
  getRules(): Map<string, ValidationRule> {
    return this.rules;
  }
}

/**
 * 创建输入验证器实例
 * @returns 输入验证器实例
 */
export function createInputValidator(): InputValidator {
  return new InputValidator();
}

/**
 * 全局输入验证器实例
 */
export const inputValidator = createInputValidator();
