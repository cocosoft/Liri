/**
 * 记忆遗忘机制
 * 基于重要性、访问次数和年龄自动遗忘不重要记忆
 * 参考CC源码的记忆年龄管理思路实现
 */

import { logger } from '@modules/utils/log';

/**
 * 遗忘策略配置
 */
export interface ForgetterConfig {
  /** 最小年龄（天数），超过此年龄的记忆才会被考虑遗忘 */
  minAgeDays: number;
  /** 最大年龄（天数），超过此年龄的记忆强制遗忘 */
  maxAgeDays: number;
  /** 最小重要性（0-1），低于此值的记忆会被遗忘 */
  minImportance: number;
  /** 最小访问次数，低于此值的记忆会被遗忘 */
  minAccessCount: number;
  /** 每次遗忘的最大记忆数 */
  maxForgetPerRun: number;
  /** 保留重要标记的记忆 */
  preservePinned: boolean;
  /** 保留用户标记为重要的记忆 */
  preserveImportant: boolean;
}

/**
 * 遗忘结果
 */
export interface ForgetResult {
  forgotten: string[];
  preserved: string[];
  totalChecked: number;
  timestamp: number;
}

/**
 * 记忆元数据（简化版）
 */
export interface MemoryForgetMetadata {
  id: string;
  createdAt: number;
  lastAccessedAt: number;
  importance: number;
  accessCount: number;
  isPinned: boolean;
  isImportant: boolean;
  tags: string[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ForgetterConfig = {
  minAgeDays: 30,
  maxAgeDays: 180,
  minImportance: 0.3,
  minAccessCount: 2,
  maxForgetPerRun: 50,
  preservePinned: true,
  preserveImportant: true,
};

/**
 * 遗忘条件评估结果
 */
interface ForgetEvaluation {
  shouldForget: boolean;
  reason: string;
  score: number;
}

/**
 * 记忆遗忘器
 */
export class MemoryForgetter {
  private config: ForgetterConfig;
  private memoryStore: Map<string, MemoryForgetMetadata> = new Map();

  constructor(config: Partial<ForgetterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册记忆
   */
  registerMemory(metadata: MemoryForgetMetadata): void {
    this.memoryStore.set(metadata.id, metadata);
  }

  /**
   * 批量注册记忆
   */
  registerMemories(memories: MemoryForgetMetadata[]): void {
    for (const memory of memories) {
      this.registerMemory(memory);
    }
  }

  /**
   * 注销记忆
   */
  unregisterMemory(memoryId: string): void {
    this.memoryStore.delete(memoryId);
  }

  /**
   * 更新记忆访问信息
   */
  updateAccess(memoryId: string, accessCount: number, lastAccessedAt: number): void {
    const memory = this.memoryStore.get(memoryId);
    if (memory) {
      memory.accessCount = accessCount;
      memory.lastAccessedAt = lastAccessedAt;
    }
  }

  /**
   * 更新重要性
   */
  updateImportance(memoryId: string, importance: number): void {
    const memory = this.memoryStore.get(memoryId);
    if (memory) {
      memory.importance = importance;
    }
  }

  /**
   * 评估单个记忆是否应该被遗忘
   */
  evaluateForget(memoryId: string): ForgetEvaluation | null {
    const memory = this.memoryStore.get(memoryId);
    if (!memory) {
      return null;
    }

    const now = Date.now();
    const ageDays = (now - memory.createdAt) / (1000 * 60 * 60 * 24);

    if (this.config.preservePinned && memory.isPinned) {
      return { shouldForget: false, reason: '已固定', score: 0 };
    }

    if (this.config.preserveImportant && memory.isImportant) {
      return { shouldForget: false, reason: '已标记重要', score: 0 };
    }

    if (ageDays < this.config.minAgeDays) {
      return { shouldForget: false, reason: '年龄未达到阈值', score: 0 };
    }

    if (ageDays >= this.config.maxAgeDays) {
      return { shouldForget: true, reason: '超过最大年龄', score: 1.0 };
    }

    let score = 0;
    const reasons: string[] = [];

    const ageFactor = Math.min((ageDays - this.config.minAgeDays) / (this.config.maxAgeDays - this.config.minAgeDays), 1);
    score += ageFactor * 0.4;
    reasons.push(`年龄因子: ${ageFactor.toFixed(2)}`);

    const importanceFactor = 1 - memory.importance;
    score += importanceFactor * 0.3;
    reasons.push(`重要性因子: ${importanceFactor.toFixed(2)}`);

    const accessFactor = memory.accessCount < this.config.minAccessCount ? 1 : Math.max(0, 1 - (memory.accessCount - this.config.minAccessCount) / 10);
    score += accessFactor * 0.3;
    reasons.push(`访问因子: ${accessFactor.toFixed(2)}`);

    const shouldForget = score >= 0.5;

    return {
      shouldForget,
      reason: reasons.join(', '),
      score,
    };
  }

  /**
   * 执行遗忘
   */
  forget(): ForgetResult {
    const now = Date.now();
    const forgotten: string[] = [];
    const preserved: string[] = [];

    const memoryIds = Array.from(this.memoryStore.keys());
    for (const memoryId of memoryIds) {
      const evaluation = this.evaluateForget(memoryId);

      if (!evaluation) {
        preserved.push(memoryId);
        continue;
      }

      if (evaluation.shouldForget && forgotten.length < this.config.maxForgetPerRun) {
        forgotten.push(memoryId);
        logger.debug(`Memory ${memoryId} will be forgotten: ${evaluation.reason} (score: ${evaluation.score.toFixed(2)})`);
      } else {
        preserved.push(memoryId);
      }
    }

    return {
      forgotten,
      preserved,
      totalChecked: this.memoryStore.size,
      timestamp: now,
    };
  }

  /**
   * 获取应该遗忘的记忆列表
   */
  getMemoriesToForget(): string[] {
    const result: string[] = [];

    const memoryIds = Array.from(this.memoryStore.keys());
    for (const memoryId of memoryIds) {
      const evaluation = this.evaluateForget(memoryId);
      if (evaluation?.shouldForget) {
        result.push(memoryId);
      }
    }

    return result;
  }

  /**
   * 获取记忆的遗忘评估
   */
  getForgetEvaluations(): Map<string, ForgetEvaluation> {
    const results = new Map<string, ForgetEvaluation>();

    const memoryIds = Array.from(this.memoryStore.keys());
    for (const memoryId of memoryIds) {
      const evaluation = this.evaluateForget(memoryId);
      if (evaluation) {
        results.set(memoryId, evaluation);
      }
    }

    return results;
  }

  /**
   * 获取遗忘统计
   */
  getStats(): {
    total: number;
    forgettable: number;
    preservable: number;
    avgScore: number;
  } {
    let forgettable = 0;
    let preservable = 0;
    let totalScore = 0;

    const memoryIds = Array.from(this.memoryStore.keys());
    for (const memoryId of memoryIds) {
      const evaluation = this.evaluateForget(memoryId);
      if (evaluation) {
        if (evaluation.shouldForget) {
          forgettable++;
        } else {
          preservable++;
        }
        totalScore += evaluation.score;
      }
    }

    const total = this.memoryStore.size;

    return {
      total,
      forgettable,
      preservable,
      avgScore: total > 0 ? totalScore / total : 0,
    };
  }

  /**
   * 重置遗忘器
   */
  reset(): void {
    this.memoryStore.clear();
  }

  /**
   * 获取已注册的记忆数量
   */
  getRegisteredCount(): number {
    return this.memoryStore.size;
  }

  /**
   * 检查记忆是否注册
   */
  isRegistered(memoryId: string): boolean {
    return this.memoryStore.has(memoryId);
  }

  /**
   * 获取记忆元数据
   */
  getMemoryMetadata(memoryId: string): MemoryForgetMetadata | undefined {
    return this.memoryStore.get(memoryId);
  }

  /**
   * 批量更新配置
   */
  updateConfig(config: Partial<ForgetterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): ForgetterConfig {
    return { ...this.config };
  }
}

/**
 * 遗忘器单例
 */
export const memoryForgetter = new MemoryForgetter();

/**
 * 创建遗忘器工厂函数
 */
export function createForgetter(config?: Partial<ForgetterConfig>): MemoryForgetter {
  return new MemoryForgetter(config);
}
