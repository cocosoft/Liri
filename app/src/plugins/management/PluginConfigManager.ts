/**
 * 负责插件的配置管理、验证、存储和更新
 */

import { EventEmitter } from 'events';
import { PluginConfig } from '../types/PluginTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  /** 是否有效 */
  valid: boolean;

  /** 错误信息 */
  errors: ConfigValidationError[];

  /** 警告信息 */
  warnings: ConfigValidationWarning[];
}

/**
 * 配置验证错误
 */
export interface ConfigValidationError {
  /** 配置键 */
  key: string;

  /** 错误信息 */
  message: string;

  /** 配置值 */
  value?: unknown;
}

/**
 * 配置验证警告
 */
export interface ConfigValidationWarning {
  /** 配置键 */
  key: string;

  /** 警告信息 */
  message: string;

  /** 配置值 */
  value?: unknown;
}

/**
 * 配置架构定义
 */
export interface ConfigSchema {
  /** 配置键 */
  key: string;

  /** 配置类型 */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** 配置标签 */
  label: string;

  /** 配置描述 */
  description?: string;

  /** 默认值 */
  default?: unknown;

  /** 是否必需 */
  required?: boolean;

  /** 验证规则 */
  validation?: {
    /** 正则表达式 */
    pattern?: string;

    /** 最小值 */
    min?: number;

    /** 最大值 */
    max?: number;

    /** 最小长度 */
    minLength?: number;

    /** 最大长度 */
    maxLength?: number;

    /** 枚举值 */
    enum?: string[];
  };
}

/**
 * 插件配置管理器
 */
export class PluginConfigManager extends EventEmitter {
  private configs: Map<string, PluginConfig> = new Map();
  private schemas: Map<string, ConfigSchema[]> = new Map();
  private defaultConfigs: Map<string, PluginConfig> = new Map();

  /**
   * 设置插件配置架构
   */
  setSchema(pluginId: string, schema: ConfigSchema[]): void {
    this.schemas.set(pluginId, schema);

    // 生成默认配置
    const defaultConfig: PluginConfig = {};

    for (const item of schema) {
      if (item.default !== undefined) {
        defaultConfig[item.key] = item.default;
      }
    }

    this.defaultConfigs.set(pluginId, defaultConfig);

    logger.info(`✅ Config schema set for plugin: ${pluginId}`);
  }

  /**
   * 获取插件配置架构
   */
  getSchema(pluginId: string): ConfigSchema[] | undefined {
    return this.schemas.get(pluginId);
  }

  /**
   * 设置插件配置
   */
  setConfig(pluginId: string, config: PluginConfig): ConfigValidationResult {
    // 验证配置
    const validationResult = this.validateConfig(pluginId, config);

    if (!validationResult.valid) {
      this.emit('configValidationFailed', {
        pluginId,
        config,
        validationResult,
      });
      return validationResult;
    }

    // 合并配置
    const currentConfig = this.configs.get(pluginId) || {};
    const mergedConfig = { ...currentConfig, ...config };

    this.configs.set(pluginId, mergedConfig);

    this.emit('configUpdated', { pluginId, config: mergedConfig });

    logger.info(`✅ Config updated for plugin: ${pluginId}`);

    return validationResult;
  }

  /**
   * 获取插件配置
   */
  getConfig(pluginId: string): PluginConfig {
    const config = this.configs.get(pluginId);
    const defaultConfig = this.defaultConfigs.get(pluginId) || {};

    return { ...defaultConfig, ...config };
  }

  /**
   * 获取配置值
   */
  getConfigValue<T>(pluginId: string, key: string, defaultValue?: T): T {
    const config = this.getConfig(pluginId);

    if (config[key] !== undefined) {
      return config[key] as T;
    }

    // 检查架构中的默认值
    const schema = this.schemas.get(pluginId);

    if (schema) {
      const schemaItem = schema.find((item) => item.key === key);

      if (schemaItem && schemaItem.default !== undefined) {
        return schemaItem.default as T;
      }
    }

    return defaultValue as T;
  }

  /**
   * 设置配置值
   */
  setConfigValue(
    pluginId: string,
    key: string,
    value: unknown
  ): ConfigValidationResult {
    const currentConfig = this.getConfig(pluginId);
    const newConfig = { ...currentConfig, [key]: value };

    return this.setConfig(pluginId, newConfig);
  }

  /**
   * 重置插件配置
   */
  resetConfig(pluginId: string): void {
    this.configs.delete(pluginId);

    this.emit('configReset', { pluginId });

    logger.info(`✅ Config reset for plugin: ${pluginId}`);
  }

  /**
   * 验证配置
   */
  validateConfig(
    pluginId: string,
    config: PluginConfig
  ): ConfigValidationResult {
    const schema = this.schemas.get(pluginId);

    if (!schema) {
      return {
        valid: true,
        errors: [],
        warnings: [{ key: 'schema', message: 'No schema defined for plugin' }],
      };
    }

    const errors: ConfigValidationError[] = [];
    const warnings: ConfigValidationWarning[] = [];

    // 验证必需字段
    for (const item of schema) {
      if (item.required && config[item.key] === undefined) {
        errors.push({
          key: item.key,
          message: `Required configuration item is missing`,
        });
      }
    }

    // 验证配置值
    for (const [key, value] of Object.entries(config)) {
      const schemaItem = schema.find((item) => item.key === key);

      if (!schemaItem) {
        warnings.push({
          key,
          message: `Unknown configuration item`,
          value,
        });
        continue;
      }

      // 类型检查
      if (!this.validateType(value, schemaItem.type)) {
        errors.push({
          key,
          message: `Expected type ${schemaItem.type}, got ${typeof value}`,
          value,
        });
        continue;
      }

      // 验证规则检查
      if (schemaItem.validation) {
        const validationErrors = this.validateValue(
          value,
          schemaItem.validation
        );

        for (const error of validationErrors) {
          errors.push({
            key,
            message: error,
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

  /**
   * 验证类型
   */
  private validateType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return (
          typeof value === 'object' && value !== null && !Array.isArray(value)
        );
      default:
        return false;
    }
  }

  /**
   * 验证值
   */
  private validateValue(value: unknown, validation: any): string[] {
    const errors: string[] = [];

    if (validation.pattern && typeof value === 'string') {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        errors.push(`Value does not match pattern: ${validation.pattern}`);
      }
    }

    if (validation.min !== undefined && typeof value === 'number') {
      if (value < validation.min) {
        errors.push(`Value must be >= ${validation.min}`);
      }
    }

    if (validation.max !== undefined && typeof value === 'number') {
      if (value > validation.max) {
        errors.push(`Value must be <= ${validation.max}`);
      }
    }

    if (validation.minLength !== undefined && typeof value === 'string') {
      if (value.length < validation.minLength) {
        errors.push(`Length must be >= ${validation.minLength}`);
      }
    }

    if (validation.maxLength !== undefined && typeof value === 'string') {
      if (value.length > validation.maxLength) {
        errors.push(`Length must be <= ${validation.maxLength}`);
      }
    }

    if (validation.enum && typeof value === 'string') {
      if (!validation.enum.includes(value)) {
        errors.push(`Value must be one of: ${validation.enum.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * 获取所有插件配置
   */
  getAllConfigs(): Map<string, PluginConfig> {
    return new Map(this.configs);
  }

  /**
   * 获取配置统计
   */
  getConfigStats(): {
    totalPlugins: number;
    configuredPlugins: number;
    validationErrors: number;
    validationWarnings: number;
  } {
    let validationErrors = 0;
    let validationWarnings = 0;

    for (const [pluginId, config] of this.configs.entries()) {
      const validationResult = this.validateConfig(pluginId, config);
      validationErrors += validationResult.errors.length;
      validationWarnings += validationResult.warnings.length;
    }

    return {
      totalPlugins: this.schemas.size,
      configuredPlugins: this.configs.size,
      validationErrors,
      validationWarnings,
    };
  }

  /**
   * 导出配置
   */
  exportConfigs(): Record<string, PluginConfig> {
    const result: Record<string, PluginConfig> = {};

    for (const [pluginId, config] of this.configs.entries()) {
      result[pluginId] = config;
    }

    return result;
  }

  /**
   * 导入配置
   */
  importConfigs(
    configs: Record<string, PluginConfig>
  ): ConfigValidationResult[] {
    const results: ConfigValidationResult[] = [];

    for (const [pluginId, config] of Object.entries(configs)) {
      const result = this.setConfig(pluginId, config);
      results.push(result);
    }

    return results;
  }

  /**
   * 清理配置管理器
   */
  clear(): void {
    this.configs.clear();
    this.schemas.clear();
    this.defaultConfigs.clear();

    logger.info('✅ Plugin config manager cleared');
  }
}

export default PluginConfigManager;
