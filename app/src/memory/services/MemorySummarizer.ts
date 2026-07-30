import type { Memory } from '../types/Memory';
import type { MemoryQueryResult } from '@modules/services/prompt/MemoryPromptProvider';
import type { SessionContext } from '../types/SessionContext';

/** MemoryManagerImpl 最小接口（避免循环依赖） */
interface MemoryManagerImpl {
  getAllMemories(): Promise<Memory[]>;
  recentSummaryCache: {
    memories: Memory[];
    summaries: string[];
    totalCount: number;
  } | null;
}

/**
 * 记忆摘要服务
 * 将 MemoryManager 的检索结果适配为 MemoryQueryProvider 的摘要格式
 */
export class MemorySummarizer {
  constructor(private memoryManager: MemoryManagerImpl) {}

  /**
   * 获取最新记忆摘要
   * @param limit 最大返回条数
   * @param sessionContext 会话上下文（可选），传入时提升同一会话内记忆的优先级
   * @param prioritizeDreamRefined 是否优先梦境精炼过的记忆（默认 true）
   */
  async getSummaries(
    limit: number = 5,
    sessionContext?: SessionContext,
    prioritizeDreamRefined: boolean = true
  ): Promise<MemoryQueryResult> {
    // 优先从缓存读取，避免全量 I/O
    if (this.memoryManager.recentSummaryCache) {
      const cache = this.memoryManager.recentSummaryCache;
      let candidates = [...cache.memories];

      // 过滤掉已弃用的记忆 (deprecatedBy 不为空)
      candidates = candidates.filter(
        (m) => !(m.metadata as unknown as Record<string, unknown>)?.deprecatedBy
      );

      // 综合排序：会话内 → 梦境精炼 → 优先级 → 更新时间
      this.sortCandidates(candidates, sessionContext, prioritizeDreamRefined);

      const summaries = candidates
        .slice(0, limit)
        .map((m) => this.toSummary(m));
      return {
        summaries,
        totalCount: cache.totalCount,
      };
    }

    // 缓存不存在时回退全量 I/O
    const allMemories = await this.memoryManager.getAllMemories();
    let candidates = allMemories.filter(
      (m) => !(m.metadata as unknown as Record<string, unknown>)?.deprecatedBy
    );

    this.sortCandidates(candidates, sessionContext, prioritizeDreamRefined);

    const topCandidates = candidates.slice(0, limit);
    const summaries = topCandidates.map((m) => this.toSummary(m));
    const result = { summaries, totalCount: allMemories.length };

    // 回写缓存供后续使用
    this.memoryManager.recentSummaryCache = {
      memories: allMemories,
      summaries,
      totalCount: allMemories.length,
    };

    return result;
  }

  /**
   * 综合排序：会话内 > 梦境精炼 > 优先级 > 更新时间
   */
  private sortCandidates(
    candidates: Memory[],
    sessionContext?: SessionContext,
    prioritizeDreamRefined: boolean = true
  ): void {
    candidates.sort((a, b) => {
      // 1. 会话内记忆优先
      if (sessionContext) {
        const aInSession = this.belongsToSession(a, sessionContext);
        const bInSession = this.belongsToSession(b, sessionContext);
        if (aInSession && !bInSession) return -1;
        if (!aInSession && bInSession) return 1;
      }

      // 2. 梦境精炼过的记忆优先
      if (prioritizeDreamRefined) {
        const aRefined =
          (a.metadata as unknown as Record<string, unknown>)?.dreamRefined ===
          true;
        const bRefined =
          (b.metadata as unknown as Record<string, unknown>)?.dreamRefined ===
          true;
        if (aRefined && !bRefined) return -1;
        if (!aRefined && bRefined) return 1;
      }

      // 3. 优先级高的在前
      const aPriority = a.metadata?.priority ?? 0;
      const bPriority = b.metadata?.priority ?? 0;
      if (aPriority !== bPriority) return bPriority - aPriority;

      // 4. 最近更新的在前
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  /**
   * 判断记忆是否属于指定会话（任务 4：优先使用 metadata.sessionId）
   * @param memory 记忆对象
   * @param sessionContext 会话上下文
   */
  private belongsToSession(
    memory: { metadata?: { sessionId?: string; tags?: string[] } },
    sessionContext: SessionContext
  ): boolean {
    // 优先使用 sessionId 字段（任务 4）
    if (memory.metadata?.sessionId) {
      return memory.metadata.sessionId === sessionContext.sessionId;
    }
    // 回退兼容：通过 tags 查找
    if (!memory.metadata?.tags) return false;
    return memory.metadata.tags.includes(sessionContext.sessionId);
  }

  /**
   * 将记忆对象转为摘要文本
   */
  private toSummary(memory: {
    content: string;
    metadata?: { name?: string };
  }): string {
    const name = memory.metadata?.name;
    const content = memory.content.trim();
    if (name) {
      return `[${name}] ${content.length > 200 ? content.slice(0, 200) + '…' : content}`;
    }
    return content.length > 200 ? content.slice(0, 200) + '…' : content;
  }
}
