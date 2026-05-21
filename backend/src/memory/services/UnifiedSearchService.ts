import { KnowledgeRouter } from '../../docs/KnowledgeRouter';
import type { KnowledgeRoute } from '../../docs/KnowledgeRouter';
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
  private knowledgeRouter: KnowledgeRouter;
  private memoryProvider: MemorySearchProvider;

  constructor(
    knowledgeRouter: KnowledgeRouter,
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
    const merged = results.flat();

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
  knowledgeRouter: KnowledgeRouter,
  memoryProvider: MemorySearchProvider
): UnifiedSearchService {
  return new UnifiedSearchService(knowledgeRouter, memoryProvider);
}
