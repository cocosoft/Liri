/**
 * 知识摘要服务（知识库 → 提示词适配层）
 * 包装 KnowledgeRouter，为 systemPromptSections 提供知识库查询接口
 */
import { KnowledgeRouter } from '../../docs/KnowledgeRouter';

export interface KnowledgeSummary {
  title: string;
  content: string;
  category: string;
  score: number;
  docPath: string;
}

export interface KnowledgeQueryResult {
  summaries: KnowledgeSummary[];
  totalCount: number;
}

export class KnowledgeSummarizer {
  constructor(private knowledgeRouter: KnowledgeRouter) {}

  async getKnowledgeSummaries(
    query: string,
    limit: number = 3
  ): Promise<KnowledgeQueryResult> {
    const routes = await this.knowledgeRouter.search(query, {
      maxResults: limit,
      minScore: 0.1,
    });

    const summaries = routes.map((r) => ({
      title: r.title,
      content: r.snippet,
      category: r.category,
      score: r.score,
      docPath: r.docPath,
    }));

    return { summaries, totalCount: routes.length };
  }
}
