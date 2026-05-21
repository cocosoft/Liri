import { KnowledgeRouter, KnowledgeRoute } from '../../docs/KnowledgeRouter';

export interface AdapterResult {
  id: string;
  title: string;
  content: string;
  score: number;
  source: 'knowledge';
  metadata: {
    docPath: string;
    category: string;
    matchType: string;
    isKnowledgeDoc: boolean;
  };
}

export interface KnowledgeSearchAdapter {
  search(query: string, limit?: number): Promise<AdapterResult[]>;
}

export class KnowledgeRouterAdapter implements KnowledgeSearchAdapter {
  private router: KnowledgeRouter;

  constructor(router: KnowledgeRouter) {
    this.router = router;
  }

  async search(query: string, limit: number = 5): Promise<AdapterResult[]> {
    const routes: KnowledgeRoute[] = await this.router.search(query, {
      maxResults: limit,
    });

    return routes.map((r) => ({
      id: `knowledge:${r.docPath}`,
      title: r.title,
      content: r.snippet,
      score: r.score,
      source: 'knowledge' as const,
      metadata: {
        docPath: r.docPath,
        category: r.category,
        matchType: r.matchType,
        isKnowledgeDoc: r.isKnowledgeDoc,
      },
    }));
  }
}
