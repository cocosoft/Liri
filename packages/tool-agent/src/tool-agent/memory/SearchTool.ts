import type { Memory } from '@openliri/infra/memory/types/Memory';
import { MemoryManagerImpl } from '@openliri/infra/memory/MemoryManager';
import {
  advancedSearchMemories,
  type AdvancedMemorySearchOptions,
  type MemorySearchDeps,
} from '@openliri/infra/memory';

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
 *
 * P2-2（2026-11-25）：**下沉为 infra 唯一实现的选项**（`advancedSearchMemories`），
 * 本文件不再自带过滤/排序逻辑。
 */
export type AdvancedSearchOptions = AdvancedMemorySearchOptions;

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

  /** 复用注入的 manager 作为全局记忆端口（高级检索的唯一实现消费它） */
  private deps(): MemorySearchDeps {
    return { resolveGlobalMemory: async () => this.memoryManager };
  }

  /**
   * 搜索记忆
   * @param query 搜索关键词
   * @returns 匹配的记忆列表
   */
  async search(query: string): Promise<Memory[]> {
    return advancedSearchMemories({ query, limit: 5 }, this.deps());
  }

  /**
   * 按标签搜索
   * @param tag 标签
   * @returns 匹配的记忆列表
   */
  async searchByTag(tag: string): Promise<Memory[]> {
    return advancedSearchMemories({ tags: [tag] }, this.deps());
  }

  /**
   * 按类型搜索
   * @param type 记忆类型
   * @returns 匹配的记忆列表
   */
  async searchByType(type: string): Promise<Memory[]> {
    return advancedSearchMemories({ type }, this.deps());
  }

  /**
   * 高级搜索（P2-2：委托 infra `advancedSearchMemories`，不再自带一套过滤/排序）
   * @param options 搜索选项
   * @returns 匹配的记忆列表
   */
  async advancedSearch(options: AdvancedSearchOptions): Promise<Memory[]> {
    return advancedSearchMemories(options, this.deps());
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
