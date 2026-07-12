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
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 知识源搜索融合服务 — UnifiedSearchService
 *
 * 功能：对 KnowledgeRouter 双通道（关键词+语义）搜索结果做 RRF 融合排序。
 *
 * 设计定位：仅做知识源内多通道融合（纯知识源），不做跨源融合（知识+Memory）。
 * 跨源融合由 Agent 层自行组装。
 *
 * 迁移自 memory/services/UnifiedSearchService.ts，剥离了 Memory 依赖。
 */

import type { KnowledgeRoute } from '@modules/docs/knowledge-types';
import { KnowledgeRouter } from '@modules/knowledge/KnowledgeRouter';

/** 搜索结果项 */
export interface UnifiedSearchResult {
  type: 'knowledge';
  score: number;
  title: string;
  content: string;
  snippet: string;
  source: string;
  docPath?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 知识源搜索融合服务
 *
 * 接收 KnowledgeRouter 返回的双通道结果，可进行二次 RRF 重排序或附加过滤。
 * 当前为轻量封装，直接委托 router.search()，后续可在此层扩展去重、重排序等逻辑。
 */
export class UnifiedSearchService {
  private router: KnowledgeRouter;
  private readonly RRF_K = 60;

  constructor(router: KnowledgeRouter) {
    this.router = router;
  }

  /**
   * 搜索知识源
   */
  async search(
    query: string,
    options?: { limit?: number; offset?: number; domain?: string }
  ): Promise<UnifiedSearchResult[]> {
    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;

    try {
      const results = await this.router.search(query, {
        maxResults: limit,
        minScore: 0.05,
        offset,
        domain: options?.domain,
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
}

/** 创建搜索融合实例 */
export function createUnifiedSearchService(
  router: KnowledgeRouter
): UnifiedSearchService {
  return new UnifiedSearchService(router);
}
