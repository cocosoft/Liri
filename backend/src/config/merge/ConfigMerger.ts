/**
 * ConfigMerger 配置合并工具
 * 对标 CC 的配置合并机制
 */

/**
 * 合并策略
 */
export type MergeStrategy = 'shallow' | 'deep' | 'replace' | 'keep';

/**
 * 合并选项
 */
export interface MergeOptions {
  strategy: MergeStrategy;
  preserveArrays?: boolean;
  preserveNulls?: boolean;
}

/**
 * 配置合并器
 */
export class ConfigMerger {
  /**
   * 合并两个配置对象
   */
  merge(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
    options: MergeOptions = { strategy: 'deep' }
  ): Record<string, unknown> {
    switch (options.strategy) {
      case 'shallow':
        return this.shallowMerge(base, override, options);
      case 'deep':
        return this.deepMerge(base, override, options);
      case 'replace':
        return { ...override };
      case 'keep':
        return { ...override, ...base };
      default:
        return this.deepMerge(base, override, options);
    }
  }

  /**
   * 批量合并多个配置
   */
  mergeAll(
    configs: Record<string, unknown>[],
    options: MergeOptions = { strategy: 'deep' }
  ): Record<string, unknown> {
    let result: Record<string, unknown> = {};

    for (const config of configs) {
      result = this.merge(result, config, options);
    }

    return result;
  }

  /**
   * 浅合并
   */
  private shallowMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
    options: MergeOptions
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (value === null && !options.preserveNulls) {
        delete result[key];
      } else if (Array.isArray(value) && options.preserveArrays) {
        const existing = result[key];

        if (Array.isArray(existing)) {
          result[key] = [...existing, ...value];
        } else {
          result[key] = [...value];
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 深合并
   */
  private deepMerge(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
    options: MergeOptions
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);

    for (const key of allKeys) {
      const baseVal = key in base ? base[key] : undefined;
      const overrideVal = key in override ? override[key] : undefined;

      if (overrideVal === null && !options.preserveNulls) {
        continue;
      }

      if (overrideVal === undefined) {
        if (baseVal !== undefined) {
          result[key] = baseVal;
        }
        continue;
      }

      if (this.isObject(baseVal) && this.isObject(overrideVal)) {
        result[key] = this.deepMerge(
          baseVal as Record<string, unknown>,
          overrideVal as Record<string, unknown>,
          options
        );
      } else if (Array.isArray(baseVal) && Array.isArray(overrideVal) && options.preserveArrays) {
        result[key] = [...baseVal, ...overrideVal];
      } else {
        result[key] = overrideVal;
      }
    }

    return result;
  }

  /**
   * 判断是否为对象
   */
  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

export const configMerger = new ConfigMerger();
