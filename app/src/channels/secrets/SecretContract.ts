/**
 * SecretContract 密钥契约
 * 为各通道提供标准化的密钥定义、验证和解析机制
 * 统一管理通道所需的 API 密钥、Token、密码等敏感信息
 */

import type { ValidationResult } from '@modules/common/types';

/** 密钥规格定义 */
export interface SecretSpec {
  /** 配置键名 */
  key: string;
  /** 环境变量名（可选） */
  envVar?: string;
  /** 显示名称 */
  label: string;
  /** 描述信息 */
  description: string;
  /** 是否必需 */
  required: boolean;
  /** 是否为敏感信息（日志中需脱敏） */
  sensitive: boolean;
  /** 默认值 */
  defaultValue?: string | number | boolean;
  /** 值类型 */
  type?: 'string' | 'number' | 'boolean';
}

/** SecretContract — 通道密钥契约
 *
 * 标准化管理通道所需的各类密钥和凭据，提供声明式定义、
 * 自动环境变量解析和敏感数据脱敏能力。
 *
 * @example
 * ```typescript
 * const contract = new SecretContract('telegram', [
 *   { key: 'botToken', envVar: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token',
 *     description: 'Telegram Bot API Token', required: true, sensitive: true },
 *   { key: 'webhookPort', label: 'Webhook 端口', description: 'Webhook 监听端口',
 *     required: false, sensitive: false, defaultValue: 8443, type: 'number' },
 * ]);
 *
 * contract.validate({ botToken: '' });
 * // => { valid: false, missing: ['botToken'], errors: [] }
 *
 * contract.resolve({ botToken: '' });
 * // => { botToken: '实际值（来自环境变量）', webhookPort: 8443 }
 * ```
 */
export class SecretContract {
  /** 通道标识 */
  readonly channelId: string;
  /** 密钥规格列表 */
  readonly specs: SecretSpec[];
  /** 根据 key 索引的规格映射 */
  private specMap: Map<string, SecretSpec>;

  constructor(channelId: string, specs: SecretSpec[]) {
    this.channelId = channelId;
    this.specs = [...specs];
    this.specMap = new Map(specs.map((s) => [s.key, s]));
  }

  /**
   * 验证配置是否满足契约要求
   * 检查必填字段是否齐全以及类型是否正确
   */
  validate(raw: Record<string, unknown>): ValidationResult {
    const missing: string[] = [];
    const errors: string[] = [];

    for (const spec of this.specs) {
      const value = raw[spec.key];
      const resolved = this.resolveValue(spec, value);

      if (
        spec.required &&
        (resolved === undefined || resolved === null || resolved === '')
      ) {
        missing.push(spec.key);
        continue;
      }

      const typeError = this.checkType(spec, resolved);
      if (typeError) {
        errors.push(typeError);
      }
    }

    return {
      valid: missing.length === 0 && errors.length === 0,
      missing,
      errors,
    };
  }

  /**
   * 解析配置，从持久化存储和环境变量填充缺失值并应用默认值
   *
   * 优先级：传入值 > fromStore（持久化存储） > 环境变量 > 默认值
   *
   * @param raw 传入的配置值（通常来自请求体）
   * @param fromStore 来自持久化存储的配置（如 ChannelSecretStore 的 DB 数据）
   */
  resolve(
    raw: Record<string, unknown>,
    fromStore?: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const spec of this.specs) {
      const value = raw[spec.key];
      const resolvedVal = this.resolveValue(spec, value, fromStore);

      if (
        resolvedVal !== undefined &&
        resolvedVal !== null &&
        resolvedVal !== ''
      ) {
        resolved[spec.key] = resolvedVal;
      } else if (spec.envVar) {
        const envVal = process.env[spec.envVar];
        if (envVal !== undefined && envVal !== '') {
          resolved[spec.key] = this.coerceType(spec, envVal);
        } else if (spec.defaultValue !== undefined) {
          resolved[spec.key] = spec.defaultValue;
        } else {
          resolved[spec.key] = value ?? '';
        }
      } else if (spec.defaultValue !== undefined) {
        resolved[spec.key] = spec.defaultValue;
      } else {
        resolved[spec.key] = value ?? '';
      }
    }

    return resolved;
  }

  /**
   * 脱敏处理，将敏感字段的值替换为掩码
   * 用于安全日志输出
   */
  mask(raw: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};

    for (const spec of this.specs) {
      if (spec.sensitive && raw[spec.key]) {
        masked[spec.key] = this.maskValue(String(raw[spec.key]));
      } else {
        masked[spec.key] = raw[spec.key];
      }
    }

    return masked;
  }

  /**
   * 获取默认配置
   */
  getDefaults(): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};

    for (const spec of this.specs) {
      defaults[spec.key] = spec.defaultValue ?? '';
    }

    return defaults;
  }

  /**
   * 检查所有必填字段是否都存在
   */
  allPresent(raw: Record<string, unknown>): boolean {
    return this.specs
      .filter((s) => s.required)
      .every((spec) => {
        const value = this.resolveValue(spec, raw[spec.key]);
        return value !== undefined && value !== null && value !== '';
      });
  }

  /**
   * 获取指定 key 的规格定义
   */
  getSpec(key: string): SecretSpec | undefined {
    return this.specMap.get(key);
  }

  /**
   * 获取所有必填字段的 key 列表
   */
  getRequiredKeys(): string[] {
    return this.specs.filter((s) => s.required).map((s) => s.key);
  }

  /**
   * 获取所有敏感字段的 key 列表
   */
  getSensitiveKeys(): string[] {
    return this.specs.filter((s) => s.sensitive).map((s) => s.key);
  }

  /**
   * 解析单个值：传入值 → fromStore（持久化存储） → 环境变量 → 默认值
   *
   * @param spec 密钥规格
   * @param value 传入值
   * @param fromStore 来自持久化存储的配置值（可选）
   */
  private resolveValue(
    spec: SecretSpec,
    value: unknown,
    fromStore?: Record<string, unknown>
  ): unknown {
    // 1. 传入值优先
    if (value !== undefined && value !== null && value !== '') {
      return this.coerceType(spec, value);
    }

    // 2. 来自持久化存储（ChannelSecretStore DB 数据）
    if (fromStore && spec.key in fromStore) {
      const storeVal = fromStore[spec.key];
      if (storeVal !== undefined && storeVal !== null && storeVal !== '') {
        return this.coerceType(spec, storeVal);
      }
    }

    // 3. 环境变量（向后兼容）
    if (spec.envVar) {
      const envVal = process.env[spec.envVar];
      if (envVal !== undefined && envVal !== '') {
        return this.coerceType(spec, envVal);
      }
    }

    // 4. 默认值
    return spec.defaultValue;
  }

  /** 类型强制转换 */
  private coerceType(spec: SecretSpec, value: unknown): unknown {
    if (!spec.type || value === null || value === undefined) return value;

    switch (spec.type) {
      case 'number': {
        const num = Number(value);
        return Number.isNaN(num) ? value : num;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === '1') return true;
        if (value === 'false' || value === '0') return false;
        return value;
      }
      case 'string':
      default:
        return String(value);
    }
  }

  /** 类型检查 */
  private checkType(spec: SecretSpec, value: unknown): string | null {
    if (!spec.type || value === undefined || value === null || value === '') {
      return null;
    }

    if (spec.type === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) {
        return `${spec.key}: 应为数字类型，实际为 ${typeof value}`;
      }
    }

    if (spec.type === 'boolean' && typeof value !== 'boolean') {
      return `${spec.key}: 应为布尔类型`;
    }

    return null;
  }

  /** 生成掩码字符串 */
  private maskValue(value: string): string {
    if (value.length <= 4) return '****';
    return value.slice(0, 2) + '****' + value.slice(-2);
  }
}
