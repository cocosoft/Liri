import { MemoryType } from './MemoryType';
import { MemoryMetadata } from './MemoryMetadata';

/**
 * 记忆接口
 */
export interface Memory {
  /**
   * 记忆唯一标识符
   */
  id: string;

  /**
   * 记忆内容
   */
  content: string;

  /**
   * 记忆元数据
   */
  metadata: MemoryMetadata;

  /**
   * 记忆创建时间
   */
  createdAt: Date;

  /**
   * 记忆更新时间
   */
  updatedAt: Date;
}

/**
 * 记忆统计信息
 */
export interface MemoryStats {
  /**
   * 记忆总数
   */
  total: number;

  /**
   * 按类型统计的记忆数量
   */
  byType: Record<MemoryType, number>;

  /**
   * 最近创建的记忆数量
   */
  recent: number;

  /**
   * 记忆总大小（字节）
   */
  totalSize: number;
}

/**
 * 创建记忆
 * @param data 记忆数据
 * @returns 记忆实例
 */
export function createMemory(
  data: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
): Memory {
  const now = new Date();
  return {
    id: `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    content: data.content,
    metadata: data.metadata,
    createdAt: now,
    updatedAt: now,
  };
}
