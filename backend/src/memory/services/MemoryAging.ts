/**
 * 记忆老化服务
 * 基于LRU策略管理记忆的生命周期
 * 参考CC源码的记忆年龄管理思路实现
 */

import type { Memory } from '../types/Memory';

/**
 * 老化配置
 */
export interface AgingConfig {
  /** 最大记忆条目数 */
  maxEntries: number;
  /** 最大总大小（字节） */
  maxTotalSize: number;
  /** 最大年龄（天），超过此年龄的记忆会被标记为可淘汰 */
  maxAgeDays: number;
  /** 触发老化的访问次数阈值 */
  accessThreshold: number;
  /** 是否启用大小检查 */
  enableSizeCheck: boolean;
  /** 是否启用数量检查 */
  enableCountCheck: boolean;
  /** 是否启用年龄检查 */
  enableAgeCheck: boolean;
  /** 半衰期（天），用于计算时间衰减 */
  halfLifeDays: number;
  /** 最小保留分数，低于此分数的记忆可被淘汰 */
  minRetentionScore: number;
  /** 重要记忆最低分数（不被淘汰） */
  importantMemoryMinScore: number;
}

/**
 * 记忆访问记录
 */
export interface MemoryAccessRecord {
  memoryId: string;
  accessedAt: Date;
  accessType: 'read' | 'write' | 'query';
  userRole?: string;
}

/**
 * 老化评分详情
 */
export interface AgingScoreDetail {
  totalScore: number;
  ageScore: number;
  accessScore: number;
  sizeScore: number;
  priorityScore: number;
  recencyScore: number;
  isProtected: boolean;
  protectedReason?: string;
}

/**
 * 安全集成接口
 */
export interface SecurityIntegration {
  /**
   * 检查记忆是否受保护
   */
  isMemoryProtected(memoryId: string): boolean;

  /**
   * 获取记忆的访问级别
   */
  getMemoryAccessLevel(memoryId: string): string;

  /**
   * 检查用户是否有删除记忆的权限
   */
  canDeleteMemory(memoryId: string, userId?: string): boolean;
}

const DEFAULT_CONFIG: AgingConfig = {
  maxEntries: 1000,
  maxTotalSize: 10 * 1024 * 1024,
  maxAgeDays: 90,
  accessThreshold: 3,
  enableSizeCheck: true,
  enableCountCheck: true,
  enableAgeCheck: true,
  halfLifeDays: 30,
  minRetentionScore: 0.3,
  importantMemoryMinScore: 0.7,
};

interface MemoryEntry {
  memory: Memory;
  lastAccessedAt: number;
  accessCount: number;
  size: number;
  accessHistory: MemoryAccessRecord[];
}

export interface AgingResult {
  evicted: string[];
  kept: string[];
  reason: Record<string, string>;
  stats: {
    beforeCount: number;
    afterCount: number;
    beforeSize: number;
    afterSize: number;
    evictedCount: number;
    evictedSize: number;
  };
}

export class MemoryAgingService {
  private config: AgingConfig;
  private memoryEntries: Map<string, MemoryEntry> = new Map();
  private securityIntegration: SecurityIntegration | null = null;

  constructor(config: Partial<AgingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置安全集成服务
   */
  setSecurityIntegration(security: SecurityIntegration): void {
    this.securityIntegration = security;
  }

  /**
   * 获取安全集成服务
   */
  getSecurityIntegration(): SecurityIntegration | null {
    return this.securityIntegration;
  }

  /**
   * 注册记忆到老化服务
   */
  register(memory: Memory): void {
    const size = this.estimateSize(memory);
    this.memoryEntries.set(memory.id, {
      memory,
      lastAccessedAt: Date.now(),
      accessCount: 1,
      size,
      accessHistory: [],
    });
  }

  /**
   * 批量注册记忆
   */
  registerAll(memories: Memory[]): void {
    for (const memory of memories) {
      this.register(memory);
    }
  }

  /**
   * 访问记忆（更新LRU状态）
   */
  access(
    memoryId: string,
    accessType: 'read' | 'write' | 'query' = 'read',
    userRole?: string
  ): void {
    const entry = this.memoryEntries.get(memoryId);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;

      // 记录访问历史（最多保留最近10条记录）
      entry.accessHistory.unshift({
        memoryId,
        accessedAt: new Date(),
        accessType,
        userRole,
      });
      if (entry.accessHistory.length > 10) {
        entry.accessHistory.pop();
      }
    }
  }

  /**
   * 移除记忆
   */
  remove(memoryId: string): boolean {
    return this.memoryEntries.delete(memoryId);
  }

  /**
   * 获取记忆
   */
  get(
    memoryId: string,
    accessType: 'read' | 'write' | 'query' = 'read',
    userRole?: string
  ): Memory | undefined {
    const entry = this.memoryEntries.get(memoryId);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;

      // 记录访问历史（最多保留最近10条记录）
      entry.accessHistory.unshift({
        memoryId,
        accessedAt: new Date(),
        accessType,
        userRole,
      });
      if (entry.accessHistory.length > 10) {
        entry.accessHistory.pop();
      }

      return entry.memory;
    }
    return undefined;
  }

  /**
   * 获取所有记忆
   */
  getAll(): Memory[] {
    return Array.from(this.memoryEntries.values()).map((e) => e.memory);
  }

  /**
   * 获取记忆数量
   */
  size(): number {
    return this.memoryEntries.size;
  }

  /**
   * 获取总大小
   */
  totalSize(): number {
    let total = 0;
    for (const entry of this.memoryEntries.values()) {
      total += entry.size;
    }
    return total;
  }

  /**
   * 检查是否需要老化
   */
  needsAging(): boolean {
    if (
      this.config.enableCountCheck &&
      this.memoryEntries.size > this.config.maxEntries
    ) {
      return true;
    }
    if (
      this.config.enableSizeCheck &&
      this.totalSize() > this.config.maxTotalSize
    ) {
      return true;
    }
    return false;
  }

  /**
   * 执行老化淘汰
   * @returns 被淘汰的记忆ID列表
   */
  evict(): AgingResult {
    const beforeCount = this.memoryEntries.size;
    const beforeSize = this.totalSize();
    const evicted: string[] = [];
    const kept: string[] = [];
    const reason: Record<string, string> = {};

    const candidates = Array.from(this.memoryEntries.entries());

    candidates.sort((a, b) => {
      const scoreA = this.calculateEvictionScore(a[1]);
      const scoreB = this.calculateEvictionScore(b[1]);
      return scoreB - scoreA;
    });

    for (const [id, entry] of candidates) {
      const score = this.calculateEvictionScore(entry);

      if (score < 0.3) {
        kept.push(id);
        continue;
      }

      const ageMs = Date.now() - entry.memory.createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      let evictionReason = '';
      if (ageDays > this.config.maxAgeDays) {
        evictionReason = `age:${ageDays.toFixed(1)}d`;
      } else if (entry.accessCount < this.config.accessThreshold) {
        evictionReason = `low_access:${entry.accessCount}`;
      } else if (
        this.config.enableCountCheck &&
        this.memoryEntries.size > this.config.maxEntries
      ) {
        evictionReason = 'count_overflow';
      } else if (
        this.config.enableSizeCheck &&
        this.totalSize() > this.config.maxTotalSize
      ) {
        evictionReason = 'size_overflow';
      } else {
        evictionReason = `score:${score.toFixed(2)}`;
      }

      this.memoryEntries.delete(id);
      evicted.push(id);
      reason[id] = evictionReason;
    }

    return {
      evicted,
      kept,
      reason,
      stats: {
        beforeCount,
        afterCount: this.memoryEntries.size,
        beforeSize,
        afterSize: this.totalSize(),
        evictedCount: evicted.length,
        evictedSize: beforeSize - this.totalSize(),
      },
    };
  }

  /**
   * 计算淘汰分数（越高越应该淘汰）
   */
  private calculateEvictionScore(entry: MemoryEntry): number {
    const scoreDetail = this.calculateAgingScoreDetail(entry);
    return scoreDetail.totalScore;
  }

  /**
   * 计算老化评分详情
   */
  calculateAgingScoreDetail(entry: MemoryEntry): AgingScoreDetail {
    const now = Date.now();
    const ageMs = now - entry.memory.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const lastAccessMs = now - entry.lastAccessedAt;
    const lastAccessDays = lastAccessMs / (1000 * 60 * 60 * 24);

    // 检查是否受保护（通过安全模块）
    let isProtected = this.isMemoryProtected(entry.memory);
    let protectedReason: string | undefined;
    if (isProtected) {
      protectedReason = 'security_protected';
    } else if (entry.memory.metadata.isPinned) {
      protectedReason = 'pinned';
      isProtected = true;
    } else if (
      entry.memory.metadata.priority &&
      entry.memory.metadata.priority >= 8
    ) {
      protectedReason = 'high_priority';
      isProtected = true;
    }

    // 基于半衰期的时间衰减评分（越高越应该淘汰）
    let ageScore = 0;
    if (this.config.enableAgeCheck) {
      // 使用半衰期公式：score = 1 - 2^(-age/halfLife)
      ageScore = 1 - Math.pow(2, -ageDays / this.config.halfLifeDays);
      // 如果超过最大年龄，直接给高分
      if (ageDays > this.config.maxAgeDays) {
        ageScore = 0.9;
      }
    }

    // 访问频率评分
    let accessScore = 0;
    if (entry.accessCount < this.config.accessThreshold) {
      accessScore = 0.7;
    } else {
      // 访问次数越多，分数越低（越不应该淘汰）
      accessScore = Math.max(0, 1 - entry.accessCount / 50);
    }

    // 最近访问时间评分
    let recencyScore = 0;
    if (lastAccessDays > 30) {
      recencyScore = 0.6;
    } else if (lastAccessDays > 7) {
      recencyScore = 0.3;
    } else {
      recencyScore = 0.1;
    }

    // 大小评分（大记忆更容易被淘汰）
    let sizeScore = 0;
    if (this.config.enableSizeCheck) {
      const sizeRatio = entry.size / this.config.maxTotalSize;
      sizeScore = Math.min(0.3, sizeRatio * 100);
    }

    // 优先级评分
    let priorityScore = 0;
    const priority = entry.memory.metadata.priority || 5;
    if (priority < 5) {
      priorityScore = (0.3 * (5 - priority)) / 5;
    }

    // 综合评分（权重：年龄40%，访问频率20%，最近访问20%，大小10%，优先级10%）
    let totalScore =
      ageScore * 0.4 +
      accessScore * 0.2 +
      recencyScore * 0.2 +
      sizeScore * 0.1 +
      priorityScore * 0.1;

    // 如果受保护，给最低分
    if (isProtected) {
      totalScore = 0;
    }

    // 应用数量和大小溢出惩罚
    if (
      this.config.enableCountCheck &&
      this.memoryEntries.size > this.config.maxEntries
    ) {
      const countRatio = this.memoryEntries.size / this.config.maxEntries;
      totalScore = Math.min(1, totalScore * countRatio);
    }

    if (
      this.config.enableSizeCheck &&
      this.totalSize() > this.config.maxTotalSize
    ) {
      const sizeRatio = this.totalSize() / this.config.maxTotalSize;
      totalScore = Math.min(1, totalScore * sizeRatio);
    }

    return {
      totalScore: Math.max(0, Math.min(1, totalScore)),
      ageScore,
      accessScore,
      sizeScore,
      priorityScore,
      recencyScore,
      isProtected,
      protectedReason,
    };
  }

  /**
   * 检查记忆是否受安全保护
   */
  private isMemoryProtected(memory: Memory): boolean {
    // 如果没有安全集成，返回false
    if (!this.securityIntegration) {
      return false;
    }

    // 检查记忆的权限级别
    const memoryLevel = memory.metadata.accessLevel || 'default';

    // 高权限记忆不被淘汰
    if (memoryLevel === 'protected' || memoryLevel === 'admin') {
      return true;
    }

    // 通过安全模块检查是否有特殊保护
    return this.securityIntegration.isMemoryProtected(memory.id);
  }

  /**
   * 获取记忆的老化评分详情
   */
  getAgingScoreDetail(memoryId: string): AgingScoreDetail | null {
    const entry = this.memoryEntries.get(memoryId);
    if (!entry) {
      return null;
    }
    return this.calculateAgingScoreDetail(entry);
  }

  /**
   * 获取所有记忆的老化评分详情
   */
  getAllAgingScoreDetails(): Array<{
    memoryId: string;
    scoreDetail: AgingScoreDetail;
  }> {
    const result: Array<{ memoryId: string; scoreDetail: AgingScoreDetail }> =
      [];
    for (const [id, entry] of this.memoryEntries) {
      result.push({
        memoryId: id,
        scoreDetail: this.calculateAgingScoreDetail(entry),
      });
    }
    return result;
  }

  /**
   * 获取即将过期的记忆列表
   */
  getExpiringMemories(threshold: number = 0.7): Memory[] {
    const expiring: Memory[] = [];
    for (const entry of this.memoryEntries.values()) {
      const score = this.calculateEvictionScore(entry);
      if (score >= threshold && !this.isMemoryProtected(entry.memory)) {
        expiring.push(entry.memory);
      }
    }
    return expiring.sort((a, b) => {
      const scoreA = this.calculateEvictionScore(this.memoryEntries.get(a.id)!);
      const scoreB = this.calculateEvictionScore(this.memoryEntries.get(b.id)!);
      return scoreB - scoreA;
    });
  }

  /**
   * 估算记忆大小
   */
  private estimateSize(memory: Memory): number {
    const contentSize = new TextEncoder().encode(memory.content).length;
    const metadataSize = new TextEncoder().encode(
      JSON.stringify(memory.metadata)
    ).length;
    return contentSize + metadataSize;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AgingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): AgingConfig {
    return { ...this.config };
  }

  /**
   * 获取记忆年龄信息
   */
  getMemoryAge(memoryId: string): { ageDays: number; isStale: boolean } | null {
    const entry = this.memoryEntries.get(memoryId);
    if (!entry) return null;

    const ageMs = Date.now() - entry.memory.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    return {
      ageDays,
      isStale: ageDays > this.config.maxAgeDays,
    };
  }

  /**
   * 清理所有记忆
   */
  clear(): void {
    this.memoryEntries.clear();
  }
}
