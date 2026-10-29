// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF SERVICE, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 知识摘要服务（知识库 → 提示词适配层）
 * 包装 KnowledgeRouter + KnowledgeDigestService，为 systemPromptSections 提供知识库查询接口
 *
 * 查询策略：
 *   1. 优先使用预编译摘要（KnowledgeDigestService）
 *   2. 摘要不可用时回退到混合搜索（KnowledgeRouter — 关键词 + 语义双通道）
 *
 * 迁移自 memory/services/KnowledgeSummarizer.ts。
 */

import { getDefaultDigestService } from '@modules/knowledge/KnowledgeDigestService';
import { getLogger } from '@modules/monitoring';
import type { IKnowledgeSearch, KnowledgeRoute } from '../docs/knowledge-types';
import type {
  KnowledgeSummary,
  KnowledgeQueryResult as KQR,
} from '../services/prompt/KnowledgePromptProvider';

const logger = getLogger('knowledge:summarizer');

export type { KnowledgeSummary };

export interface KnowledgeQueryResult extends KQR {
  /** 本次查询的来源：'digest' | 'search' */
  source: 'digest' | 'search';
}

export class KnowledgeSummarizer {
  constructor(private searchRouter: IKnowledgeSearch) {}

  async getKnowledgeSummaries(
    query: string,
    limit: number = 3,
    domain?: string
  ): Promise<KnowledgeQueryResult> {
    // S5 / issue #15（2026-10-29）：域限缩分两条链、各有其道 ——
    // 1) **搜索链**：内核 `KnowledgeRouterOptions` 已内置 `domain`（`KnowledgeRouter.filterByDomain`
    //    按文档的 `domain` 字段过滤，该字段由路径 `domains/<name>/…` 解析而来，见 `KnowledgeRouter`
    //    的 `domainMatch`）⇒ 这里只需把域名放进 options，**不重复过滤**（实现唯一性）。
    // 2) **digest 链**：`DocDigest` 没有 domain 字段 ⇒ 由 `KnowledgeDigestService.searchDigest(query, domain)`
    //    在**该服务内**按域目录前缀过滤（判定逻辑与其数据同处，避免跨层重复实现）。
    // 语义：给了合法域 ⇒ 只返回该域结果（可能为空）；未给 ⇒ 全局（默认行为不变）。
    const domainName = domain?.trim() || undefined;
    if (domainName) logger.debug('知识检索按域限缩', { domain: domainName });

    // 策略 1: 优先使用预编译摘要
    const digestResult = await this.tryDigestFirst(query, limit, domainName);
    if (digestResult) return digestResult;

    // 策略 2: 回退到实时搜索
    return this.searchFallback(query, limit, domainName);
  }

  /**
   * 使用预编译摘要（更快、更稳定）
   * 从 digest.json 中按关键词匹配摘要条目
   */
  private async tryDigestFirst(
    query: string,
    limit: number,
    domain?: string
  ): Promise<KnowledgeQueryResult | null> {
    try {
      const digestService = getDefaultDigestService();
      // 域过滤在 digest 服务内完成（按域目录前缀）
      const matches = await digestService.searchDigest(query, domain);

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
    limit: number,
    domain?: string
  ): Promise<KnowledgeQueryResult> {
    const routes = await this.searchRouter.search(query, {
      maxResults: limit,
      minScore: 0.1,
      // 域过滤由内核 router 完成（`KnowledgeRouter.filterByDomain`），本层不再二次过滤
      ...(domain ? { domain } : {}),
    });

    const summaries = routes.map((r: KnowledgeRoute) => ({
      title: r.title,
      content: r.snippet,
      category: r.category,
      score: r.score,
      docPath: r.docPath,
    }));

    return { summaries, totalCount: routes.length, source: 'search' };
  }
}
