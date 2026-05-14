/**
 * ConfigOverride 运行时配置覆盖
 * 对标 CC 的运行时配置覆盖能力
 */

/**
 * 覆盖源优先级
 */
export type OverridePriority = 'env' | 'cli' | 'runtime' | 'remote';

/**
 * 覆盖条目
 */
export interface OverrideEntry {
  key: string;
  value: unknown;
  priority: OverridePriority;
  source: string;
  timestamp: number;
  ttl?: number;
}

/**
 * 覆盖配置
 */
export interface OverrideConfig {
  enabled: boolean;
  maxOverrides: number;
  allowEnvOverride: boolean;
  allowCliOverride: boolean;
}

/**
 * 运行时配置覆盖管理器
 */
export class ConfigOverride {
  private overrides: Map<string, OverrideEntry> = new Map();
  private config: OverrideConfig;

  constructor(config?: Partial<OverrideConfig>) {
    this.config = {
      enabled: config?.enabled !== false,
      maxOverrides: config?.maxOverrides || 500,
      allowEnvOverride: config?.allowEnvOverride !== false,
      allowCliOverride: config?.allowCliOverride !== false,
    };
  }

  /**
   * 设置覆盖
   */
  set(key: string, value: unknown, priority: OverridePriority, source: string, ttl?: number): void {
    if (!this.config.enabled) return;

    if (this.overrides.size >= this.config.maxOverrides) {
      this.evictOldest();
    }

    const entry: OverrideEntry = {
      key,
      value,
      priority,
      source,
      timestamp: Date.now(),
      ttl,
    };

    this.overrides.set(key, entry);
  }

  /**
   * 获取覆盖值
   */
  get(key: string): { value: unknown; source: string } | undefined {
    const entry = this.overrides.get(key);

    if (!entry) return undefined;

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.overrides.delete(key);

      return undefined;
    }

    return { value: entry.value, source: entry.source };
  }

  /**
   * 应用覆盖到配置
   */
  apply<T extends Record<string, unknown>>(baseConfig: T): T {
    const result = { ...baseConfig };

    const sortedOverrides = Array.from(this.overrides.values())
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));

    for (const override of sortedOverrides) {
      if (override.ttl && Date.now() - override.timestamp > override.ttl) {
        this.overrides.delete(override.key);

        continue;
      }

      this.setNestedValue(result, override.key, override.value);
    }

    return result;
  }

  /**
   * 删除覆盖
   */
  delete(key: string): boolean {
    return this.overrides.delete(key);
  }

  /**
   * 清空覆盖
   */
  clear(priority?: OverridePriority): void {
    if (priority) {
      for (const [key, entry] of this.overrides.entries()) {
        if (entry.priority === priority) {
          this.overrides.delete(key);
        }
      }
    } else {
      this.overrides.clear();
    }
  }

  /**
   * 获取所有覆盖
   */
  getAll(): OverrideEntry[] {
    return Array.from(this.overrides.values())
      .sort((a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority));
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; byPriority: Record<string, number> } {
    const byPriority: Record<string, number> = {};

    for (const entry of this.overrides.values()) {
      byPriority[entry.priority] = (byPriority[entry.priority] || 0) + 1;
    }

    return { total: this.overrides.size, byPriority };
  }

  /**
   * 优先级权重
   */
  private priorityWeight(priority: OverridePriority): number {
    const weights: Record<OverridePriority, number> = {
      env: 0,
      cli: 1,
      runtime: 2,
      remote: 3,
    };

    return weights[priority];
  }

  /**
   * 设置嵌套值
   */
  private setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
    const parts = key.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }

      current = current[parts[i]] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * 驱逐最旧覆盖
   */
  private evictOldest(): void {
    let oldestKey = '';
    let oldestTime = Infinity;

    for (const [key, entry] of this.overrides.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.overrides.delete(oldestKey);
    }
  }
}

export const configOverride = new ConfigOverride();
