import { MemoryManagerImpl } from '../MemoryManager';
import type { MemoryQueryResult } from '@modules/services/prompt/MemoryPromptProvider';
import type { SessionContext } from '../types/SessionContext';

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
   */
  async getSummaries(
    limit: number = 5,
    sessionContext?: SessionContext
  ): Promise<MemoryQueryResult> {
    // 优先从缓存读取，避免全量 I/O
    // 无论是否有 sessionContext 都使用缓存的 Memory[] 对象做重排序
    if (this.memoryManager.recentSummaryCache) {
      const cache = this.memoryManager.recentSummaryCache;
      // 拷贝一份避免 sort 变异原数组
      let candidates = [...cache.memories];
      candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      // 如果提供了会话上下文，将会话内记忆移到前面
      if (sessionContext) {
        candidates.sort((a, b) => {
          const aInSession = this.belongsToSession(a, sessionContext);
          const bInSession = this.belongsToSession(b, sessionContext);
          if (aInSession && !bInSession) return -1;
          if (!aInSession && bInSession) return 1;
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        });
      }

      const summaries = candidates.slice(0, limit).map((m) => this.toSummary(m));
      return {
        summaries,
        totalCount: cache.totalCount,
      };
    }

    // 缓存不存在时回退全量 I/O
    const allMemories = await this.memoryManager.getAllMemories();
    allMemories.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // 取最近 limit 条
    let candidates = allMemories.slice(0, limit);

    // 如果提供了会话上下文，将会话内记忆移到前面
    if (sessionContext) {
      candidates.sort((a, b) => {
        const aInSession = this.belongsToSession(a, sessionContext);
        const bInSession = this.belongsToSession(b, sessionContext);
        if (aInSession && !bInSession) return -1;
        if (!aInSession && bInSession) return 1;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
    }

    const summaries = candidates.map((m) => this.toSummary(m));
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
   * 判断记忆是否属于指定会话
   */
  private belongsToSession(
    memory: { metadata?: { tags?: string[] } },
    sessionContext: SessionContext
  ): boolean {
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
