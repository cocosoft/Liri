/**
 * ChannelPluginValidator 渠道插件验证器
 * 对标 OpenClaw 的 channel-validation，验证渠道插件的配置与兼容性
 */

import type { ChannelPlugin } from './ChannelPluginCatalog.js';

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证规则
 */
export interface ValidationRule {
  name: string;
  description: string;
  validate(plugin: ChannelPlugin): string | null;
}

/**
 * 渠道插件验证器
 */
export class ChannelPluginValidator {
  private rules: ValidationRule[] = [];

  constructor() {
    this.initDefaultRules();
  }

  /**
   * 初始化默认验证规则
   */
  private initDefaultRules(): void {
    this.addRule({
      name: 'name-required',
      description: '插件名称不能为空',
      validate: (plugin) => (!plugin.name ? '插件名称不能为空' : null),
    });

    this.addRule({
      name: 'version-format',
      description: '版本号必须符合 semver 格式',
      validate: (plugin) => {
        if (!plugin.version) {
          return '版本号不能为空';
        }

        const semverRegex = /^\d+\.\d+\.\d+$/;

        if (!semverRegex.test(plugin.version)) {
          return `版本号 "${plugin.version}" 不符合 semver 格式 (x.y.z)`;
        }

        return null;
      },
    });

    this.addRule({
      name: 'type-valid',
      description: '插件类型必须有效',
      validate: (plugin) => {
        const validTypes = [
          'messaging',
          'social',
          'notification',
          'voice',
          'custom',
        ];

        if (!validTypes.includes(plugin.type)) {
          return `无效的插件类型 "${plugin.type}"，必须是: ${validTypes.join(', ')}`;
        }

        return null;
      },
    });

    this.addRule({
      name: 'protocol-required',
      description: '协议字段不能为空',
      validate: (plugin) => (!plugin.protocol ? '协议字段不能为空' : null),
    });

    this.addRule({
      name: 'capabilities-not-empty',
      description: '能力列表不能为空',
      validate: (plugin) => {
        if (!plugin.capabilities || plugin.capabilities.length === 0) {
          return '能力列表不能为空';
        }

        return null;
      },
    });
  }

  /**
   * 添加验证规则
   */
  addRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  /**
   * 验证渠道插件
   */
  validate(plugin: ChannelPlugin): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const rule of this.rules) {
      const error = rule.validate(plugin);

      if (error) {
        errors.push(error);
      }
    }

    if (!plugin.description) {
      warnings.push('建议提供插件描述');
    }

    if (!plugin.displayName) {
      warnings.push('建议提供显示名称');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 批量验证
   */
  validateBatch(plugins: ChannelPlugin[]): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();

    for (const plugin of plugins) {
      results.set(plugin.name, this.validate(plugin));
    }

    return results;
  }

  /**
   * 检查配置完整性
   */
  validateConfig(
    plugin: ChannelPlugin,
    config: Record<string, unknown>
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const schema = plugin.configSchema as Record<
      string,
      { type: string; required?: boolean; default?: unknown }
    >;

    for (const [key, field] of Object.entries(schema)) {
      if (field.required && config[key] === undefined) {
        errors.push(`缺少必填配置项: ${key}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查兼容性
   */
  checkCompatibility(
    plugin: ChannelPlugin,
    environment: Record<string, string>
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!environment[dep]) {
          warnings.push(`依赖 "${dep}" 在环境中不可用`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 获取所有验证规则
   */
  getRules(): ValidationRule[] {
    return [...this.rules];
  }
}

export const channelPluginValidator = new ChannelPluginValidator();
