/**
 * ConfigRedact 配置脱敏
 * 对标 CC 的敏感信息脱敏能力
 */

/**
 * 脱敏规则
 */
export interface RedactRule {
  keyPattern: RegExp | string;
  replacement?: string;
  mode: 'mask' | 'hash' | 'remove';
  maskChar?: string;
  visibleChars?: number;
}

/**
 * 脱敏配置
 */
export interface RedactConfig {
  enabled: boolean;
  rules: RedactRule[];
  defaultReplacement: string;
}

/**
 * 默认脱敏规则
 */
const DEFAULT_RULES: RedactRule[] = [
  {
    keyPattern: /(api[_-]?key|apikey|api_key)/i,
    mode: 'mask',
    visibleChars: 4,
  },
  {
    keyPattern: /(secret|token|password|passwd|credential)/i,
    mode: 'mask',
    visibleChars: 4,
  },
  {
    keyPattern: /(private[_-]?key|private_key)/i,
    mode: 'mask',
    visibleChars: 0,
  },
  {
    keyPattern: /(access[_-]?token|refresh[_-]?token)/i,
    mode: 'mask',
    visibleChars: 6,
  },
  { keyPattern: /(ssn|social[_-]?security)/i, mode: 'mask', visibleChars: 4 },
  { keyPattern: /(jwt|bearer)/i, mode: 'remove' },
];

/**
 * 配置脱敏器
 */
export class ConfigRedact {
  private rules: RedactRule[];
  private defaultReplacement: string;

  constructor(config?: Partial<RedactConfig>) {
    this.rules = config?.rules || [...DEFAULT_RULES];
    this.defaultReplacement = config?.defaultReplacement || '***REDACTED***';
  }

  /**
   * 脱敏配置对象
   */
  redact(config: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...config };

    for (const key of Object.keys(result)) {
      if (this.shouldRedact(key)) {
        const rule = this.getMatchingRule(key)!;

        switch (rule.mode) {
          case 'mask':
            result[key] = this.maskValue(String(result[key]), rule);
            break;

          case 'hash':
            result[key] = this.hashValue(String(result[key]));
            break;

          case 'remove':
            delete result[key];
            break;
        }
      } else if (this.isObject(result[key])) {
        result[key] = this.redact(result[key] as Record<string, unknown>);
      } else if (Array.isArray(result[key])) {
        result[key] = result[key].map((item: unknown) =>
          this.isObject(item)
            ? this.redact(item as Record<string, unknown>)
            : item
        );
      }
    }

    return result;
  }

  /**
   * 脱敏字符串中的敏感信息
   */
  redactString(str: string): string {
    let result = str;

    for (const rule of this.rules) {
      if (rule.keyPattern instanceof RegExp) {
        result = result.replace(rule.keyPattern, this.defaultReplacement);
      }
    }

    return result;
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: RedactRule): void {
    this.rules.push(rule);
  }

  /**
   * 重置为默认规则
   */
  resetRules(): void {
    this.rules = [...DEFAULT_RULES];
  }

  /**
   * 判断是否应脱敏
   */
  private shouldRedact(key: string): boolean {
    return this.rules.some((rule) => {
      if (rule.keyPattern instanceof RegExp) {
        return rule.keyPattern.test(key);
      }

      return key.toLowerCase().includes(rule.keyPattern.toLowerCase());
    });
  }

  /**
   * 获取匹配规则
   */
  private getMatchingRule(key: string): RedactRule | undefined {
    return this.rules.find((rule) => {
      if (rule.keyPattern instanceof RegExp) {
        return rule.keyPattern.test(key);
      }

      return key.toLowerCase().includes(rule.keyPattern.toLowerCase());
    });
  }

  /**
   * 掩码值
   */
  private maskValue(value: string, rule: RedactRule): string {
    const visible = rule.visibleChars || 0;
    const maskChar = rule.maskChar || '*';

    if (value.length <= visible) {
      return value;
    }

    const visiblePart = value.slice(0, visible);
    const maskedPart = maskChar.repeat(Math.min(value.length - visible, 20));

    return visiblePart + maskedPart;
  }

  /**
   * 哈希值
   */
  private hashValue(value: string): string {
    let hash = 0;

    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }

    return `***HASH:${Math.abs(hash).toString(16)}***`;
  }

  /**
   * 判断是否为对象
   */
  private isObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

export const configRedact = new ConfigRedact();
