import { resolveDataDir } from '@modules/core';
import type { Memory, MemoryStats } from './types/Memory';
import { createMemory } from './types/Memory';
import {
  validateMemoryId,
  validateMemoryPath,
  MemoryStoreImpl,
  MemoryStore,
} from './stores/MemoryStore';
import { MemoryScannerImpl } from './scanners/MemoryScanner';
import { MemoryRetrieverImpl } from './retrievers/MemoryRetriever';
import { MemoryType } from './types/MemoryType';
import {
  MemoryPromptService,
  MemoryPrompt,
} from './services/MemoryPromptService';
import {
  AutoMemoryService,
  AutoMemoryConfig,
} from './services/AutoMemoryService';
import {
  TeamMemoryService,
  TeamMemoryConfig,
  TeamMemorySyncStatus,
  TeamMemorySyncRecord,
} from './services/TeamMemoryService';
import {
  PYAppIntegrationService,
  PYAppConfig,
  Rule,
  Preference,
} from './services/PYAppIntegrationService';
import fsExtra from 'fs-extra';
import { join } from 'path';
import * as fs from 'fs';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { MemoryProvider } from './MemoryProvider';
import { memoryRelationGraph } from './utils/MemoryRelationGraph';
import { MemoryConsolidator } from './consolidation/MemoryConsolidator';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { createHash } from 'crypto';

// P2-6: LLM 精选记忆检索
import {
  buildSelectionPrompt,
  parseSelectionResult,
  applySelection,
  type MemoryItem,
} from './MemoryLLMSelector';

const logger = new Logger({
  module: 'memory:memoryManager',
  level: LogLevel.INFO,
});

/**
 * 记忆管理器接口
 */
export interface MemoryManager {
  // 创建记忆
  createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  // 获取记忆
  getMemory(id: string): Promise<Memory | null>;

  // 更新记忆
  updateMemory(id: string, updates: Partial<Memory>): Promise<Memory>;

  // 删除记忆
  deleteMemory(id: string): Promise<void>;

  // 检索相关记忆
  getRelevantMemories(query: string, limit?: number): Promise<Memory[]>;

  // 获取所有记忆
  getAllMemories(): Promise<Memory[]>;

  // 获取记忆统计信息
  getMemoryStats(): Promise<MemoryStats>;

  // 自动创建记忆（从聊天）
  createMemoryFromChat(
    messages: any[],
    name?: string,
    type?: string
  ): Promise<Memory>;

  // 团队记忆管理
  getTeamMemories(teamId: string): Promise<Memory[]>;
  createTeamMemory(
    teamId: string,
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;

  // 记忆老化管理
  cleanupExpiredMemories(): Promise<number>;
  setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory>;

  // 语义搜索
  searchMemoriesBySemantic(query: string, limit?: number): Promise<Memory[]>;
  searchMemoriesByTags(tags: string[], limit?: number): Promise<Memory[]>;

  // 记忆提示系统
  generateMemoryPrompts(context?: {
    userActions?: string[];
    recentMemories?: Memory[];
    currentTask?: string;
    query?: string;
  }): Promise<MemoryPrompt[]>;
  getMemoryUsageStats(): Promise<{
    totalMemories: number;
    memoryTypes: Record<MemoryType, number>;
    recentMemories: number;
    averageMemorySize: number;
  }>;

  // 自动记忆功能
  processConversation(
    conversationId: string,
    messages: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>
  ): Promise<Memory[]>;
  setAutoMemoryConfig(config: Partial<AutoMemoryConfig>): void;
  getAutoMemoryConfig(): AutoMemoryConfig;
  clearConversationMemory(conversationId: string): void;
  clearAllConversationMemories(): void;

  // 团队记忆功能
  createTeamMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory>;
  getTeamMemories(): Promise<Memory[]>;
  updateTeamMemory(id: string, updates: Partial<Memory>): Promise<Memory>;
  deleteTeamMemory(id: string): Promise<void>;
  setTeamMemoryConfig(config: Partial<TeamMemoryConfig>): void;
  getTeamMemoryConfig(): TeamMemoryConfig;
  getTeamMemorySyncStatus(): TeamMemorySyncStatus;
  getTeamMemoryLastSyncTime(): Date | null;
  getTeamMemorySyncRecords(limit?: number): TeamMemorySyncRecord[];
  triggerTeamMemorySync(): Promise<TeamMemorySyncRecord>;

  // 外部提供者管理
  addProvider(provider: MemoryProvider): Promise<void>;
  getProvider(): MemoryProvider | null;
  removeProvider(): void;

  // Liri.md集成功能
  initializePYAppIntegration(): Promise<void>;
  getPYAppConfig(): PYAppConfig | null;
  getPYAppRules(): Rule[];
  getPYAppRulesByCategory(category: string): Rule[];
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[];
  getPYAppPreferences(): Preference[];
  getPYAppPreference(key: string): Preference | undefined;
  getPYAppPreferenceValue(key: string, defaultValue?: any): any;
  getPYAppRulesText(): string;
  checkPYAppChanges(): Promise<boolean>;
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void;
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void;
}

/**
 * 记忆管理器实现
 */
export class MemoryManagerImpl {
  /**
   * 记忆存储
   */
  private store: MemoryStoreImpl;

  private storeDir: string;

  /**
   * 记忆扫描器
   */
  private scanner: MemoryScannerImpl;

  /**
   * 记忆检索器
   */
  private retriever: MemoryRetrieverImpl;

  /**
   * 最近摘要缓存
   * 同时缓存 Memory[] 对象，支持有 sessionContext 时从缓存重排序而非走全量 I/O
   * 被 createMemory / updateMemory / deleteMemory 写入时失效，随后触发异步预热
   */
  recentSummaryCache: {
    memories: Memory[];
    summaries: string[];
    totalCount: number;
  } | null = null;

  /**
   * 缓存异步预热 Promise，防重复
   */
  private cacheWarmupPromise: Promise<void> | null = null;

  /**
   * 清理/写入并发锁，防止 cleanupExpiredMemories 与 saveMemory 同时执行
   */
  private isCleaning = false;

  /** v1.2: 最近一次 cleanupExpiredMemories 完成时间戳（供 stats 端点使用） */
  private lastCleanupAt: number | null = null;

  /**
   * 记忆去重合并器，在 createMemory 时自动检测内容重复
   */
  private consolidator = new MemoryConsolidator({ similarityThreshold: 0.85 });

  /**
   * 记忆提示服务
   */
  private promptService: MemoryPromptService;

  /**
   * 自动记忆服务
   */
  private autoMemoryService: AutoMemoryService;

  /**
   * 团队记忆服务
   */
  private teamMemoryService: TeamMemoryService;

  /**
   * Liri.md集成服务
   */
  private pyAppIntegrationService: PYAppIntegrationService;

  /**
   * 关联图文件路径
   */
  private relationGraphPath: string;

  /**
   * 外部记忆提供者（最多 1 个）
   */
  private provider: MemoryProvider | null = null;

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = join(resolveDataDir(), 'memory')) {
    this.storeDir = memoryDir;
    this.relationGraphPath = join(memoryDir, 'memory-relation-graph.json');
    this.store = new MemoryStoreImpl(memoryDir);
    this.scanner = new MemoryScannerImpl();
    this.retriever = new MemoryRetrieverImpl(memoryDir);
    this.promptService = new MemoryPromptService(this as any);
    this.autoMemoryService = new AutoMemoryService(this as any);
    this.teamMemoryService = new TeamMemoryService(this as any);
    this.pyAppIntegrationService = new PYAppIntegrationService();

    // 加载关联图
    // @ignore-catch — 关联图异步加载，非关键路径，失败不阻塞初始化
    this.loadRelationGraph().catch(() => {});

    // 预热摘要缓存，避免首次 getSummaries 冷启动走全量 I/O
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});
  }

  /**
   * 异步刷新摘要缓存（异步预热）
   * 让下次 getSummaries 读取时直接命中缓存，避免同步全量 I/O
   */
  private async refreshSummaryCache(): Promise<void> {
    // 如果已有预热进行中，避免重复
    if (this.cacheWarmupPromise) {
      return;
    }

    this.cacheWarmupPromise = (async () => {
      try {
        const allMemories = await this.getAllMemories();
        allMemories.sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
        );

        const summaries = allMemories.map((m) => {
          const name = m.metadata?.name;
          const content = (m.content || '').trim();
          const truncated =
            content.length > 200 ? content.slice(0, 200) + '…' : content;
          const prefix = name ? `[${name}] ` : '';
          return `${prefix}${truncated}`;
        });

        this.recentSummaryCache = {
          memories: allMemories,
          summaries,
          totalCount: allMemories.length,
        };
      } catch (err) {
        // 预热失败不阻塞主流程，下次读取时自动回退全量扫描
        this.recentSummaryCache = null;
      } finally {
        this.cacheWarmupPromise = null;
      }
    })();

    await this.cacheWarmupPromise;
  }

  /**
   * 创建记忆
   * @param memory 记忆数据
   * @returns 创建的记忆
   */
  async createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Memory> {
    // 如果清理任务正在执行，等待完成
    while (this.isCleaning) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 创建记忆对象
    const newMemory = createMemory(memory);

    // 保存到存储
    await this.store.saveMemory(newMemory);

    // 增量更新检索器索引
    this.retriever.updateIndex(newMemory);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    // 去重检测：先用 contentHash 在缓存中做 O(1) 精确去重，避免全量 I/O
    try {
      const contentHash = createHash('sha256')
        .update(newMemory.content)
        .digest('hex');
      let exactDuplicateFound = false;

      // 先用最近摘要缓存做 O(1)/O(n) 快速检查
      if (this.recentSummaryCache?.memories) {
        for (const existing of this.recentSummaryCache.memories) {
          if (existing.id === newMemory.id) continue;
          const existingHash = createHash('sha256')
            .update(existing.content)
            .digest('hex');
          if (existingHash === contentHash) {
            exactDuplicateFound = true;
            logger.info(
              `contentHash 精确去重：发现与 ${existing.id} 完全相同的记忆，跳过全量去重`,
              {
                newMemoryId: newMemory.id,
                existingMemoryId: existing.id,
              }
            );
            // 删除刚创建的新记忆（保留已有记忆）
            await this.store.deleteMemory(newMemory.id);
            this.retriever.removeFromIndex(newMemory.id);
            await this.retriever.saveIndex();
            return existing;
          }
        }
      }

      // 如果缓存中未命中，执行全量去重
      if (!exactDuplicateFound) {
        const allMemories = await this.getAllMemories();
        const dupCheck = this.consolidator.findDuplicates(
          allMemories.map((m) => ({
            id: m.id,
            content: m.content,
            createdAt: m.createdAt.getTime(),
          }))
        );
        if (dupCheck.totalRemoved > 0) {
          logger.info(`去重检测：发现 ${dupCheck.totalRemoved} 条重复记忆`, {
            newMemoryId: newMemory.id,
          });
          // 删除重复记忆（保留每组第一条）
          for (const group of dupCheck.duplicates) {
            // group[0] 是保留的，group[1..] 是待删除的
            for (let i = 1; i < group.length; i++) {
              await this.store.deleteMemory(group[i]);
              this.retriever.removeFromIndex(group[i]);
            }
          }
          await this.retriever.saveIndex();
        }
      }
    } catch (err) {
      // 去重失败不阻塞主流程
    }

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});

    return newMemory;
  }

  /**
   * 处理对话并提取记忆（接口方法，匹配 MemoryManager.processConversation 签名）
   * 内部委托 AutoMemoryService 进行 LLM 提取和去重
   */
  async processConversation(
    conversationId: string,
    messages: Array<{ role: string; content: string; timestamp: Date }>
  ): Promise<Memory[]> {
    return this.autoMemoryService.processConversation(conversationId, messages);
  }

  /**
   * Phase 0: 委派对话处理（向后兼容旧系统 BuiltinMemoryTool）
   * @deprecated 请使用 processConversation() 替代
   */
  async delegateProcessConversation(
    conversationId: string,
    messages: Array<{ role: string; content: string; timestamp: Date }>
  ): Promise<Memory[]> {
    return this.processConversation(conversationId, messages);
  }

  /**
   * v1.2: 获取即将过期的记忆列表（age > 80% TTL）
   * 供 HTTP handler stats 端点使用
   */
  async getExpiringMemories(): Promise<Memory[]> {
    const allMemories = await this.getAllMemories();
    const now = Date.now();
    return allMemories.filter((m) => {
      const ageMs = now - m.createdAt.getTime();
      const ttlMs = this.getMemoryTTL(m);
      return ageMs > ttlMs * 0.8;
    });
  }

  /**
   * v1.2: 获取最近一次清理时间戳（供 stats 端点使用）
   */
  getLastCleanupAt(): number | null {
    return this.lastCleanupAt;
  }

  /**
   * 获取记忆
   * @param id 记忆ID
   * @returns 记忆对象或null
   */
  async getMemory(id: string): Promise<Memory | null> {
    validateMemoryId(id);
    return this.store.readMemory(id);
  }

  /**
   * 更新记忆
   * @param id 记忆ID
   * @param updates 更新数据
   * @returns 更新后的记忆
   */
  async updateMemory(id: string, updates: Partial<Memory>): Promise<Memory> {
    validateMemoryId(id);

    // 获取现有记忆
    const existingMemory = await this.store.readMemory(id);
    if (!existingMemory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 合并更新
    const updatedMemory: Memory = {
      ...existingMemory,
      ...updates,
      metadata: {
        ...existingMemory.metadata,
        ...(updates.metadata || {}),
      },
      updatedAt: new Date(),
    };

    // 保存到存储
    await this.store.saveMemory(updatedMemory);

    // 增量更新检索器索引
    this.retriever.updateIndex(updatedMemory);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});

    return updatedMemory;
  }

  /**
   * 删除记忆
   * @param id 记忆ID
   */
  async deleteMemory(id: string): Promise<void> {
    validateMemoryId(id);
    await this.store.deleteMemory(id);

    // 从检索器索引中移除
    this.retriever.removeFromIndex(id);
    await this.retriever.saveIndex();

    // 持久化关联图
    await this.saveRelationGraph();

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});
  }

  /**
   * 删除所有记忆
   * @returns 删除的记忆数量
   */
  async deleteAllMemories(): Promise<number> {
    const allMemories = await this.getAllMemories();
    const count = allMemories.length;

    for (const memory of allMemories) {
      await this.store.deleteMemory(memory.id);
      this.retriever.removeFromIndex(memory.id);
    }

    if (count > 0) {
      await this.retriever.saveIndex();
      await this.saveRelationGraph();
    }

    // 摘要缓存失效并异步预热
    this.recentSummaryCache = null;
    // @ignore-catch — 摘要缓存异步预热，非关键路径，失败不影响主流程
    this.refreshSummaryCache().catch(() => {});

    return count;
  }

  /**
   * 检索相关记忆
   * 使用混合搜索（关键词+语义），优先利用 EmbeddingService 提升检索准确度，
   * 同时利用关联图扩展关联记忆（联想记忆），
   * 最后通过 LLM 精选（P2-6）从候选中选出最相关条目。
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @returns 相关记忆列表
   */
  async getRelevantMemories(
    query: string,
    limit: number = 5
  ): Promise<Memory[]> {
    // 获取更多候选（3x limit），给 LLM 精选留空间
    const candidateLimit = limit * 3;
    const results = await this.retriever.hybridSearch(query, candidateLimit);

    // 通过关联图扩展关联记忆
    const resultIds = new Set(results.map((m) => m.id));
    const relatedIds = new Set<string>();

    for (const memory of results) {
      const relations = memoryRelationGraph.getDirectRelations(memory.id);
      for (const relation of relations) {
        if (
          !resultIds.has(relation.targetId) &&
          !relatedIds.has(relation.targetId)
        ) {
          relatedIds.add(relation.targetId);
        }
      }
    }

    const combined: Memory[] = [...results];

    if (relatedIds.size > 0) {
      for (const id of relatedIds) {
        const memory = await this.store.readMemory(id);
        if (memory) combined.push(memory);
      }
    }

    // P2-6: 候选超过 limit 时，用 LLM 精选最相关的记忆
    if (combined.length > limit) {
      try {
        const { providerRegistry } = await import('@modules/ai');
        const provider = providerRegistry.getDefaultProvider();

        if (provider) {
          const items: MemoryItem[] = combined.map((m) => ({
            id: m.id,
            type: (m.metadata?.type as string) ?? 'unknown',
            content: m.content,
            createdAt: m.createdAt.getTime(),
          }));

          const prompt = buildSelectionPrompt(query, items);
          const response = await provider.chat(
            [
              {
                role: 'system',
                content:
                  'You are a memory selector. Return ONLY a JSON array of memory IDs.',
              },
              { role: 'user', content: prompt },
            ],
            {
              model: undefined,
              temperature: 0.3,
              maxTokens: 512,
            }
          );

          const selectedIds = parseSelectionResult(response.content);
          if (selectedIds.length > 0) {
            const selected = applySelection(items, selectedIds);
            const selectedIdSet = new Set(selected.map((s) => s.id));
            const refined = combined.filter((m) => selectedIdSet.has(m.id));
            logger.info('LLM 精选记忆完成', {
              candidates: combined.length,
              selected: refined.length,
            });
            return refined.slice(0, limit);
          }
        }
      } catch (err) {
        await handleError(err, {
          module: 'memory:memoryManager',
          action: 'llmSelectMemories',
        });
        logger.warn('LLM 精选记忆失败，降级为 top-K', {
          error: String(err),
        });
      }
    }

    return combined.slice(0, limit);
  }

  /**
   * 获取所有记忆
   * @returns 记忆列表
   */
  async getAllMemories(): Promise<Memory[]> {
    // 刷新待写入批次，确保磁盘与运行时一致
    await this.store.flushBatch();

    // 获取所有记忆ID
    const memoryIds = await this.store.listMemories();

    // 读取每个记忆
    const memories: Memory[] = [];
    for (const id of memoryIds) {
      const memory = await this.store.readMemory(id);
      if (memory) {
        memories.push(memory);
      }
    }

    return memories;
  }

  /**
   * 获取记忆统计信息
   * @returns 记忆统计信息
   */
  async getMemoryStats(): Promise<MemoryStats> {
    const memories = await this.getAllMemories();

    // 按类型统计
    const byType: Record<MemoryType, number> = {
      [MemoryType.USER_FACT]: 0,
      [MemoryType.USER_PREFERENCE]: 0,
      [MemoryType.PROJECT_KNOWLEDGE]: 0,
      [MemoryType.CODE_PATTERN]: 0,
      [MemoryType.DECISION]: 0,
      [MemoryType.FEEDBACK]: 0,
      [MemoryType.REFERENCE]: 0,
    };

    let totalSize = 0;
    const now = new Date();
    let recent = 0;

    for (const memory of memories) {
      // 按类型统计
      if (byType[memory.metadata.type as MemoryType] !== undefined) {
        byType[memory.metadata.type as MemoryType]++;
      }

      // 计算总大小
      totalSize += Buffer.byteLength(memory.content, 'utf8');

      // 统计最近创建的记忆（7天内）
      const daysSinceCreation =
        (now.getTime() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation <= 7) {
        recent++;
      }
    }

    return {
      total: memories.length,
      byType,
      recent,
      totalSize,
    };
  }

  /**
   * 注册外部记忆提供者
   * 最多允许 1 个外部提供者，重复注册会覆盖
   * @param provider 记忆提供者实例
   */
  async addProvider(provider: MemoryProvider): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
    }

    await provider.initialize();
    this.provider = provider;
  }

  /**
   * 获取当前外部记忆提供者
   * @returns 记忆提供者或 null
   */
  getProvider(): MemoryProvider | null {
    return this.provider;
  }

  /**
   * 移除当前外部记忆提供者
   */
  removeProvider(): void {
    if (this.provider) {
      // @ignore-catch — 外部提供者关闭best-effort，失败不影响内存释放
      this.provider.shutdown().catch(() => {});
      this.provider = null;
    }
  }

  /**
   * 清理已过期的记忆
   * 遍历所有记忆，删除 metadata.expiresAt 已到期的记忆
   * TTL 按重要度差异化：高重要度（>=0.7）TTL×2，低重要度（<0.3）TTL×0.5
   * @returns 被清理的记忆数量
   */
  async cleanupExpiredMemories(): Promise<number> {
    // 防并发：已有清理任务正在执行则跳过
    if (this.isCleaning) return 0;
    this.isCleaning = true;

    try {
      const allMemories = await this.getAllMemories();
      const now = new Date();
      const expired: string[] = [];

      for (const memory of allMemories) {
        const ttlMs = this.getMemoryTTL(memory);
        const ageMs = now.getTime() - memory.createdAt.getTime();

        // 优先检查显式 expiresAt，其次根据 TTL 判断是否过期
        const isExpired =
          (memory.metadata.expiresAt &&
            new Date(memory.metadata.expiresAt) <= now) ||
          (!memory.metadata.expiresAt && ageMs > ttlMs);

        if (isExpired) {
          expired.push(memory.id);
        }
      }

      for (const id of expired) {
        await this.store.deleteMemory(id);
        this.retriever.removeFromIndex(id);
      }

      if (expired.length > 0) {
        await this.retriever.saveIndex();
        await this.saveRelationGraph();
      }

      logger.info(`清理了 ${expired.length} 条过期记忆`, {
        totalMemories: allMemories.length,
        cleanedCount: expired.length,
      });

      return expired.length;
    } finally {
      this.isCleaning = false;
      this.lastCleanupAt = Date.now();
    }
  }

  /**
   * 根据记忆重要度计算 TTL（毫秒）
   * 高重要度（importance >= 0.7）：180 天
   * 中重要度（0.3 <= importance < 0.7）：90 天（默认）
   * 低重要度（importance < 0.3）：45 天
   */
  private getMemoryTTL(memory: Memory): number {
    const baseTTL = 90 * 24 * 60 * 60 * 1000; // 90 天
    const importance = memory.metadata.importance ?? 0.5;
    if (importance >= 0.7) return baseTTL * 2;
    if (importance < 0.3) return baseTTL * 0.5;
    return baseTTL;
  }

  /**
   * 设置记忆过期时间
   * @param id 记忆ID
   * @param expiresAt 过期时间
   * @returns 更新后的记忆
   */
  async setMemoryExpiry(id: string, expiresAt: Date): Promise<Memory> {
    validateMemoryId(id);
    const memory = await this.store.readMemory(id);
    if (!memory) {
      throw new AppError(
        `Memory with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    memory.metadata.expiresAt = expiresAt;
    memory.updatedAt = new Date();

    await this.store.saveMemory(memory);
    this.retriever.updateIndex(memory);
    await this.retriever.saveIndex();
    await this.saveRelationGraph();

    return memory;
  }

  /**
   * 扫描记忆目录
   */
  async scanMemoryDirectory(): Promise<void> {
    await this.retriever.scanMemoryDirectory();
  }

  /**
   * 构建记忆索引
   */
  async buildMemoryIndex(): Promise<void> {
    await this.retriever.buildMemoryIndex();
    await this.retriever.saveIndex();
  }

  /**
   * 获取记忆存储
   * @returns 记忆存储
   */
  getStore(): MemoryStore {
    return this.store;
  }

  /**
   * 导出记忆为Markdown文件
   * @param id 记忆ID
   * @param exportDir 导出目录
   * @returns 导出文件路径
   */
  async exportMemoryAsMarkdown(
    id: string,
    exportDir: string = './exports'
  ): Promise<string> {
    validateMemoryId(id);
    validateMemoryPath(exportDir, 'exportDir');
    return this.store.exportMemoryAsMarkdown(id, exportDir);
  }

  /**
   * 导入Markdown文件为记忆
   * @param filePath Markdown文件路径
   * @returns 创建的记忆ID
   */
  async importMemoryFromMarkdown(filePath: string): Promise<string> {
    validateMemoryPath(filePath, 'filePath');
    const id = await this.store.importMemoryFromMarkdown(filePath);

    // 重新构建索引
    await this.buildMemoryIndex();

    return id;
  }

  /**
   * 获取记忆的Markdown预览
   * @param id 记忆ID
   * @returns Markdown预览内容
   */
  async getMemoryMarkdownPreview(id: string): Promise<string> {
    return this.store.getMemoryMarkdownPreview(id);
  }

  /**
   * 获取记忆扫描器
   * @returns 记忆扫描器
   */
  getScanner(): MemoryScannerImpl {
    return this.scanner;
  }

  /**
   * 获取记忆检索器
   * @returns 记忆检索器
   */
  getRetriever(): MemoryRetrieverImpl {
    return this.retriever;
  }

  /**
   * 备份记忆数据
   * @param backupDir 备份目录
   */
  async backupMemoryData(backupDir: string = './backups'): Promise<void> {
    await fsExtra.ensureDir(backupDir);

    // 复制记忆目录到备份目录
    const backupPath = join(
      backupDir,
      `memory_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`
    );

    try {
      // 检查源目录是否存在
      const sourceExists = await fsExtra.pathExists(this.storeDir);
      if (!sourceExists) {
        throw new AppError(
          `Source memory directory ${this.storeDir} does not exist`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      await fsExtra.copy(this.storeDir, backupPath);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        `Failed to backup memory data from ${this.storeDir} to ${backupPath}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 恢复记忆数据
   * @param backupDir 备份目录
   */
  async restoreMemoryData(backupDir: string): Promise<void> {
    // 检查备份目录是否存在
    if (!(await fsExtra.pathExists(backupDir))) {
      throw new AppError(
        `Backup directory ${backupDir} does not exist`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 清空当前记忆目录
    await fsExtra.emptyDir(this.storeDir);

    // 复制备份数据到当前记忆目录
    const files = await fsExtra.readdir(backupDir);
    for (const file of files) {
      const srcPath = join(backupDir, file);
      const destPath = join(this.storeDir, file);
      await fsExtra.copy(srcPath, destPath);
    }

    // 重新构建索引
    await this.buildMemoryIndex();
  }

  /**
   * 加载关联图
   */
  async loadRelationGraph(): Promise<void> {
    try {
      await fs.promises.access(this.relationGraphPath);
      const content = await fs.promises.readFile(
        this.relationGraphPath,
        'utf8'
      );
      const relations = JSON.parse(content);
      memoryRelationGraph.deserialize(relations);
    } catch (err) {
      // 文件不存在或解析失败时使用空关联图
    }
  }

  /**
   * 保存关联图
   */
  async saveRelationGraph(): Promise<void> {
    try {
      const relations = memoryRelationGraph.serialize();
      // 原子写入：先写 .tmp 文件，再 rename 为最终路径
      const tmpPath = this.relationGraphPath + '.tmp';
      await fs.promises.writeFile(
        tmpPath,
        JSON.stringify(relations, null, 2),
        'utf8'
      );
      await fs.promises.rename(tmpPath, this.relationGraphPath);
    } catch (error) {
      await handleError(error, {
        module: 'memory:manager',
        action: 'save_relation_graph',
      });
    }
  }

  /**
   * 初始化Liri.md集成
   */
  async initializePYAppIntegration(): Promise<void> {
    await this.pyAppIntegrationService.initialize();
  }

  /**
   * 获取Liri配置
   */
  getPYAppConfig(): PYAppConfig | null {
    return this.pyAppIntegrationService.getConfig();
  }

  /**
   * 获取所有Liri规则
   */
  getPYAppRules(): Rule[] {
    return this.pyAppIntegrationService.getRules();
  }

  /**
   * 获取指定类别的Liri规则
   */
  getPYAppRulesByCategory(category: string): Rule[] {
    return this.pyAppIntegrationService.getRulesByCategory(category);
  }

  /**
   * 获取指定优先级的Liri规则
   */
  getPYAppRulesByPriority(priority: 'high' | 'medium' | 'low'): Rule[] {
    return this.pyAppIntegrationService.getRulesByPriority(priority);
  }

  /**
   * 获取所有Liri偏好设置
   */
  getPYAppPreferences(): Preference[] {
    return this.pyAppIntegrationService.getPreferences();
  }

  /**
   * 获取指定键的Liri偏好设置
   */
  getPYAppPreference(key: string): Preference | undefined {
    return this.pyAppIntegrationService.getPreference(key);
  }

  /**
   * 获取Liri偏好设置值
   */
  getPYAppPreferenceValue(key: string, defaultValue?: any): any {
    return this.pyAppIntegrationService.getPreferenceValue(key, defaultValue);
  }

  /**
   * 获取Liri规则文本（用于AI模块）
   */
  getPYAppRulesText(): string {
    return this.pyAppIntegrationService.getRulesText();
  }

  /**
   * 检查Liri是否有变化
   */
  async checkPYAppChanges(): Promise<boolean> {
    return this.pyAppIntegrationService.checkForChanges();
  }

  /**
   * 添加Liri变化监听器
   */
  addPYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.addChangeListener(listener);
  }

  /**
   * 移除Liri变化监听器
   */
  removePYAppChangeListener(listener: (config: PYAppConfig) => void): void {
    this.pyAppIntegrationService.removeChangeListener(listener);
  }
}
