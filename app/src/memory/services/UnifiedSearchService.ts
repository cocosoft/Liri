import type {
  KnowledgeRoute,
  IKnowledgeSearch,
} from '../../docs/KnowledgeRouter';
import type { Memory } from '../types/Memory';

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
    } catch {
      return [];
    }
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
        score: memory.metadata?.priority ? 0.5 : 0.3,
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
    } catch {
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
