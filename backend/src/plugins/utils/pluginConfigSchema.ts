/**
 * 插件配置架构
 * 定义插件配置的schema和验证逻辑
 * 参考CC源码 cc_code/backend/utils/plugins/schemas.ts 实现
 */

import { z } from 'zod';

/**
 * 插件配置项目类型
 */
export type ConfigItemType = 'string' | 'number' | 'boolean' | 'select' | 'array' | 'object';

/**
 * 插件配置项目
 */
export interface ConfigItem {
  key: string;
  type: ConfigItemType;
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: { label: string; value: string }[];
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

/**
 * 插件配置架构
 */
export interface PluginConfigSchema {
  pluginId: string;
  version: string;
  items: ConfigItem[];
}

/**
 * 配置验证结果
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

/**
 * 配置验证错误
 */
export interface ConfigValidationError {
  key: string;
  message: string;
  value?: unknown;
}

/**
 * 配置验证警告
 */
export interface ConfigValidationWarning {
  key: string;
  message: string;
}

/**
 * 字符串验证schema
 */
function createStringSchema(item: ConfigItem): z.ZodType<unknown> {
  let schema = z.string();

  if (item.validation?.minLength !== undefined) {
    schema = schema.min(item.validation.minLength, `最小长度为 ${item.validation.minLength}`);
  }

  if (item.validation?.maxLength !== undefined) {
    schema = schema.max(item.validation.maxLength, `最大长度为 ${item.validation.maxLength}`);
  }

  if (item.validation?.pattern) {
    schema = schema.regex(new RegExp(item.validation.pattern), '格式不匹配');
  }

  return schema;
}

/**
 * 数字验证schema
 */
function createNumberSchema(item: ConfigItem): z.ZodType<unknown> {
  let schema = z.number();

  if (item.validation?.min !== undefined) {
    schema = schema.min(item.validation.min, `最小值为 ${item.validation.min}`);
  }

  if (item.validation?.max !== undefined) {
    schema = schema.max(item.validation.max, `最大值为 ${item.validation.max}`);
  }

  return schema;
}

/**
 * 从配置项创建Zod schema
 */
export function createSchemaFromConfigItem(item: ConfigItem): z.ZodType<unknown> {
  switch (item.type) {
    case 'string':
      return createStringSchema(item);

    case 'number':
      return createNumberSchema(item);

    case 'boolean':
      return z.boolean();

    case 'select':
      if (item.options && item.options.length > 0) {
        const validValues = item.options.map(o => o.value);
        return z.enum(validValues as [string, ...string[]]);
      }
      return z.string();

    case 'array':
      return z.array(z.unknown());

    case 'object':
      return z.record(z.unknown());

    default:
      return z.unknown();
  }
}

/**
 * 从配置架构创建完整Zod schema
 */
export function createSchemaFromPluginConfig(config: PluginConfigSchema): z.ZodObject<Record<string, z.ZodType<unknown>>> {
  const shape: Record<string, z.ZodType<unknown>> = {};

  for (const item of config.items) {
    shape[item.key] = createSchemaFromConfigItem(item);
  }

  return z.object(shape);
}

/**
 * 验证插件配置
 */
export function validatePluginConfig(
  config: PluginConfigSchema,
  values: Record<string, unknown>
): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const warnings: ConfigValidationWarning[] = [];

  for (const item of config.items) {
    const value = values[item.key];

    if (item.required && (value === undefined || value === null)) {
      errors.push({
        key: item.key,
        message: `${item.label} 是必填项`,
        value,
      });
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (item.type === 'string' && typeof value !== 'string') {
      errors.push({
        key: item.key,
        message: `${item.label} 必须是字符串`,
        value,
      });
    }

    if (item.type === 'number' && typeof value !== 'number') {
      errors.push({
        key: item.key,
        message: `${item.label} 必须是数字`,
        value,
      });
    }

    if (item.type === 'boolean' && typeof value !== 'boolean') {
      errors.push({
        key: item.key,
        message: `${item.label} 必须是布尔值`,
        value,
      });
    }

    if (item.type === 'select' && item.options) {
      const validValues = item.options.map(o => o.value);
      if (!validValues.includes(value as string)) {
        errors.push({
          key: item.key,
          message: `${item.label} 的值无效`,
          value,
        });
      }
    }

    if (item.validation) {
      if (item.type === 'string' && typeof value === 'string') {
        if (item.validation.minLength && value.length < item.validation.minLength) {
          errors.push({
            key: item.key,
            message: `${item.label} 的长度不能小于 ${item.validation.minLength}`,
            value,
          });
        }
        if (item.validation.maxLength && value.length > item.validation.maxLength) {
          errors.push({
            key: item.key,
            message: `${item.label} 的长度不能大于 ${item.validation.maxLength}`,
            value,
          });
        }
        if (item.validation.pattern) {
          const regex = new RegExp(item.validation.pattern);
          if (!regex.test(value)) {
            errors.push({
              key: item.key,
              message: `${item.label} 的格式不正确`,
              value,
            });
          }
        }
      }

      if (item.type === 'number' && typeof value === 'number') {
        if (item.validation.min !== undefined && value < item.validation.min) {
          errors.push({
            key: item.key,
            message: `${item.label} 不能小于 ${item.validation.min}`,
            value,
          });
        }
        if (item.validation.max !== undefined && value > item.validation.max) {
          errors.push({
            key: item.key,
            message: `${item.label} 不能大于 ${item.validation.max}`,
            value,
          });
        }
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
 * 获取配置的默认值
 */
export function getDefaultConfigValues(config: PluginConfigSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const item of config.items) {
    if (item.default !== undefined) {
      defaults[item.key] = item.default;
    }
  }

  return defaults;
}

/**
 * 合并配置（使用默认值填充缺失项）
 */
export function mergeWithDefaults(
  config: PluginConfigSchema,
  values: Record<string, unknown>
): Record<string, unknown> {
  const defaults = getDefaultConfigValues(config);
  return { ...defaults, ...values };
}
