/**
 * 记忆年龄管理
 * 负责管理记忆的新鲜度，计算记忆的年龄和提示
 * 参考CC源码 cc_code/backend/memdir/memoryAge.ts 实现
 */

import { logger } from '@modules/utils/log';

/**
 * 记忆新鲜度级别
 */
export type MemoryFreshness = 'fresh' | 'recent' | 'old' | 'stale';

/**
 * 记忆年龄信息
 */
export interface MemoryAgeInfo {
  /** 记忆年龄（天） */
  ageDays: number;
  /** 新鲜度级别 */
  freshness: MemoryFreshness;
  /** 新鲜度文本描述 */
  freshnessText: string;
  /** 是否可以遗忘 */
  forgettable: boolean;
}

/**
 * 记忆年龄配置
 */
export interface MemoryAgeConfig {
  /** 新鲜记忆阈值（天） */
  freshThresholdDays: number;
  /** 近期记忆阈值（天） */
  recentThresholdDays: number;
  /** 可遗忘阈值（天） */
  forgettableThresholdDays: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: MemoryAgeConfig = {
  freshThresholdDays: 7,
  recentThresholdDays: 30,
  forgettableThresholdDays: 90,
};

/**
 * 记忆年龄管理器
 */
export class MemoryAgeManager {
  private config: MemoryAgeConfig;

  constructor(config: Partial<MemoryAgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 计算记忆年龄（天）
   * @param timestamp 记忆时间戳
   * @returns 年龄（天）
   */
  memoryAgeDays(timestamp: number | Date): number {
    const date =
      typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * 计算记忆年龄信息
   * @param timestamp 记忆时间戳
   * @returns 记忆年龄信息
   */
  memoryAge(timestamp: number | Date): MemoryAgeInfo {
    const ageDays = this.memoryAgeDays(timestamp);
    const freshness = this.getFreshness(ageDays);
    const freshnessText = this.getFreshnessText(ageDays, freshness);
    const forgettable = this.isForgettable(ageDays);

    return {
      ageDays,
      freshness,
      freshnessText,
      forgettable,
    };
  }

  /**
   * 获取新鲜度级别
   * @param ageDays 年龄（天）
   * @returns 新鲜度级别
   */
  getFreshness(ageDays: number): MemoryFreshness {
    if (ageDays <= this.config.freshThresholdDays) {
      return 'fresh';
    }
    if (ageDays <= this.config.recentThresholdDays) {
      return 'recent';
    }
    if (ageDays <= this.config.forgettableThresholdDays) {
      return 'old';
    }
    return 'stale';
  }

  /**
   * 获取新鲜度文本描述
   * @param ageDays 年龄（天）
   * @param freshness 新鲜度级别
   * @returns 新鲜度文本描述
   */
  getFreshnessText(ageDays: number, freshness?: MemoryFreshness): string {
    const fresh = freshness || this.getFreshness(ageDays);

    switch (fresh) {
      case 'fresh':
        if (ageDays === 0) {
          return '今天';
        }
        if (ageDays === 1) {
          return '昨天';
        }
        return `${ageDays}天前`;

      case 'recent':
        if (ageDays < 14) {
          return `${ageDays}天前`;
        }
        if (ageDays < 30) {
          const weeks = Math.floor(ageDays / 7);
          return `${weeks}周前`;
        }
        return `${Math.floor(ageDays / 30)}个月前`;

      case 'old':
        if (ageDays < 60) {
          return `${ageDays}天前`;
        }
        return `${Math.floor(ageDays / 30)}个月前`;

      case 'stale':
        return `${Math.floor(ageDays / 30)}个月前`;

      default:
        return `${ageDays}天前`;
    }
  }

  /**
   * 检查记忆是否可以被遗忘
   * @param ageDays 年龄（天）
   * @returns 是否可以遗忘
   */
  isForgettable(ageDays: number): boolean {
    return ageDays > this.config.forgettableThresholdDays;
  }

  /**
   * 获取记忆优先级（用于LRU等策略）
   * @param timestamp 记忆时间戳
   * @returns 优先级（越小越优先保留）
   */
  getPriority(timestamp: number | Date): number {
    const ageDays = this.memoryAgeDays(timestamp);
    const freshness = this.getFreshness(ageDays);

    switch (freshness) {
      case 'fresh':
        return 1;
      case 'recent':
        return 2;
      case 'old':
        return 3;
      case 'stale':
        return 4;
      default:
        return 5;
    }
  }

  /**
   * 计算记忆的衰减因子（用于向量搜索重排序）
   * @param timestamp 记忆时间戳
   * @param decayRate 衰减率（默认0.01）
   * @returns 衰减因子（0-1之间）
   */
  getDecayFactor(timestamp: number | Date, decayRate: number = 0.01): number {
    const ageDays = this.memoryAgeDays(timestamp);
    return Math.exp(-decayRate * ageDays);
  }

  /**
   * 检查记忆是否需要刷新
   * @param timestamp 记忆时间戳
   * @param refreshThresholdDays 刷新阈值（天）
   * @returns 是否需要刷新
   */
  needsRefresh(
    timestamp: number | Date,
    refreshThresholdDays?: number
  ): boolean {
    const threshold = refreshThresholdDays ?? this.config.freshThresholdDays;
    const ageDays = this.memoryAgeDays(timestamp);
    return ageDays > threshold;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MemoryAgeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): MemoryAgeConfig {
    return { ...this.config };
  }
}

/**
 * 导出单例
 */
export const memoryAgeManager = new MemoryAgeManager();

/**
 * 便捷函数：计算记忆年龄
 */
export function memoryAge(timestamp: number | Date): MemoryAgeInfo {
  return memoryAgeManager.memoryAge(timestamp);
}

/**
 * 便捷函数：获取新鲜度文本
 */
export function memoryFreshnessText(timestamp: number | Date): string {
  const info = memoryAgeManager.memoryAge(timestamp);
  return info.freshnessText;
}

/**
 * 便捷函数：检查是否应该遗忘
 */
export function shouldForget(timestamp: number | Date): boolean {
  return memoryAgeManager.isForgettable(
    memoryAgeManager.memoryAgeDays(timestamp)
  );
}

/**
 * 便捷函数：获取记忆衰减因子
 */
export function memoryDecay(
  timestamp: number | Date,
  decayRate?: number
): number {
  return memoryAgeManager.getDecayFactor(timestamp, decayRate);
}
