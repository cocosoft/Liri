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
    // 获取所有记忆并按更新时间降序排列（本地 I/O，不走 embedding 网络调用）
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

    return { summaries, totalCount: allMemories.length };
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
