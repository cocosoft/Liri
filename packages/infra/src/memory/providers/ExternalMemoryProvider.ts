/**
 * 外部记忆提供商接口
 * 对标 Hermes MemoryProvider ABC（外部插件化）
 * 允许外部系统注册为记忆源
 */

/**
 * 记忆条目
 */
export interface ExternalMemoryEntry {
  id: string;
  content: string;
  tags: string[];
  priority: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

/**
 * 记忆查询条件
 */
export interface MemoryQuery {
  keywords?: string[];
  tags?: string[];
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

/**
 * 外部记忆提供商接口
 * 实现此接口可将外部记忆源接入 Liri 记忆系统
 */
export interface ExternalMemoryProvider {
  /** 提供商标识 */
  readonly id: string;

  /** 提供商名称 */
  readonly displayName: string;

  /**
   * 初始化提供商
   */
  initialize(): Promise<void>;

  /**
   * 获取所有记忆
   * @param query 查询条件
   * @returns 记忆条目列表
   */
  fetchAllMemories(query?: MemoryQuery): Promise<ExternalMemoryEntry[]>;

  /**
   * 根据 ID 获取记忆
   * @param id 记忆 ID
   * @returns 记忆条目
   */
  fetchMemoryById(id: string): Promise<ExternalMemoryEntry | null>;

  /**
   * 同步记忆到外部系统
   * @param entries 记忆条目列表
   */
  syncMemories(entries: ExternalMemoryEntry[]): Promise<void>;

  /**
   * 健康检查
   * @returns 是否健康
   */
  healthCheck(): Promise<boolean>;

  /**
   * 关闭提供商
   */
  shutdown(): Promise<void>;
}

/**
 * 外部记忆提供商注册表
 */
export class ExternalMemoryProviderRegistry {
  private providers: Map<string, ExternalMemoryProvider> = new Map();

  /**
   * 注册提供商
   * @param provider 提供商实例
   */
  register(provider: ExternalMemoryProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * 注销提供商
   * @param providerId 提供商 ID
   */
  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  /**
   * 获取提供商
   * @param providerId 提供商 ID
   * @returns 提供商实例
   */
  get(providerId: string): ExternalMemoryProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * 获取所有提供商
   * @returns 提供商列表
   */
  getAll(): ExternalMemoryProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 从所有提供商获取记忆
   * @param query 查询条件
   * @returns 聚合记忆列表
   */
  async fetchAllFromAllProviders(
    query?: MemoryQuery
  ): Promise<ExternalMemoryEntry[]> {
    const results: ExternalMemoryEntry[] = [];

    for (const provider of this.providers.values()) {
      const entries = await provider.fetchAllMemories(query);
      results.push(...entries);
    }

    results.sort((a, b) => b.priority - a.priority);

    return results;
  }
}

/**
 * 全局外部记忆提供商注册表
 */
const globalRegistry = new ExternalMemoryProviderRegistry();

/**
 * 获取全局外部记忆提供商注册表
 * @returns ExternalMemoryProviderRegistry 实例
 */
export function getExternalMemoryProviderRegistry(): ExternalMemoryProviderRegistry {
  return globalRegistry;
}
