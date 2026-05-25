/**
 * 知识摘要服务（知识库 → 提示词适配层）
 * 包装 HybridKnowledgeRouter + KnowledgeDigestService，为 systemPromptSections 提供知识库查询接口
 *
 * 查询策略（实施方案 2.12）：
 *   1. 优先使用预编译摘要（KnowledgeDigestService）
 *   2. 摘要不可用时回退到混合搜索（HybridKnowledgeRouter — 关键词 + 语义双通道）
 */
import { getDefaultDigestService } from '@modules/knowledge/KnowledgeDigestService';
import type { IKnowledgeSearch } from '../../docs/KnowledgeRouter';
import type {
  KnowledgeSummary,
  KnowledgeQueryResult as KQR,
} from '../../services/prompt/KnowledgePromptProvider';

export type { KnowledgeSummary };

export interface KnowledgeQueryResult extends KQR {
  /** 本次查询的来源：'digest' | 'search' */
  source: 'digest' | 'search';
}

export class KnowledgeSummarizer {
  constructor(private searchRouter: IKnowledgeSearch) {}

  async getKnowledgeSummaries(
    query: string,
    limit: number = 3
  ): Promise<KnowledgeQueryResult> {
    // 策略 1: 优先使用预编译摘要
    const digestResult = await this.tryDigestFirst(query, limit);
    if (digestResult) return digestResult;

    // 策略 2: 回退到实时搜索
    return this.searchFallback(query, limit);
  }

  /**
   * 使用预编译摘要（更快、更稳定）
   * 从 digest.json 中按关键词匹配摘要条目
   */
  private async tryDigestFirst(
    query: string,
    limit: number
  ): Promise<KnowledgeQueryResult | null> {
    try {
      const digestService = getDefaultDigestService();
      const matches = await digestService.searchDigest(query);

      if (matches.length === 0) return null;

      const summaries: KnowledgeSummary[] = matches
        .slice(0, limit)
        .map((d) => ({
          title: d.title,
          content: d.summary,
          category: d.category,
          score: 1.0,
          docPath: d.path,
        }));

      return { summaries, totalCount: matches.length, source: 'digest' };
    } catch {
      return null;
    }
  }

  /**
   * 使用混合搜索回退（关键词 + 语义双通道）
   */
  private async searchFallback(
    query: string,
    limit: number
  ): Promise<KnowledgeQueryResult> {
    const routes = await this.searchRouter.search(query, {
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

    return { summaries, totalCount: routes.length, source: 'search' };
  }
}
