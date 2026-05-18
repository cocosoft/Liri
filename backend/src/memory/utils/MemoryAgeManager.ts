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
 * 归档候选记忆信息
 */
export interface ArchiveCandidate {
  /** 记忆ID */
  memoryId: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 年龄（天） */
  ageDays: number;
  /** 新鲜度 */
  freshness: MemoryFreshness;
  /** 归档优先级 */
  priority: number;
}

/**
 * 自动归档配置
 */
export interface AutoArchiveConfig {
  /** 是否启用自动归档 */
  enabled: boolean;
  /** 检查间隔（毫秒），默认6小时 */
  checkIntervalMs: number;
  /** 归档时间（小时），默认凌晨3点 */
  archiveHour: number;
  /** 单次最大归档数量 */
  maxArchiveBatch: number;
  /** 归档回调函数 */
  onArchive?: (candidates: ArchiveCandidate[]) => Promise<void>;
  /** 归档前回调 */
  onBeforeArchive?: () => void;
  /** 归档后回调 */
  onAfterArchive?: (count: number) => void;
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
  /** 自动归档配置 */
  autoArchive?: Partial<AutoArchiveConfig>;
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
 * 默认自动归档配置
 */
const DEFAULT_AUTO_ARCHIVE_CONFIG: AutoArchiveConfig = {
  enabled: true,
  checkIntervalMs: 6 * 60 * 60 * 1000, // 6小时
  archiveHour: 3, // 凌晨3点
  maxArchiveBatch: 50,
};

/**
 * 记忆年龄管理器
 */
export class MemoryAgeManager {
  private config: MemoryAgeConfig;
  private autoArchiveConfig: AutoArchiveConfig;
  private archiveTimer: NodeJS.Timeout | null = null;
  private lastArchiveTime: number = 0;
  private isAutoArchiveRunning: boolean = false;

  constructor(config: Partial<MemoryAgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.autoArchiveConfig = {
      ...DEFAULT_AUTO_ARCHIVE_CONFIG,
      ...config.autoArchive,
    };
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
    if (config.autoArchive) {
      this.autoArchiveConfig = {
        ...this.autoArchiveConfig,
        ...config.autoArchive,
      };
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): MemoryAgeConfig {
    return { ...this.config };
  }

  /**
   * 获取自动归档配置
   */
  getAutoArchiveConfig(): AutoArchiveConfig {
    return { ...this.autoArchiveConfig };
  }

  /**
   * 启动自动归档定时器
   */
  startAutoArchive(): void {
    if (!this.autoArchiveConfig.enabled) {
      logger.debug('自动归档未启用');
      return;
    }

    if (this.archiveTimer) {
      logger.debug('自动归档定时器已运行');
      return;
    }

    logger.info('启动记忆自动归档定时器');
    this.scheduleNextArchive();
  }

  /**
   * 停止自动归档定时器
   */
  stopAutoArchive(): void {
    if (this.archiveTimer) {
      clearTimeout(this.archiveTimer);
      this.archiveTimer = null;
      logger.info('停止记忆自动归档定时器');
    }
  }

  /**
   * 调度下一次归档检查
   */
  private scheduleNextArchive(): void {
    const now = new Date();
    const nextCheckTime = now.getTime() + this.autoArchiveConfig.checkIntervalMs;
    
    this.archiveTimer = setTimeout(() => {
      this.checkAndArchive();
    }, this.autoArchiveConfig.checkIntervalMs);

    logger.debug(`下次归档检查: ${new Date(nextCheckTime).toISOString()}`);
  }

  /**
   * 检查是否需要归档并执行归档
   */
  private async checkAndArchive(): Promise<void> {
    try {
      const now = new Date();
      
      // 检查是否在归档时间窗口内（归档时间前后1小时）
      const archiveTime = new Date(now);
      archiveTime.setHours(this.autoArchiveConfig.archiveHour, 0, 0, 0);
      const timeDiff = Math.abs(now.getTime() - archiveTime.getTime());
      const withinWindow = timeDiff < 60 * 60 * 1000; // 1小时窗口

      if (!withinWindow) {
        // 不在归档时间窗口，继续调度
        this.scheduleNextArchive();
        return;
      }

      // 检查是否已经在今天归档过
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (this.lastArchiveTime >= today.getTime()) {
        logger.debug('今天已执行过归档');
        this.scheduleNextArchive();
        return;
      }

      await this.performAutoArchive();
    } catch (error) {
      logger.error('自动归档检查失败', { error });
    } finally {
      // 继续调度下一次检查
      this.scheduleNextArchive();
    }
  }

  /**
   * 执行自动归档
   */
  private async performAutoArchive(): Promise<void> {
    if (this.isAutoArchiveRunning) {
      logger.debug('自动归档正在运行中');
      return;
    }

    try {
      this.isAutoArchiveRunning = true;
      logger.info('开始执行记忆自动归档');

      // 调用归档前回调
      this.autoArchiveConfig.onBeforeArchive?.();

      // 获取需要归档的记忆候选
      const candidates = await this.findArchiveCandidates();

      if (candidates.length === 0) {
        logger.info('没有需要归档的记忆');
        return;
      }

      logger.info(`发现 ${candidates.length} 个需要归档的记忆`);

      // 限制归档数量
      const batch = candidates.slice(0, this.autoArchiveConfig.maxArchiveBatch);

      // 调用归档回调
      if (this.autoArchiveConfig.onArchive) {
        await this.autoArchiveConfig.onArchive(batch);
        logger.info(`已归档 ${batch.length} 个记忆`);
      }

      // 更新最后归档时间
      this.lastArchiveTime = Date.now();

      // 调用归档后回调
      this.autoArchiveConfig.onAfterArchive?.(batch.length);

    } catch (error) {
      logger.error('自动归档执行失败', { error });
    } finally {
      this.isAutoArchiveRunning = false;
    }
  }

  /**
   * 查找需要归档的记忆候选
   * @param memories 记忆列表（可选，如果不提供则需要通过回调获取）
   * @returns 归档候选列表
   */
  async findArchiveCandidates(
    memories?: Array<{ id: string; createdAt: number }>
  ): Promise<ArchiveCandidate[]> {
    // 如果没有提供记忆列表，返回空列表（实际使用时需要通过回调获取）
    if (!memories || memories.length === 0) {
      return [];
    }

    const candidates: ArchiveCandidate[] = [];

    for (const memory of memories) {
      const ageDays = this.memoryAgeDays(memory.createdAt);
      const freshness = this.getFreshness(ageDays);
      const priority = this.getPriority(memory.createdAt);

      // 只有 stale 和 old 的记忆才需要归档
      if (freshness === 'stale' || freshness === 'old') {
        candidates.push({
          memoryId: memory.id,
          createdAt: memory.createdAt,
          ageDays,
          freshness,
          priority,
        });
      }
    }

    // 按优先级排序（优先级越高越先归档）
    candidates.sort((a, b) => b.priority - a.priority);

    return candidates;
  }

  /**
   * 手动触发归档
   * @param memories 记忆列表
   * @returns 归档的记忆数量
   */
  async triggerArchive(
    memories: Array<{ id: string; createdAt: number }>
  ): Promise<number> {
    logger.info('手动触发记忆归档');

    const candidates = await this.findArchiveCandidates(memories);
    
    if (candidates.length === 0) {
      return 0;
    }

    const batch = candidates.slice(0, this.autoArchiveConfig.maxArchiveBatch);

    if (this.autoArchiveConfig.onArchive) {
      await this.autoArchiveConfig.onArchive(batch);
    }

    this.lastArchiveTime = Date.now();
    return batch.length;
  }

  /**
   * 获取最后归档时间
   */
  getLastArchiveTime(): number {
    return this.lastArchiveTime;
  }

  /**
   * 检查自动归档是否正在运行
   */
  isArchiveRunning(): boolean {
    return this.isAutoArchiveRunning;
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

/**
 * 便捷函数：查找归档候选
 */
export async function findArchiveCandidates(
  memories?: Array<{ id: string; createdAt: number }>
): Promise<ArchiveCandidate[]> {
  return memoryAgeManager.findArchiveCandidates(memories);
}

/**
 * 便捷函数：启动自动归档
 */
export function startAutoArchive(): void {
  memoryAgeManager.startAutoArchive();
}

/**
 * 便捷函数：停止自动归档
 */
export function stopAutoArchive(): void {
  memoryAgeManager.stopAutoArchive();
}

/**
 * 便捷函数：手动触发归档
 */
export async function triggerArchive(
  memories: Array<{ id: string; createdAt: number }>
): Promise<number> {
  return memoryAgeManager.triggerArchive(memories);
}
