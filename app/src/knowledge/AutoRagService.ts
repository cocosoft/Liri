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
 * 自动 RAG 服务 — AutoRagService
 *
 * 基于 Karpathy LLM Wiki 的分级检索策略：
 *   L0: 系统消息中附带 index.md 全文（~2K tokens）
 *   L1: LLM 自行判断是否需要深入阅读
 *   L2: LLM 调用 searchPages() 获取特定页面的全文
 *   L3: 必要时使用语义搜索（基于 EmbeddingManager）
 *
 * 使用方式：
 *   1. getIndexContext() → 返回 index.md 全文供注入 system prompt
 *   2. searchPages(keywords) → L2 检索，返回匹配的 wiki 页面全文
 *   3. semanticSearch(query) → L3 兜底，语义搜索
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';
import { resolveKnowledgeDir, resolveDomainDir } from '@modules/core';
import { EmbeddingManager, globalEmbeddingManager } from '@modules/ai';
import { IndexManager } from './IndexManager';
import { cosineSimilarity } from '@modules/knowledge/semantic/store';
import { COMMON_STOP_WORDS } from '@modules/knowledge/stopwords';

const logger = new OTelAwareLogger({
  module: 'knowledge:rag',
  level: LogLevel.INFO,
});

/** 检索结果条目 */
export interface RagResult {
  /** 页面文件名 */
  filename: string;
  /** 页面标题 */
  title: string;
  /** 页面 kind */
  kind: string;
  /** 全文 */
  content: string;
  /** 匹配来源: L2-keyword | L3-semantic */
  source: 'L2-keyword' | 'L3-semantic';
  /** 语义搜索时才有分数 */
  score?: number;
}

/**
 * 自动 RAG 服务
 *
 * Domain-First 模式下，通过 domainName 指定域：
 *   检索范围限缩到 ~/.pyapp/knowledge/domains/{domain}/wiki/
 */
export class AutoRagService {
  private knowledgeRoot: string;
  private embeddingManager: EmbeddingManager;
  private indexManager: IndexManager;
  private domainName?: string;

  /**
   * @param knowledgeRoot 知识库根目录
   * @param embeddingManager 可选，提供 L3 语义搜索能力
   * @param domainName 域名称（可选）。指定后检索限缩到域目录
   */
  constructor(
    knowledgeRoot?: string,
    embeddingManager?: EmbeddingManager,
    domainName?: string
  ) {
    this.domainName = domainName;

    if (knowledgeRoot) {
      this.knowledgeRoot = knowledgeRoot;
    } else if (domainName) {
      this.knowledgeRoot = resolveDomainDir(domainName);
    } else {
      this.knowledgeRoot = resolveKnowledgeDir();
    }

    this.embeddingManager = embeddingManager || globalEmbeddingManager;

    this.indexManager = new IndexManager(this.knowledgeRoot, domainName);
  }

  /**
   * 获取域名称（可能为空）
   */
  getDomainName(): string | undefined {
    return this.domainName;
  }

  // -----------------------------------------------------------------------
  // L0: 获取 index.md 全文（供注入 system prompt）
  // -----------------------------------------------------------------------

  /**
   * 获取 index.md 全文，供注入系统消息
   * L0 级上下文 — 约 1-3K tokens
   *
   * @returns index.md 全文，不存在时返回空字符串
   */
  async getIndexContext(maxEntries: number = 50): Promise<string> {
    return this.indexManager.getIndexContext(maxEntries);
  }

  // -----------------------------------------------------------------------
  // L2: 关键词检索 wiki 页面
  // -----------------------------------------------------------------------

  /**
   * 根据关键词搜索 wiki 页面全文
   * L2 级检索 — 关键词匹配标题和内容
   *
   * @param keywords 搜索关键词
   * @param maxPages 最大返回页数，默认 3
   * @returns 匹配的页面全文列表
   */
  async searchPages(
    keywords: string[],
    maxPages: number = 3
  ): Promise<RagResult[]> {
    const results: RagResult[] = [];
    const pages = await this.listMdPages();

    for (const filename of pages) {
      if (results.length >= maxPages) break;

      const filePath = join(this.knowledgeRoot, filename);
      let content: string;

      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      // 对每个关键词做大小写不敏感匹配
      const lowerContent = content.toLowerCase();
      const matched = keywords.some((kw) =>
        lowerContent.includes(kw.toLowerCase())
      );

      if (!matched) continue;

      const { title, kind } = this.parseFrontmatter(content);

      results.push({
        filename,
        title: title || filename.replace(/\.md$/, ''),
        kind,
        content,
        source: 'L2-keyword',
      });
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // L3: 语义搜索（兜底）
  // -----------------------------------------------------------------------

  /**
   * 语义搜索 wiki 页面
   * L3 级检索 — 当 L2 无结果时使用
   *
   * 内部实现：遍历知识库所有 .md 页面，嵌入查询后逐页计算余弦相似度。
   *
   * @param query 自然语言查询
   * @param topK 返回条数，默认 3
   * @returns 按相似度降序排列的结果
   */
  async semanticSearch(query: string, topK: number = 3): Promise<RagResult[]> {
    const pages = await this.listMdPages();
    if (pages.length === 0) return [];

    // 确保 EmbeddingManager 已初始化（幂等）
    this.embeddingManager.initialize();

    const queryVec = await this.embeddingManager.embedOne(query);
    if (!queryVec || queryVec.length === 0) return [];

    const scored: Array<{
      filename: string;
      title: string;
      kind: string;
      snippet: string;
      score: number;
    }> = [];

    for (const filename of pages) {
      const filePath = join(this.knowledgeRoot, filename);
      let content: string;

      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      // 去掉 frontmatter，获取纯正文
      const body = content.replace(/^---[\s\S]*?---\n*/, '').trim() || content;
      if (!body) continue;

      const pageVec = await this.embeddingManager.embedOne(body);
      if (!pageVec || pageVec.length === 0) continue;

      const score = cosineSimilarity(
        new Float32Array(queryVec),
        new Float32Array(pageVec)
      );
      if (score <= 0.3) continue;

      const { title, kind } = this.parseFrontmatter(content);
      scored.push({
        filename,
        title: title || filename.replace(/\.md$/, '').replace(/[-_]/g, ' '),
        kind,
        snippet: body.slice(0, 200),
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    return top.map((hit) => ({
      filename: hit.filename,
      title: hit.title,
      kind: hit.kind,
      content: hit.snippet,
      source: 'L3-semantic' as const,
      score: hit.score,
    }));
  }

  // -----------------------------------------------------------------------
  // 分级检索入口
  // -----------------------------------------------------------------------

  /**
   * 统一检索入口：L2 → L3 逐级降级
   *
   * @param query 用户查询
   * @param options 检索选项
   * @returns 检索结果列表
   */
  async retrieve(
    query: string,
    options?: {
      /** L2 关键词列表，默认从 query 中提取 */
      keywords?: string[];
      /** 最大返回页数，默认 3 */
      maxPages?: number;
      /** 是否允许 L3 语义回落，默认 true */
      allowSemanticFallback?: boolean;
    }
  ): Promise<RagResult[]> {
    const maxPages = options?.maxPages ?? 3;
    const allowFallback = options?.allowSemanticFallback ?? true;

    // 优先 L2：关键词检索
    const keywords = options?.keywords ?? this.extractKeywords(query);
    const l2Results = await this.searchPages(keywords, maxPages);

    if (l2Results.length > 0) {
      logger.debug('RAG L2 命中', { keywords, count: l2Results.length });
      return l2Results;
    }

    // L2 无结果时 L3 语义检索
    if (!allowFallback) return [];

    logger.debug('RAG L2 未命中，降级到 L3 语义搜索', { query });
    return await this.semanticSearch(query, maxPages);
  }

  // -----------------------------------------------------------------------
  // 工具方法
  // -----------------------------------------------------------------------

  /**
   * 列出知识库中所有 .md 页面（不含 index.md / log.md）
   */
  private async listMdPages(): Promise<string[]> {
    try {
      const entries = await readdir(this.knowledgeRoot);
      return entries
        .filter(
          (e) =>
            e.endsWith('.md') &&
            e !== 'index.md' &&
            e !== 'log.md' &&
            !e.includes('DIARY')
        )
        .sort();
    } catch {
      return [];
    }
  }

  /**
   * 从 frontmatter 中提取 title 和 kind
   */
  private parseFrontmatter(content: string): {
    title: string;
    kind: string;
  } {
    const titleMatch = content.match(/^title:\s*(.+)$/m);
    const kindMatch = content.match(/^kind:\s*(.+)$/m);

    return {
      title: titleMatch ? titleMatch[1].trim().replace(/["'"]/g, '') : '',
      kind: kindMatch ? kindMatch[1].trim().replace(/["'"]/g, '') : '其他',
    };
  }

  /**
   * 从查询文本中提取关键词
   */
  private extractKeywords(query: string): string[] {
    return query
      .split(/[\s,，。；;：:、？！!?()（）"'"「」【】]/)
      .filter((w) => w.length >= 2 && !COMMON_STOP_WORDS.has(w.toLowerCase()))
      .slice(0, 5);
  }
}
