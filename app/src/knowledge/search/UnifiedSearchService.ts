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
import { RuleStore } from '../rule/RuleStore';
import { getFAQService } from '../faq/FAQService';

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

/** 分桶规则项（R3：检索分桶 rule） */
export interface BucketedRuleItem {
  bucket: 'rule';
  ruleId: string;
  kind: string;
  /** 约束强度：mandatory | should | may */
  constraintStrength: 'mandatory' | 'should' | 'may';
  /** 强度中文标签（供前端徽标） */
  constraintLabel: string;
  statement: string;
  snippet: string;
  domain: string;
  sourceFile?: string;
  score: number;
}

/** 分桶 FAQ 项（R3：检索分桶 faq） */
export interface BucketedFaqItem {
  bucket: 'faq';
  id: string;
  question: string;
  answer: string;
  category?: string;
  knowledgeBaseName: string;
  score: number;
}

/** 分桶搜索结果（R3：docs/rules/faqs 三桶） */
export interface BucketedSearchResult {
  docs: UnifiedSearchResult[];
  rules: BucketedRuleItem[];
  faqs: BucketedFaqItem[];
}

/** 强度 → 中文标签（前端徽标语义） */
export function strengthLabel(s: string): string {
  switch (s) {
    case 'mandatory':
      return '必须';
    case 'should':
      return '应';
    case 'may':
      return '可';
    default:
      return s;
  }
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

  /**
   * 分桶搜索（R3）：docs（关键词+语义融合）/ rules（kg_rules）/ faqs（faq_entries 全局）
   */
  async searchBucketed(
    query: string,
    options?: {
      limit?: number;
      offset?: number;
      domain?: string;
      ruleLimit?: number;
      faqLimit?: number;
    }
  ): Promise<BucketedSearchResult> {
    const limit = options?.limit ?? 5;
    const ruleLimit = options?.ruleLimit ?? 5;
    const faqLimit = options?.faqLimit ?? 5;

    const docs = await this.search(query, {
      limit,
      offset: options?.offset ?? 0,
      domain: options?.domain,
    });

    // rules 桶：kg_rules 关键字检索（strength 标注供徽标渲染）
    let rules: BucketedRuleItem[] = [];
    const ruleStore = new RuleStore();
    try {
      const rows = await ruleStore.search(query, { limit: ruleLimit });
      rules = rows.map((r, idx) => ({
        bucket: 'rule' as const,
        ruleId: r.id,
        kind: r.kind,
        constraintStrength: r.constraintStrength as BucketedRuleItem['constraintStrength'],
        constraintLabel: strengthLabel(r.constraintStrength),
        statement: r.statement,
        snippet: r.statement,
        domain: r.domain,
        sourceFile: r.sourceFile,
        score: Math.max(0, ruleLimit - idx),
      }));
    } catch {
      rules = [];
    } finally {
      await ruleStore.close();
    }

    // faqs 桶：faq_entries 全局搜索（knowledgeBaseName 缺省=跨 base）
    let faqs: BucketedFaqItem[] = [];
    try {
      const rows = await getFAQService().search({
        query,
        topK: faqLimit,
      });
      faqs = rows.map((f, idx) => ({
        bucket: 'faq' as const,
        id: f.id,
        question: f.question,
        answer: f.answer,
        category: f.category || undefined,
        knowledgeBaseName: f.knowledgeBaseName,
        score: Math.max(0, faqLimit - idx),
      }));
    } catch {
      faqs = [];
    }

    return { docs, rules, faqs };
  }
}

/** 创建搜索融合实例 */
export function createUnifiedSearchService(
  router: KnowledgeRouter
): UnifiedSearchService {
  return new UnifiedSearchService(router);
}
