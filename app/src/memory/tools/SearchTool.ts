import type { Memory } from '../types/Memory';
import { MemoryManagerImpl } from '../MemoryManager';

/**
 * 搜索工具接口
 */
export interface SearchTool {
  // 搜索记忆
  search(query: string): Promise<Memory[]>;

  // 按标签搜索
  searchByTag(tag: string): Promise<Memory[]>;

  // 按类型搜索
  searchByType(type: string): Promise<Memory[]>;

  // 高级搜索
  advancedSearch(options: AdvancedSearchOptions): Promise<Memory[]>;
}

/**
 * 高级搜索选项
 */
export interface AdvancedSearchOptions {
  // 搜索关键词
  query?: string;

  // 标签
  tags?: string[];

  // 记忆类型
  type?: string;

  // 开始时间
  startDate?: Date;

  // 结束时间
  endDate?: Date;

  // 优先级
  priority?: string;

  // 排序方式
  sortBy?: 'createdAt' | 'updatedAt' | 'relevance';

  // 排序方向
  sortOrder?: 'asc' | 'desc';

  // 限制返回数量
  limit?: number;
}

/**
 * 搜索工具实现
 */
export class SearchToolImpl implements SearchTool {
  /**
   * 记忆管理器
   */
  private memoryManager: MemoryManagerImpl;

  /**
   * 构造函数
   * @param memoryManager 记忆管理器
   */
  constructor(memoryManager: MemoryManagerImpl) {
    this.memoryManager = memoryManager;
  }

  /**
   * 搜索记忆
   * @param query 搜索关键词
   * @returns 匹配的记忆列表
   */
  async search(query: string): Promise<Memory[]> {
    return this.memoryManager.getRelevantMemories(query);
  }

  /**
   * 按标签搜索
   * @param tag 标签
   * @returns 匹配的记忆列表
   */
  async searchByTag(tag: string): Promise<Memory[]> {
    const allMemories = await this.memoryManager.getAllMemories();
    return allMemories.filter(
      (memory) => memory.metadata.tags && memory.metadata.tags.includes(tag)
    );
  }

  /**
   * 按类型搜索
   * @param type 记忆类型
   * @returns 匹配的记忆列表
   */
  async searchByType(type: string): Promise<Memory[]> {
    const allMemories = await this.memoryManager.getAllMemories();
    return allMemories.filter((memory) => memory.metadata.type === type);
  }

  /**
   * 高级搜索
   * @param options 搜索选项
   * @returns 匹配的记忆列表
   */
  async advancedSearch(options: AdvancedSearchOptions): Promise<Memory[]> {
    let memories = await this.memoryManager.getAllMemories();

    // 应用过滤条件
    if (options.query) {
      const relevantMemories = await this.memoryManager.getRelevantMemories(
        options.query,
        100
      );
      const relevantIds = new Set(relevantMemories.map((m) => m.id));
      memories = memories.filter((m) => relevantIds.has(m.id));
    }

    if (options.tags && options.tags.length > 0) {
      memories = memories.filter(
        (memory) =>
          memory.metadata.tags &&
          options.tags!.every((tag) => memory.metadata.tags!.includes(tag))
      );
    }

    if (options.type) {
      memories = memories.filter(
        (memory) => memory.metadata.type === options.type
      );
    }

    if (options.startDate) {
      memories = memories.filter(
        (memory) => memory.createdAt >= options.startDate!
      );
    }

    if (options.endDate) {
      memories = memories.filter(
        (memory) => memory.createdAt <= options.endDate!
      );
    }

    if (options.priority) {
      memories = memories.filter(
        (memory) => memory.metadata.priority === options.priority
      );
    }

    // 应用排序
    if (options.sortBy) {
      memories.sort((a, b) => {
        let comparison = 0;

        switch (options.sortBy) {
          case 'createdAt':
            comparison = a.createdAt.getTime() - b.createdAt.getTime();
            break;
          case 'updatedAt':
            comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
            break;
          case 'relevance':
            // 相关性排序需要更复杂的算法，这里简化处理
            comparison = 0;
            break;
        }

        return options.sortOrder === 'desc' ? -comparison : comparison;
      });
    }

    // 应用限制
    if (options.limit) {
      memories = memories.slice(0, options.limit);
    }

    return memories;
  }

  /**
   * 获取所有标签
   * @returns 标签列表
   */
  async getAllTags(): Promise<string[]> {
    const allMemories = await this.memoryManager.getAllMemories();
    const tags = new Set<string>();

    for (const memory of allMemories) {
      if (memory.metadata.tags) {
        memory.metadata.tags.forEach((tag) => tags.add(tag));
      }
    }

    return Array.from(tags);
  }

  /**
   * 获取所有记忆类型
   * @returns 记忆类型列表
   */
  async getAllTypes(): Promise<string[]> {
    const allMemories = await this.memoryManager.getAllMemories();
    const types = new Set<string>();

    for (const memory of allMemories) {
      types.add(memory.metadata.type);
    }

    return Array.from(types);
  }
}
