import type {
  KnowledgeRoute,
  IKnowledgeSearch,
} from '../../docs/knowledge-types';
import type { Memory } from '../types/Memory';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('memory:services:unifiedSearch');

export interface MemorySearchProvider {
  getRelevantMemories(query: string, limit?: number): Promise<Memory[]>;
}

export interface UnifiedSearchResult {
  type: 'knowledge' | 'memory';
  score: number;
  title: string;
  content: string;
  snippet: string;
  source: string;
  docPath?: string;
  memoryId?: string;
  metadata?: Record<string, unknown>;
}

export class UnifiedSearchService {
  private knowledgeRouter: IKnowledgeSearch;
  private memoryProvider: MemorySearchProvider;
  private readonly RRF_K = 60;

  constructor(
    knowledgeRouter: IKnowledgeSearch,
    memoryProvider: MemorySearchProvider
  ) {
    this.knowledgeRouter = knowledgeRouter;
    this.memoryProvider = memoryProvider;
  }

  async search(
    query: string,
    options?: {
      limit?: number;
      includeKnowledge?: boolean;
      includeMemory?: boolean;
    }
  ): Promise<UnifiedSearchResult[]> {
    const limit = options?.limit ?? 10;
    const includeKnowledge = options?.includeKnowledge ?? true;
    const includeMemory = options?.includeMemory ?? true;

    const searches: Promise<UnifiedSearchResult[]>[] = [];

    if (includeKnowledge) {
      searches.push(this.searchKnowledge(query, limit));
    }

    if (includeMemory) {
      searches.push(this.searchMemory(query, limit));
    }

    if (searches.length === 0) {
      return [];
    }

    const results = await Promise.all(searches);

    // 使用 RRF（Reciprocal Rank Fusion）对不同来源的结果集进行排序融合
    // RRF 公式：score(d) = sum(1 / (k + rank_i(d))) 对每个结果集 i
    const rrfScores = new Map<string, UnifiedSearchResult>();

    for (const resultSet of results) {
      for (let rank = 0; rank < resultSet.length; rank++) {
        const item = resultSet[rank];
        const key = `${item.type}:${item.source}`;
        const existing = rrfScores.get(key);
        if (existing) {
          existing.score += 1 / (this.RRF_K + rank + 1);
        } else {
          rrfScores.set(key, {
            ...item,
            score: 1 / (this.RRF_K + rank + 1),
          });
        }
      }
    }

    const merged = Array.from(rrfScores.values());

    merged.sort((a, b) => b.score - a.score);

    return merged.slice(0, limit);
  }

  private async searchKnowledge(
    query: string,
    limit: number
  ): Promise<UnifiedSearchResult[]> {
    try {
      const results = await this.knowledgeRouter.search(query, {
        maxResults: limit,
        minScore: 0.05,
      });

      return results.map((route: KnowledgeRoute) => ({
        type: 'knowledge' as const,
        score: route.score,
        title: route.title,
        content: route.snippet,
        snippet: route.snippet,
        source: `docs/${route.docPath}`,
        docPath: route.docPath,
        metadata: {
          category: route.category,
          matchType: route.matchType,
          isKnowledgeDoc: route.isKnowledgeDoc,
        },
      }));
    } catch (err) {
      // KB-UNIFIED-SEARCH-LOG（2026-08-29）：检索失败静默返回 [] → 用户无法区分
      // "确实没找到"与"检索服务挂了"，结果被静默降级为空
      logger.warn('统一搜索（知识库）失败，返回空结果', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Phase 4: 计算实际相关性得分（替代硬编码 0.5/0.3）
   */
  private computeRelevanceScore(memory: Memory, query: string): number {
    let score = 0;

    // 1) 关键词匹配（权重 0.5）：query tokens 在 content 中的命中率
    if (query && memory.content) {
      const queryTokens = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1);
      const contentLower = memory.content.toLowerCase();
      if (queryTokens.length > 0) {
        let hits = 0;
        for (const token of queryTokens) {
          if (contentLower.includes(token)) hits++;
        }
        score += 0.5 * (hits / queryTokens.length);
      }
    }

    // 2) 优先级（权重 0.3）：priority 0-10 归一化
    const priority = memory.metadata?.priority ?? 5;
    score += 0.3 * (priority / 10);

    // 3) 时效性（权重 0.2）：最近 7 天内满分，30 天后线性衰减
    const now = Date.now();
    const updatedAt =
      memory.updatedAt?.getTime() ?? memory.createdAt?.getTime() ?? now;
    const ageDays = (now - updatedAt) / (1000 * 60 * 60 * 24);
    if (ageDays <= 7) {
      score += 0.2;
    } else if (ageDays < 30) {
      score += 0.2 * (1 - (ageDays - 7) / 23);
    }
    // > 30 天不加分

    return Math.round(score * 100) / 100;
  }

  private async searchMemory(
    query: string,
    limit: number
  ): Promise<UnifiedSearchResult[]> {
    try {
      const memories = await this.memoryProvider.getRelevantMemories(
        query,
        limit
      );

      return memories.map((memory: Memory) => ({
        type: 'memory' as const,
        score: this.computeRelevanceScore(memory, query),
        title: memory.metadata?.name || memory.id,
        content: memory.content,
        snippet:
          memory.content.length > 200
            ? memory.content.slice(0, 200) + '...'
            : memory.content,
        source: `memory://${memory.id}`,
        memoryId: memory.id,
        metadata: {
          type: memory.metadata?.type,
          tags: memory.metadata?.tags,
          createdAt: memory.createdAt?.toISOString(),
          updatedAt: memory.updatedAt?.toISOString(),
        },
      }));
    } catch (err) {
      // KB-UNIFIED-SEARCH-LOG（2026-08-29）：检索失败静默返回 [] → 用户无法区分
      // "确实没找到"与"检索服务挂了"，结果被静默降级为空
      logger.warn('统一搜索（记忆）失败，返回空结果', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

export function createUnifiedSearchService(
  knowledgeRouter: IKnowledgeSearch,
  memoryProvider: MemorySearchProvider
): UnifiedSearchService {
  return new UnifiedSearchService(knowledgeRouter, memoryProvider);
}
