/**
 * MemoryProvider 抽象基类 (ABC)
 * 对标 Hermes agent/memory_provider.py
 * 定义记忆提供者的统一接口，所有具体记忆后端必须实现此接口
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { Memory, MemoryStats } from './types/Memory';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'memory\MemoryProvider', level: LogLevel.INFO });

/**
 * 记忆查询条件
 */
export interface MemoryQuery {
  text?: string;
  tags?: string[];
  types?: string[];
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'relevance';
  sortOrder?: 'asc' | 'desc';
}

/**
 * 记忆嵌入向量
 */
export interface MemoryEmbedding {
  id: string;
  vector: number[];
  model: string;
  dimensions: number;
}

/**
 * 记忆摘要
 */
export interface MemorySummary {
  id: string;
  summary: string;
  keyPoints: string[];
  generatedAt: Date;
  model: string;
}

/**
 * 记忆相似搜索结果
 */
export interface MemorySimilarityResult {
  memory: Memory;
  score: number;
  embedding?: MemoryEmbedding;
}

/**
 * 提供者状态
 */
export interface MemoryProviderStatus {
  initialized: boolean;
  healthy: boolean;
  memoryCount: number;
  totalSize: number;
  lastSyncAt?: Date;
  error?: string;
}

/**
 * 批量操作结果
 */
export interface MemoryBatchResult {
  success: boolean;
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  totalCount: number;
}

/**
 * MemoryProvider 抽象基类
 * 所有具体记忆后端（文件系统、数据库、向量引擎等）必须继承此类
 */
export abstract class MemoryProvider {
  protected initialized: boolean = false;

  /**
   * 获取提供者名称
   */
  abstract get name(): string;

  /**
   * 初始化提供者
   * 执行连接建立、资源分配等初始化操作
   */
  abstract initialize(): Promise<void>;

  /**
   * 存储一条记忆
   * @param memory 记忆数据
   * @returns 存储后的带时间戳记忆
   */
  abstract store(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  /**
   * 批量存储记忆
   * @param memories 记忆列表
   * @returns 批量操作结果
   */
  abstract storeBatch(
    memories: Array<Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<MemoryBatchResult>;

  /**
   * 根据 ID 检索记忆
   * @param id 记忆 ID
   * @returns 记忆或 null
   */
  abstract retrieve(id: string): Promise<Memory | null>;

  /**
   * 根据查询条件检索记忆
   * @param query 查询条件
   * @returns 记忆列表
   */
  abstract retrieveByQuery(query: MemoryQuery): Promise<Memory[]>;

  /**
   * 根据标签检索记忆
   * @param tags 标签列表
   * @param limit 数量限制
   * @returns 记忆列表
   */
  abstract retrieveByTags(tags: string[], limit?: number): Promise<Memory[]>;

  /**
   * 根据时间范围检索记忆
   * @param fromDate 开始日期
   * @param toDate 结束日期
   * @returns 记忆列表
   */
  abstract retrieveByTimeRange(fromDate: Date, toDate: Date): Promise<Memory[]>;

  /**
   * 根据相似度检索记忆（向量搜索）
   * @param embedding 目标嵌入向量
   * @param limit 数量限制
   * @returns 相似度排序的记忆列表
   */
  abstract retrieveBySimilarity(
    embedding: number[],
    limit?: number,
    threshold?: number
  ): Promise<MemorySimilarityResult[]>;

  /**
   * 更新记忆
   * @param id 记忆 ID
   * @param updates 更新字段
   * @returns 更新后的记忆
   */
  abstract update(id: string, updates: Partial<Memory>): Promise<Memory>;

  /**
   * 删除记忆
   * @param id 记忆 ID
   */
  abstract delete(id: string): Promise<void>;

  /**
   * 批量删除记忆
   * @param ids 记忆 ID 列表
   * @returns 批量操作结果
   */
  abstract deleteBatch(ids: string[]): Promise<MemoryBatchResult>;

  /**
   * 获取记忆总数
   * @returns 记忆数量
   */
  abstract count(): Promise<number>;

  /**
   * 分页列出记忆
   * @param offset 偏移量
   * @param limit 数量限制
   * @returns 记忆列表
   */
  abstract list(offset: number, limit: number): Promise<Memory[]>;

  /**
   * 生成记忆摘要
   * @param id 记忆 ID
   * @returns 记忆摘要
   */
  abstract summarize(id: string): Promise<MemorySummary>;

  /**
   * 获取记忆统计信息
   * @returns 记忆统计
   */
  abstract getStats(): Promise<MemoryStats>;

  /**
   * 健康检查
   * @returns 是否健康
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * 关闭提供者
   * 执行资源释放、连接关闭等清理操作
   */
  abstract shutdown(): Promise<void>;

  // ── 可选生命周期钩子 ──

  /**
   * 会话轮次开始时触发
   * @param turn 轮次信息
   */
  onTurnStart?(turn: {
    sessionId: string;
    turnNumber: number;
    timestamp: number;
  }): Promise<void>;

  /**
   * 会话结束时触发
   * @param messages 会话中的消息列表
   */
  onSessionEnd?(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): Promise<void>;

  /**
   * 压缩前触发，可返回替代摘要文本
   * @param messages 待压缩的消息列表
   * @returns 可选的替代摘要文本，返回 null 则使用默认压缩逻辑
   */
  onPreCompress?(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): Promise<string | null>;

  /**
   * 获取提供者状态
   * @returns 提供者状态
   */
  async getStatus(): Promise<MemoryProviderStatus> {
    if (!this.initialized) {
      return {
        initialized: false,
        healthy: false,
        memoryCount: 0,
        totalSize: 0,
      };
    }

    const healthy = await this.healthCheck();
    const memoryCount = await this.count();
    const stats = await this.getStats();

    return {
      initialized: this.initialized,
      healthy,
      memoryCount,
      totalSize: stats.totalSize,
    };
  }

  /**
   * 检查是否已初始化
   */
  protected checkInitialized(): void {
    if (!this.initialized) {
      throw new AppError(
        `MemoryProvider "${this.name}" 未初始化，请先调用 initialize()`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_STATE'
      );
    }
  }

  /**
   * 计算两个向量的余弦相似度
   * @param a 向量 a
   * @param b 向量 b
   * @returns 相似度分数 (0-1)
   */
  protected cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new AppError(
        '向量维度不匹配',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT'
      );
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 验证记忆数据完整性
   * @param memory 记忆数据
   * @returns 是否有效
   */
  protected validateMemory(memory: Partial<Memory>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!memory.content || memory.content.trim().length === 0) {
      errors.push('记忆内容不能为空');
    }

    if (!memory.metadata) {
      errors.push('记忆元数据不能为空');
    }

    if (memory.content && memory.content.length > 100000) {
      errors.push('记忆内容超过最大长度限制 (100000 字符)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 分页截取
   * @param items 完整列表
   * @param offset 偏移量
   * @param limit 数量限制
   * @returns 截取后的列表
   */
  protected paginate<T>(items: T[], offset: number, limit: number): T[] {
    return items.slice(offset, offset + limit);
  }
}
