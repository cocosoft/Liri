/**
 * SourceConfig 生命周期源配置管理器
 * 对标 OpenClaw 的 source-config/，管理插件生命周期的配置来源
 */

/**
 * 配置来源类型
 */
export type ConfigSourceType = 'file' | 'env' | 'registry' | 'inline' | 'default';

/**
 * 配置来源
 */
export interface ConfigSource {
  type: ConfigSourceType;
  path?: string;
  key?: string;
  priority: number;
  description?: string;
}

/**
 * 生命周期配置项
 */
export interface LifecycleConfigItem<T = unknown> {
  key: string;
  value: T;
  source: ConfigSourceType;
  updatedAt: number;
}

/**
 * 源配置管理器
 */
export class SourceConfigManager {
  private sources: ConfigSource[] = [];
  private configs: Map<string, LifecycleConfigItem> = new Map();
  private defaults: Map<string, unknown> = new Map();

  /**
   * 注册配置来源
   */
  registerSource(source: ConfigSource): void {
    this.sources.push(source);
    this.sources.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取所有来源
   */
  getSources(): ConfigSource[] {
    return [...this.sources];
  }

  /**
   * 设置默认值
   */
  setDefault(key: string, value: unknown): void {
    this.defaults.set(key, value);
  }

  /**
   * 设置配置值
   */
  set<T>(key: string, value: T, source: ConfigSourceType): void {
    this.configs.set(key, {
      key,
      value,
      source,
      updatedAt: Date.now(),
    });
  }

  /**
   * 获取配置值（按优先级：inline > env > file > registry > default）
   */
  get<T>(key: string): T | undefined {
    const item = this.configs.get(key);

    if (item !== undefined) {
      return item.value as T;
    }

    if (this.defaults.has(key)) {
      return this.defaults.get(key) as T;
    }

    return undefined;
  }

  /**
   * 获取完整配置项
   */
  getItem(key: string): LifecycleConfigItem | undefined {
    return this.configs.get(key);
  }

  /**
   * 获取所有配置
   */
  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, item] of this.configs.entries()) {
      result[key] = item.value;
    }

    for (const [key, value] of this.defaults.entries()) {
      if (!(key in result)) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 批量设置配置
   */
  setMany(configs: Record<string, unknown>, source: ConfigSourceType): void {
    for (const [key, value] of Object.entries(configs)) {
      this.set(key, value, source);
    }
  }

  /**
   * 加载文件配置
   */
  loadFromFile(filePath: string, data: Record<string, unknown>): void {
    this.registerSource({
      type: 'file',
      path: filePath,
      priority: 60,
      description: `来自文件 ${filePath}`,
    });

    this.setMany(data, 'file');
  }

  /**
   * 加载环境变量配置
   */
  loadFromEnv(prefix: string): void {
    this.registerSource({
      type: 'env',
      key: prefix,
      priority: 80,
      description: `来自环境变量 ${prefix}*`,
    });

    for (const [envKey, envValue] of Object.entries(process.env)) {
      if (envKey.startsWith(prefix)) {
        const configKey = envKey.slice(prefix.length).toLowerCase();

        if (envValue !== undefined) {
          this.set(configKey, envValue, 'env');
        }
      }
    }
  }

  /**
   * 移除配置
   */
  remove(key: string): boolean {
    return this.configs.delete(key);
  }

  /**
   * 清理配置
   */
  clear(): void {
    this.configs.clear();
    this.sources = [];
    this.defaults.clear();
  }

  /**
   * 获取统计
   */
  getStats(): { totalConfigs: number; totalSources: number; bySource: Record<string, number> } {
    const bySource: Record<string, number> = {};

    for (const item of this.configs.values()) {
      bySource[item.source] = (bySource[item.source] || 0) + 1;
    }

    return {
      totalConfigs: this.configs.size,
      totalSources: this.sources.length,
      bySource,
    };
  }
}

export const sourceConfigManager = new SourceConfigManager();
