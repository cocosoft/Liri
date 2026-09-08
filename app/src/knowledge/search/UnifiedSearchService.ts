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

/** 分桶记录项（B7：knowledge_records 结构化记录） */
export interface BucketedRecordItem {
  bucket: 'record';
  recordId: string;
  type: string;
  key: string;
  data: Record<string, unknown>;
  evidence: Record<string, string>;
  domain: string;
  sourceFile: string;
  score: number;
}

/** 分桶原文块项（B7：R4 原文块页码命中；F5：rawPath 供 PDF 内嵌预览） */
export interface BucketedSourceItem {
  bucket: 'source';
  /** 可打开的编译页/文档相对路径 */
  docPath: string;
  /** 源 raw 文件相对 KB 根路径（如 raw/foo.pdf；F5 预览用） */
  rawPath?: string;
  title: string;
  page?: number;
  section?: string;
  text: string;
  score: number;
}

/** 分桶搜索结果（R3 docs/rules/faqs + B7 records/sources） */
export interface BucketedSearchResult {
  docs: UnifiedSearchResult[];
  rules: BucketedRuleItem[];
  faqs: BucketedFaqItem[];
  records: BucketedRecordItem[];
  sources: BucketedSourceItem[];
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

/** B8：base 前缀过滤（"根目录"/缺省视为不限），与 handler 层 inBase 语义一致 */
function baseMatches(value: string, base?: string): boolean {
  if (!base || base === '根目录') return true;
  return value === base || value.startsWith(`${base}/`);
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
   * 分桶搜索（R3+B7）：docs（关键词+语义融合）/ rules（kg_rules）/
   * faqs（faq_entries）/ records（knowledge_records）/ sources（原文块页码）
   * B8：rules/records 支持 domain + base 过滤；faqs 支持 knowledgeBaseName(base) 过滤
   */
  async searchBucketed(
    query: string,
    options?: {
      limit?: number;
      offset?: number;
      domain?: string;
      base?: string;
      ruleLimit?: number;
      faqLimit?: number;
      recordLimit?: number;
      sourceLimit?: number;
    }
  ): Promise<BucketedSearchResult> {
    const limit = options?.limit ?? 5;
    const ruleLimit = options?.ruleLimit ?? 5;
    const faqLimit = options?.faqLimit ?? 5;
    const recordLimit = options?.recordLimit ?? 5;
    const sourceLimit = options?.sourceLimit ?? 5;

    const docs = await this.search(query, {
      limit,
      offset: options?.offset ?? 0,
      domain: options?.domain,
    });

    // rules 桶：kg_rules（B8：domain 过滤 + base 前缀过滤）
    let rules: BucketedRuleItem[] = [];
    const ruleStore = new RuleStore();
    try {
      const rows = await ruleStore.search(query, {
        limit: ruleLimit,
        domain: options?.domain,
      });
      rules = rows
        .filter((r) => baseMatches(r.sourceFile, options?.base))
        .map((r, idx) => ({
          bucket: 'rule' as const,
          ruleId: r.id,
          kind: r.kind,
          constraintStrength:
            r.constraintStrength as BucketedRuleItem['constraintStrength'],
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

    // faqs 桶（B8：base→knowledgeBaseName 过滤；缺省跨 base）
    let faqs: BucketedFaqItem[] = [];
    try {
      const rows = await getFAQService().search({
        query,
        topK: faqLimit,
        knowledgeBaseName:
          options?.base && options.base !== '根目录' ? options.base : undefined,
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

    // records 桶（B7：knowledge_records 关键字命中；B8：domain/base 过滤）
    let records: BucketedRecordItem[] = [];
    try {
      const { RecordStore } = await import('../record/RecordStore');
      const recordStore = new RecordStore();
      try {
        const rows = await recordStore.search(query, {
          limit: recordLimit,
          domain: options?.domain,
        });
        records = rows
          .filter((r) => baseMatches(r.sourceFile, options?.base))
          .map((r, idx) => ({
            bucket: 'record' as const,
            recordId: r.id,
            type: r.type,
            key: r.key,
            data: r.data,
            evidence: r.evidence,
            domain: r.domain,
            sourceFile: r.sourceFile,
            score: Math.max(0, recordLimit - idx),
          }));
      } finally {
        await recordStore.close();
      }
    } catch {
      records = [];
    }

    // sources 桶（B7：R4 原文块页码命中，docPath 优先映射编译页）
    let sources: BucketedSourceItem[] = [];
    try {
      const { SourceChunkStore, readRawMetaPages } =
        await import('../source/SourceChunkStore');
      const { basename, relative } = await import('path');
      const { resolveKnowledgeDir } = await import('@modules/core');
      const knowledgeRoot = resolveKnowledgeDir();
      const sourceStore = new SourceChunkStore();
      try {
        const hits = await sourceStore.search(query, { limit: sourceLimit });
        for (let idx = 0; idx < hits.length; idx++) {
          const hit = hits[idx]!;
          const relRaw = relative(knowledgeRoot, hit.rawPath)
            .split('\\')
            .join('/');
          let docPath = relRaw;
          let title = basename(hit.rawPath).replace(/\.[^.]+$/, '');
          try {
            const pages = await readRawMetaPages(hit.rawPath);
            if (pages.length > 0) {
              const rawBase = basename(hit.rawPath).replace(/\.[^.]+$/, '');
              const entry =
                pages.find(
                  (p) => basename(p).replace(/\.md$/i, '') === rawBase
                ) ?? pages[0];
              docPath = relative(knowledgeRoot, entry).split('\\').join('/');
              title = basename(entry).replace(/\.md$/i, '');
            }
          } catch {
            // @ignore-catch 元数据定位失败回退 raw 相对路径
          }
          sources.push({
            bucket: 'source' as const,
            docPath,
            rawPath: relRaw,
            title,
            page: hit.page,
            section: hit.section,
            text: hit.text.slice(0, 200),
            score: Math.max(0, sourceLimit - idx),
          });
        }
      } finally {
        await sourceStore.close();
      }
    } catch {
      sources = [];
    }

    return { docs, rules, faqs, records, sources };
  }
}

/** 创建搜索融合实例 */
export function createUnifiedSearchService(
  router: KnowledgeRouter
): UnifiedSearchService {
  return new UnifiedSearchService(router);
}
