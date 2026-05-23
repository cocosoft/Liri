import { MemoryManagerImpl } from '../MemoryManager';
import type { MemoryQueryResult } from '@modules/services/prompt/MemoryPromptProvider';
import type { SessionContext } from '../types/SessionContext';

/**
 * 记忆摘要服务
 * 将 MemoryManager 的检索结果适配为 MemoryQueryProvider 的摘要格式
 */
export class MemorySummarizer {
  /**
   * 会话内记忆提升系数
   * 同一会话内的记忆在排序时获得此倍率的加权
   */
  private static readonly SESSION_BOOST_FACTOR = 0.5;

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
    const memories = await this.memoryManager.getRelevantMemories(
      '',
      limit * 2
    );

    const scored = memories.map((m) => {
      let score = 0;
      if (sessionContext && this.belongsToSession(m, sessionContext)) {
        score += MemorySummarizer.SESSION_BOOST_FACTOR;
      }
      return { memory: m, score };
    });

    scored.sort(
      (a, b) => b.score - a.score || this.compareByRecency(a.memory, b.memory)
    );

    const top = scored.slice(0, limit);
    const summaries = top.map(({ memory }) => this.toSummary(memory));

    return { summaries, totalCount: memories.length };
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
   * 按更新时间降序比较
   */
  private compareByRecency(
    a: { updatedAt: Date },
    b: { updatedAt: Date }
  ): number {
    return b.updatedAt.getTime() - a.updatedAt.getTime();
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
