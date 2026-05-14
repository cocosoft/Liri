/**
 * ConfigSchema 配置模式定义与校验
 * 对标 CC 的配置模式管理机制
 */

/**
 * 配置项定义
 */
export interface ConfigItemDefinition {
  key: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue: unknown;
  required?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  pattern?: string;
  example?: unknown;
}

/**
 * 配置分类
 */
export interface ConfigCategory {
  name: string;
  description: string;
  items: ConfigItemDefinition[];
}

/**
 * 配置模式
 */
export class ConfigSchema {
  private categories: Map<string, ConfigCategory> = new Map();
  private flatItems: Map<string, ConfigItemDefinition> = new Map();

  /**
   * 注册配置项
   */
  registerItem(category: string, item: ConfigItemDefinition): void {
    this.flatItems.set(item.key, item);

    if (!this.categories.has(category)) {
      this.categories.set(category, {
        name: category,
        description: `${category} 配置`,
        items: [],
      });
    }

    this.categories.get(category)!.items.push(item);
  }

  /**
   * 批量注册配置
   */
  registerCategory(category: ConfigCategory): void {
    this.categories.set(category.name, category);

    for (const item of category.items) {
      this.flatItems.set(item.key, item);
    }
  }

  /**
   * 获取配置项定义
   */
  getItem(key: string): ConfigItemDefinition | undefined {
    return this.flatItems.get(key);
  }

  /**
   * 获取配置分类
   */
  getCategory(name: string): ConfigCategory | undefined {
    return this.categories.get(name);
  }

  /**
   * 获取所有分类
   */
  getAllCategories(): ConfigCategory[] {
    return Array.from(this.categories.values());
  }

  /**
   * 验证配置值
   */
  validate(key: string, value: unknown): { valid: boolean; error?: string } {
    const item = this.flatItems.get(key);

    if (!item) {
      return { valid: true };
    }

    switch (item.type) {
      case 'string':
        if (typeof value !== 'string') {
          return { valid: false, error: `${key} 应为字符串类型` };
        }
        if (item.enum && !item.enum.includes(value)) {
          return { valid: false, error: `${key} 值 ${value} 不在允许范围内: ${item.enum.join(', ')}` };
        }
        if (item.pattern && !new RegExp(item.pattern).test(value)) {
          return { valid: false, error: `${key} 格式不匹配: ${item.pattern}` };
        }
        break;

      case 'number':
        if (typeof value !== 'number') {
          return { valid: false, error: `${key} 应为数字类型` };
        }
        if (item.min !== undefined && value < item.min) {
          return { valid: false, error: `${key} 不能小于 ${item.min}` };
        }
        if (item.max !== undefined && value > item.max) {
          return { valid: false, error: `${key} 不能大于 ${item.max}` };
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `${key} 应为布尔类型` };
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          return { valid: false, error: `${key} 应为数组类型` };
        }
        break;

      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { valid: false, error: `${key} 应为对象类型` };
        }
        break;
    }

    return { valid: true };
  }

  /**
   * 获取默认值
   */
  getDefault(key: string): unknown {
    return this.flatItems.get(key)?.defaultValue;
  }

  /**
   * 获取所有默认值
   */
  getAllDefaults(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, item] of this.flatItems) {
      result[key] = item.defaultValue;
    }

    return result;
  }
}

export const configSchema = new ConfigSchema();
