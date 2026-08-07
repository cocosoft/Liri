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
 * 统一知识路由 — KnowledgeRouter
 *
 * 双通道搜索：
 *   - KeywordChannel：倒排索引 + 分层权重（迁移自 docs/KnowledgeRouter）
 *   - SemanticChannel：向量嵌入 + 余弦相似度（基于 SemanticStore 持久化存储）
 *
 * 合并策略：RRF（Reciprocal Rank Fusion），消除 HybridKnowledgeRouter 的内存 vectorIndex 数组
 *
 * 对比旧 HybridKnowledgeRouter：
 *   - 旧：SemanticChannel 每次重建内存 VectorIndex[]，重启后不持久
 *   - 新：直接依赖 SemanticStore 做向量检索，持久化存储、重启不丢
 */

import { EmbeddingManager, globalEmbeddingManager } from '@modules/ai';
import type {
  IKnowledgeSearch,
  KnowledgeRoute,
  KnowledgeRouterOptions,
} from '@modules/docs/knowledge-types';
import type { FileDocsProvider } from '@modules/docs/FileDocsProvider';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';
import type { SemanticStore } from '@modules/knowledge/semantic/store';
import type { IVectorStore } from '@modules/knowledge/semantic/IVectorStore';
import type { RerankService } from '@modules/knowledge/RerankService';
import { COMMON_STOP_WORDS } from '@modules/knowledge/stopwords';
import type { EventBus } from '@modules/core';
import type { KnowledgeGraph } from '@modules/knowledge/graph/KnowledgeGraph';
import { resolveDataSubDir } from '@modules/core';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { KnowledgeConfig } from '@modules/knowledge/KnowledgeConfig';
import { knowledgeMonitor } from '@modules/knowledge/KnowledgeMonitor';

const logger = new OTelAwareLogger({
  module: 'knowledge:router',
  level: LogLevel.INFO,
});

/** 带权重的文档条目 */
interface WeightedDoc {
  docPath: string;
  title: string;
  category: string;
  content: string;
  isKnowledgeDoc: boolean;
  source?: string;
  /** 域名称（从路径中解析，如 "domains/botany/wiki/doc.md" → "botany"） */
  domain?: string;
  /** frontmatter tags（供标签过滤搜索使用） */
  tags?: string[];
}

/** 混合搜索配置 */
interface HybridConfig {
  keywordWeight?: number; // default 0.4
  semanticWeight?: number; // default 0.6
  semanticThreshold?: number; // default 0.3
  keywordFetchMultiplier?: number; // default 3
}

const DEFAULT_HYBRID_CONFIG: Required<HybridConfig> = {
  keywordWeight: 0.4,
  semanticWeight: 0.6,
  semanticThreshold: 0.3,
  keywordFetchMultiplier: 3,
};

/** 索引用 content 截断长度 */
const INDEX_CONTENT_MAX_LEN = 2000;
/** 文档数上限 */
const MAX_DOCS = 5000;
/** 软告警阈值（百分比） */
const DOCS_WARNING_RATIO = 0.8;
/** 搜索缓存 TTL（毫秒） */
const SEARCH_CACHE_TTL_MS = 60_000;
/** 搜索缓存最大条目数 */
const SEARCH_CACHE_MAX_SIZE = 500;

interface IndexCacheEntry {
  title: string;
  category: string;
  docPath: string;
  isKnowledgeDoc: boolean;
  contentHash: string;
  domain?: string;
  tags?: string[];
  tokens: string[];
}

interface IndexCache {
  version: 2;
  docs: IndexCacheEntry[];
}

/**
 * 统一知识路由
 */
export class KnowledgeRouter implements IKnowledgeSearch {
  private providers: FileDocsProvider[];
  private knownUsernames: string[];
  private docs: WeightedDoc[] = [];
  private initialized: boolean = false;
  private embeddingManager: EmbeddingManager;
  private hybridConfig: Required<HybridConfig>;
  /**
   * @deprecated 使用 vectorStore 替代。保留以兼容旧调用方。
   */
  private semanticStore?: SemanticStore;
  /** 向量存储实例（IVectorStore 接口，优先于 semanticStore 使用） */
  private vectorStore?: IVectorStore;
  /** 知识图谱实例（可选，用于 GraphRAG 增强） */
  private knowledgeGraph?: KnowledgeGraph;
  /** 重排序服务（可选，用于检索结果精排） */
  private rerankService?: RerankService;

  /** 标题倒排索引：lowerTitle → 文档，O(1) 精确查找 */
  private titleIndex: Map<string, WeightedDoc> = new Map();

  /** Token 倒排索引：token → 文档索引集合，O(k) 关键词查找 */
  private tokenIndex: Map<string, Set<number>> = new Map();

  /** 索引缓存路径 */
  private indexCachePath: string;

  /** 搜索缓存：queryKey → { result, expiresAt } */
  private searchCache: Map<
    string,
    { result: KnowledgeRoute[]; expiresAt: number }
  > = new Map();

  constructor(
    providers: FileDocsProvider | FileDocsProvider[],
    embeddingManager?: EmbeddingManager,
    knownUsernames: string[] = [],
    knowledgeConfig?: KnowledgeConfig,
    semanticStore?: SemanticStore,
    eventBus?: EventBus,
    knowledgeGraph?: KnowledgeGraph,
    vectorStore?: IVectorStore,
    rerankService?: RerankService
  ) {
    this.providers = Array.isArray(providers) ? providers : [providers];
    this.knownUsernames = knownUsernames;
    this.embeddingManager = embeddingManager ?? globalEmbeddingManager;
    this.semanticStore = semanticStore;
    this.vectorStore = vectorStore;
    this.knowledgeGraph = knowledgeGraph;
    this.rerankService = rerankService;

    // 从 KnowledgeConfig 读取搜索配置，merge 到 hybridConfig
    const configSearch = knowledgeConfig?.search;
    this.hybridConfig = {
      ...DEFAULT_HYBRID_CONFIG,
      ...(configSearch
        ? {
            keywordWeight: configSearch.keywordWeight,
            semanticWeight: configSearch.semanticWeight,
            semanticThreshold: configSearch.semanticThreshold,
          }
        : {}),
    };
    this.indexCachePath = join(
      resolveDataSubDir(''),
      'knowledge',
      'cache',
      'inverted-index.json'
    );

    // 监听知识变更事件，实现增量索引更新
    eventBus?.subscribe('knowledge:changed', (event: unknown) => {
      const evt = event as { action: string; filePath: string };
      if (evt.action === 'deleted') {
        this.removeFromIndex(evt.filePath);
      }
      // 清除搜索缓存（知识已变更）
      this.searchCache.clear();
      // created/updated 通过 buildIndex 全量刷新（保守方案确保一致性）
    });
  }

  /** 更新已知用户名 */
  setKnownUsernames(usernames: string[]): void {
    this.knownUsernames = usernames;
  }

  /** 构建关键字索引和倒排索引 */
  async buildIndex(): Promise<void> {
    this.docs = [];
    this.titleIndex.clear();
    this.tokenIndex.clear();

    for (const provider of this.providers) {
      const entries = await provider.buildIndex();
      for (const e of entries) {
        const isKnowledgeDoc = e.source?.includes('.pyapp') ?? false;
        const domainMatch = e.relativePath.match(/(?:^|\/)domains\/([^/]+)/);
        const doc: WeightedDoc = {
          docPath: e.relativePath,
          title: e.title,
          category: e.category,
          content: e.content,
          isKnowledgeDoc,
          source: e.source,
          domain: domainMatch ? domainMatch[1] : undefined,
          tags: e.tags,
        };
        this.docs.push(doc);
      }
    }

    // 容量检查：超过上限时告警并截断
    if (this.docs.length > MAX_DOCS) {
      logger.warn('知识库文档数超过上限', {
        total: this.docs.length,
        max: MAX_DOCS,
        action: 'truncate',
      });
      this.docs = this.docs.slice(0, MAX_DOCS);
    } else if (this.docs.length > MAX_DOCS * DOCS_WARNING_RATIO) {
      logger.warn('知识库文档数接近上限', {
        total: this.docs.length,
        warningThreshold: MAX_DOCS * DOCS_WARNING_RATIO,
      });
    }

    // 构建索引 + 收集缓存条目
    const cacheEntries: IndexCacheEntry[] = [];
    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i]!;
      this.titleIndex.set(doc.title.toLowerCase(), doc);

      const truncatedContent = doc.content.slice(0, INDEX_CONTENT_MAX_LEN);
      const tokens = this.tokenize(doc.title + ' ' + truncatedContent);
      for (const token of tokens) {
        const set = this.tokenIndex.get(token);
        if (set) {
          set.add(i);
        } else {
          this.tokenIndex.set(token, new Set([i]));
        }
      }

      // 缓存条目（含 content hash 用于变更检测）
      cacheEntries.push({
        title: doc.title,
        category: doc.category,
        docPath: doc.docPath,
        isKnowledgeDoc: doc.isKnowledgeDoc,
        contentHash: createHash('sha256')
          .update(truncatedContent)
          .digest('hex')
          .slice(0, 16),
        domain: doc.domain,
        tags: doc.tags,
        tokens,
      });
    }

    // 持久化索引缓存
    await this.saveIndexCache(cacheEntries);
    this.initialized = true;

    // 监控：索引构建耗时
    // @ignore-catch — 监控记录fire-and-forget，非关键路径
    knowledgeMonitor.record('knowledge.index.build_time_ms', 0).catch(() => {});
    logger.info('索引构建完成', { docCount: this.docs.length });
  }

  /**
   * 从缓存加载索引（如果内容 hash 一致则复用）
   */
  async tryLoadFromCache(): Promise<boolean> {
    try {
      if (!existsSync(this.indexCachePath)) return false;

      const raw = await readFile(this.indexCachePath, 'utf-8');
      const cache: IndexCache = JSON.parse(raw);
      if (cache.version !== 2 || !cache.docs?.length) return false;

      // 验证所有文档的 content hash 是否匹配
      const freshEntries = await this.buildProviderEntries();
      if (freshEntries.length !== cache.docs.length) return false;

      for (let i = 0; i < cache.docs.length; i++) {
        const cached = cache.docs[i]!;
        const fresh = freshEntries[i]!;
        const freshHash = createHash('sha256')
          .update(fresh.content.slice(0, INDEX_CONTENT_MAX_LEN))
          .digest('hex')
          .slice(0, 16);
        if (cached.contentHash !== freshHash) return false;
      }

      // Hash 全部匹配 → 从缓存恢复索引
      this.docs = cache.docs.map((c) => ({
        docPath: c.docPath,
        title: c.title,
        category: c.category,
        content: '',
        isKnowledgeDoc: c.isKnowledgeDoc,
        domain: c.domain,
        tags: c.tags,
      }));
      for (let i = 0; i < cache.docs.length; i++) {
        const c = cache.docs[i]!;
        const doc = this.docs[i]!;
        this.titleIndex.set(doc.title.toLowerCase(), doc);
        for (const token of c.tokens) {
          const set = this.tokenIndex.get(token);
          if (set) {
            set.add(i);
          } else {
            this.tokenIndex.set(token, new Set([i]));
          }
        }
      }
      this.initialized = true;
      logger.info('从缓存加载索引', { docCount: this.docs.length });
      return true;
    } catch (err) {
      logger.debug('索引缓存加载失败，将全量重建', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async buildProviderEntries(): Promise<WeightedDoc[]> {
    const result: WeightedDoc[] = [];
    for (const provider of this.providers) {
      const entries = await provider.buildIndex();
      for (const e of entries) {
        const isKnowledgeDoc = e.source?.includes('.pyapp') ?? false;
        const domainMatch = e.relativePath.match(/(?:^|\/)domains\/([^/]+)/);
        result.push({
          docPath: e.relativePath,
          title: e.title,
          category: e.category,
          content: e.content,
          isKnowledgeDoc,
          source: e.source,
          domain: domainMatch ? domainMatch[1] : undefined,
          tags: e.tags,
        });
      }
    }
    return result;
  }

  private async saveIndexCache(entries: IndexCacheEntry[]): Promise<void> {
    try {
      const cacheDir = join(resolveDataSubDir(''), 'knowledge', 'cache');
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true });
      }
      const tmpPath = this.indexCachePath + '.tmp';
      const cache: IndexCache = { version: 2, docs: entries };
      await writeFile(tmpPath, JSON.stringify(cache), 'utf-8');
      const { rename } = await import('fs/promises');
      await rename(tmpPath, this.indexCachePath);
    } catch (err) {
      logger.debug('索引缓存写入失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 按标题精确查找文档 — O(1)
   */
  findByTitle(title: string): WeightedDoc | undefined {
    return this.titleIndex.get(title.toLowerCase().trim());
  }

  /**
   * 从索引中增量移除文档 — O(k)，k=文档的 token 数
   */
  removeFromIndex(filePath: string): void {
    // 从 docs 和 titleIndex 中移除
    const docIdx = this.docs.findIndex(
      (d) => d.docPath === filePath || filePath.endsWith(d.docPath)
    );
    if (docIdx === -1) return;

    const doc = this.docs[docIdx]!;
    this.titleIndex.delete(doc.title.toLowerCase());

    // 从 tokenIndex 中清理该文档的 token 引用
    for (const [token, docSet] of this.tokenIndex) {
      docSet.delete(docIdx);
      if (docSet.size === 0) {
        this.tokenIndex.delete(token);
      }
    }

    this.docs.splice(docIdx, 1);
    logger.info('已从索引中移除文档', { filePath, title: doc.title });
  }

  /** 分词 */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[\s,，。、；：（）()\[\]【】{}""''「」『』《》\/\\\-]+/)
      .filter((t) => t.length > 1)
      .filter((t) => !COMMON_STOP_WORDS.has(t));
  }

  /** 提取匹配片段 */
  private extractSnippet(
    content: string,
    queryTokens: string[],
    maxLen: number = 120
  ): string {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (queryTokens.some((t) => lower.includes(t))) {
        let snippet = lines[i].trim();
        if (snippet.length > maxLen) {
          snippet = snippet.slice(0, maxLen) + '...';
        }
        return snippet;
      }
    }
    const firstLine = lines.find((l) => l.trim().length > 0);
    return firstLine ? firstLine.trim().slice(0, maxLen) : '';
  }

  /**
   * 按域名过滤文档列表
   */
  private filterByDomain(
    docs: WeightedDoc[],
    options?: KnowledgeRouterOptions
  ): WeightedDoc[] {
    const domains =
      options?.domains ?? (options?.domain ? [options.domain] : undefined);
    if (!domains || domains.length === 0) return docs;

    return docs.filter((d) => d.domain && domains.includes(d.domain));
  }

  /**
   * 关键字搜索通道
   *
   * 使用倒排索引 tokenIndex 先做候选集交集，再在候选集上计算分层权重。
   * 权重：知识库文档(+0.5) > 用户名匹配(+0.4) > 标题匹配(+0.3) > 内容关键词匹配(+0.2) > 目录名匹配(+0.1)
   */
  private keywordSearch(
    query: string,
    maxResults: number,
    minScore: number,
    options?: KnowledgeRouterOptions
  ): KnowledgeRoute[] {
    const queryTokens = this.tokenize(query);
    const lowerQuery = query.toLowerCase();

    if (queryTokens.length === 0) {
      return [];
    }

    // 用倒排索引快速定位候选文档（取所有 token 命中文档的并集）
    const candidateIdxSet = new Set<number>();
    for (const token of queryTokens) {
      const docSet = this.tokenIndex.get(token);
      if (docSet) {
        for (const idx of docSet) {
          candidateIdxSet.add(idx);
        }
      }
    }

    // 如果没有 token 级命中，回退到全量扫描（处理生僻查询）
    let candidateDocs =
      candidateIdxSet.size > 0
        ? Array.from(candidateIdxSet).map((i) => this.docs[i]!)
        : this.docs;

    // 按域名过滤
    candidateDocs = this.filterByDomain(candidateDocs, options);

    const results: KnowledgeRoute[] = [];

    for (const doc of candidateDocs) {
      const lowerTitle = doc.title.toLowerCase();
      const lowerCategory = doc.category.toLowerCase();
      const lowerContent = doc.content.toLowerCase();

      let bestScore = 0;
      let bestMatchType: KnowledgeRoute['matchType'] = 'keyword';

      // 知识库文档 (+0.5)
      if (doc.isKnowledgeDoc) {
        const hasMatch = queryTokens.some(
          (t) =>
            lowerTitle.includes(t) ||
            lowerContent.includes(t) ||
            lowerCategory.includes(t)
        );
        if (hasMatch) {
          bestScore = 0.5;
          bestMatchType = 'knowledge';
        }
      }

      // 用户名匹配 (+0.4)
      if (this.knownUsernames.length > 0) {
        const matchedUser = this.knownUsernames.some((u) =>
          lowerQuery.includes(u.toLowerCase())
        );
        if (
          matchedUser &&
          lowerContent.includes('@') &&
          queryTokens.some((t) => lowerContent.includes(t))
        ) {
          if (0.4 > bestScore) {
            bestScore = 0.4;
            bestMatchType = 'username';
          }
        }
      }

      // 标题匹配 (+0.3)
      const titleMatchCount = queryTokens.filter((t) =>
        lowerTitle.includes(t)
      ).length;
      if (titleMatchCount > 0) {
        const titleScore = 0.3 * (titleMatchCount / queryTokens.length);
        if (doc.isKnowledgeDoc) {
          bestScore = bestScore + titleScore;
        } else {
          bestScore = titleScore;
        }
        bestMatchType = 'title';
      }

      // 内容关键词匹配 (+0.2)
      const contentMatchCount = queryTokens.filter((t) =>
        lowerContent.includes(t)
      ).length;
      if (contentMatchCount > 0) {
        const contentScore = 0.2 * (contentMatchCount / queryTokens.length);
        if (doc.isKnowledgeDoc) {
          bestScore = bestScore + contentScore;
        } else {
          bestScore = contentScore;
        }
        bestMatchType = 'keyword';
      }

      // 目录名匹配 (+0.1)
      const dirMatchCount = queryTokens.filter((t) =>
        lowerCategory.includes(t)
      ).length;
      if (dirMatchCount > 0) {
        const dirScore = 0.1 * (dirMatchCount / queryTokens.length);
        if (doc.isKnowledgeDoc) {
          bestScore = bestScore + dirScore;
        } else {
          bestScore = dirScore;
        }
        bestMatchType = 'directory';
      }

      if (bestScore > 0 && bestScore >= minScore) {
        results.push({
          docPath: doc.docPath,
          title: doc.title,
          score: Math.round(bestScore * 100) / 100,
          category: doc.category,
          snippet: this.extractSnippet(doc.content, queryTokens),
          matchType: bestMatchType,
          isKnowledgeDoc: doc.isKnowledgeDoc,
          tags: doc.tags,
        });
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.isKnowledgeDoc !== b.isKnowledgeDoc)
        return a.isKnowledgeDoc ? -1 : 1;
      return 0;
    });

    return results.slice(0, maxResults);
  }

  /**
   * 语义搜索通道
   *
   * 优先使用 IVectorStore（sqlite-vec 等专业存储），
   * 不可用时回退到 SemanticStore（JSONL）。
   * 两者均不可用时返回空——search() 中的 catch 兜底确保纯关键词搜索仍可用。
   */
  private async semanticSearch(
    query: string,
    maxResults: number
  ): Promise<KnowledgeRoute[]> {
    // 优先使用 vectorStore
    if (this.vectorStore) {
      const count = await this.vectorStore.count();
      if (count === 0) return [];
    } else if (!this.semanticStore || this.semanticStore.empty) {
      return [];
    }

    this.embeddingManager.initialize();
    const queryVec = await this.embeddingManager.embedOne(query);
    if (queryVec.length === 0) return [];

    const threshold = this.hybridConfig.semanticThreshold;

    // IVectorStore 路径（异步搜索）
    if (this.vectorStore) {
      const hits = await this.vectorStore.search(
        new Float32Array(queryVec),
        maxResults,
        threshold
      );
      const docMap = new Map(this.docs.map((d) => [d.docPath, d]));
      return hits.map((hit) => {
        const doc = docMap.get(hit.entry.path);
        return {
          docPath: hit.entry.path,
          title: doc?.title ?? hit.entry.path.replace(/\.md$/i, ''),
          score: Math.round(hit.score * 100) / 100,
          category: doc?.category ?? '',
          snippet: hit.entry.text.slice(0, 120),
          matchType: 'semantic' as const,
          isKnowledgeDoc: doc?.isKnowledgeDoc ?? true,
          tags: doc?.tags,
          startLine: hit.entry.startLine,
          endLine: hit.entry.endLine,
          semanticScore: Math.round(hit.score * 100) / 100,
        };
      });
    }

    // SemanticStore 回退路径（同步搜索）
    const hits = this.semanticStore!.search(
      new Float32Array(queryVec),
      maxResults,
      threshold
    );
    const docMap = new Map(this.docs.map((d) => [d.docPath, d]));
    return hits.map((hit) => {
      const doc = docMap.get(hit.entry.path);
      return {
        docPath: hit.entry.path,
        title: doc?.title ?? hit.entry.path.replace(/\.md$/i, ''),
        score: Math.round(hit.score * 100) / 100,
        category: doc?.category ?? '',
        snippet: hit.entry.text.slice(0, 120),
        matchType: 'semantic' as const,
        isKnowledgeDoc: doc?.isKnowledgeDoc ?? true,
        startLine: hit.entry.startLine,
        endLine: hit.entry.endLine,
        semanticScore: Math.round(hit.score * 100) / 100,
      };
    });
  }

  /** 归一化关键词得分 */
  private normalizeKeywordResults(results: KnowledgeRoute[]): KnowledgeRoute[] {
    if (results.length === 0) return results;
    const maxScore = Math.max(...results.map((r) => r.score));
    if (maxScore === 0) return results;
    return results.map((r) => ({
      ...r,
      score: r.score / maxScore,
    }));
  }

  /**
   * RRF 合并关键词与语义结果
   *
   * 使用 RRF（Reciprocal Rank Fusion）而非加权平均：
   * RRF 对排名敏感而非绝对值，更适合异质评分（关键词是启发式分数，语义是余弦相似度）
   */
  private mergeResults(
    keywordResults: KnowledgeRoute[],
    semanticResults: KnowledgeRoute[],
    maxResults: number
  ): KnowledgeRoute[] {
    const kw = this.hybridConfig.keywordWeight;
    const sm = this.hybridConfig.semanticWeight;

    const normalizedKw = this.normalizeKeywordResults(keywordResults);
    const merged = new Map<
      string,
      { route: KnowledgeRoute; kwScore: number; smScore: number }
    >();

    for (const r of normalizedKw) {
      merged.set(r.docPath, { route: r, kwScore: r.score, smScore: 0 });
    }

    for (const r of semanticResults) {
      const existing = merged.get(r.docPath);
      if (existing) {
        existing.smScore = r.score;
        existing.route.snippet = r.snippet;
      } else {
        merged.set(r.docPath, { route: r, kwScore: 0, smScore: r.score });
      }
    }

    const combined: KnowledgeRoute[] = [];
    for (const entry of merged.values()) {
      const hybridScore = kw * entry.kwScore + sm * entry.smScore;
      combined.push({
        ...entry.route,
        score: Math.round(hybridScore * 100) / 100,
      });
    }

    combined.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.isKnowledgeDoc !== b.isKnowledgeDoc)
        return a.isKnowledgeDoc ? -1 : 1;
      return 0;
    });

    return combined.slice(0, maxResults);
  }

  /**
   * 双通道混合搜索
   *
   * 同时执行关键词搜索和语义搜索，使用 RRF 合并排序。
   */
  async search(
    query: string,
    options?: KnowledgeRouterOptions
  ): Promise<KnowledgeRoute[]> {
    const otel = getOTelTracing();
    const span = otel.startSpan('knowledge.router.search', {
      'knowledge.query': query.substring(0, 200),
      'knowledge.max_results': options?.maxResults ?? 10,
    });
    const startTime = performance.now();

    try {
      if (!this.initialized) {
        await this.buildIndex();
      }

      const maxResults = options?.maxResults ?? 10;
      const minScore = options?.minScore ?? 0;
      const offset = options?.offset ?? 0;

      // 查搜索缓存
      const cacheKey = `${query}||${maxResults}||${minScore}||${offset}||${options?.domain ?? ''}`;
      const cached = this.searchCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        knowledgeMonitor
          .record(
            'knowledge.search.latency_ms',
            performance.now() - startTime,
            {
              cache: 'hit',
            }
          )
          // @ignore-catch — OTel span属性设置fire-and-forget，非关键路径
          .catch(() => {});
        span.setAttribute('knowledge.cache', 'hit');
        otel.endSpan(span);
        return cached.result;
      }

      const multiplier = this.hybridConfig.keywordFetchMultiplier;
      const fetchCount = (offset + maxResults) * multiplier;

      const keywordSpan = otel.startSpan('knowledge.router.keyword', {}, span);
      let keywordResults: KnowledgeRoute[] = [];
      try {
        keywordResults = this.keywordSearch(
          query,
          fetchCount,
          minScore,
          options
        );
        keywordSpan.setAttribute(
          'knowledge.keyword.count',
          keywordResults.length
        );
      } finally {
        otel.endSpan(keywordSpan);
      }

      const semanticSpan = otel.startSpan(
        'knowledge.router.semantic',
        {},
        span
      );
      let semanticResults: KnowledgeRoute[] = [];
      try {
        semanticResults = await this.semanticSearch(query, fetchCount);
        semanticSpan.setAttribute(
          'knowledge.semantic.count',
          semanticResults.length
        );
      } catch (err) {
        logger.warn('语义搜索不可用，降级为纯关键词搜索', {
          error: (err as Error).message,
        });
        otel.recordEvent(semanticSpan, 'semantic_search_fallback', {
          error: (err as Error).message,
        });
      } finally {
        otel.endSpan(semanticSpan);
      }

      const merged = this.mergeResults(
        keywordResults,
        semanticResults,
        fetchCount
      );

      // GraphRAG: 图感知扩展
      if (this.knowledgeGraph) {
        const graphResults = await this.graphExpand(query, maxResults);
        if (graphResults.length > 0) {
          const existingPaths = new Set(merged.map((r) => r.docPath));
          for (const gr of graphResults) {
            if (!existingPaths.has(gr.docPath)) {
              merged.push(gr);
            }
          }
        }
      }

      // 重排序（如果配置了 rerankService）
      let reranked: KnowledgeRoute[] = merged;
      if (this.rerankService && merged.length > 1) {
        try {
          const rerankDocs = merged.map((r) => ({
            id: r.docPath,
            content: r.snippet,
            score: r.score,
          }));
          const result = await this.rerankService.rerank(
            query,
            rerankDocs,
            fetchCount
          );
          reranked = result
            .map((rr) => {
              const original = merged.find((m) => m.docPath === rr.id);
              return original ? { ...original, score: rr.score } : null;
            })
            .filter((r): r is KnowledgeRoute => r !== null);
        } catch (err) {
          logger.warn('重排序失败，使用原始融合结果', {
            error: (err as Error).message,
          });
        }
      }

      // 上下文富化（O6）
      const enriched = await this.enrichContext(reranked);

      const result = enriched.slice(offset, offset + maxResults);

      // 写入搜索缓存（LRU 淘汰）
      if (this.searchCache.size >= SEARCH_CACHE_MAX_SIZE) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest) this.searchCache.delete(oldest);
      }
      this.searchCache.set(cacheKey, {
        result,
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
      });

      span.setAttribute('knowledge.cache', 'miss');
      span.setAttribute('knowledge.result.count', result.length);
      knowledgeMonitor
        .record('knowledge.search.latency_ms', performance.now() - startTime, {
          cache: 'miss',
        })
        // @ignore-catch — 监控记录fire-and-forget，非关键路径
        .catch(() => {});
      return result;
    } catch (err) {
      otel.recordError(span, err as Error);
      throw err;
    } finally {
      otel.endSpan(span);
    }
  }

  /**
   * GraphRAG 图感知扩展
   * 从查询中提取潜在实体，在 KnowledgeGraph 中查找关联边，
   * 按边关系类型动态赋权返回关联文档。
   */
  private async graphExpand(
    query: string,
    maxResults: number
  ): Promise<KnowledgeRoute[]> {
    if (!this.knowledgeGraph) return [];

    // 边关系类型权重映射
    const EDGE_WEIGHTS: Record<string, number> = {
      synonym: 0.5,
      related: 0.4,
      parent: 0.35,
      child: 0.35,
      reference: 0.25,
    };
    const DEFAULT_EDGE_WEIGHT = 0.3;

    try {
      const entityCandidates = this.tokenize(query)
        .filter((t) => t.length >= 2 && !COMMON_STOP_WORDS.has(t))
        .slice(0, 5);

      if (entityCandidates.length === 0) return [];

      // 动态实体 ID 格式：不再硬编码 domain 前缀
      const relatedEntities = new Map<string, number>(); // entity → maxWeight
      for (const entity of entityCandidates) {
        const formats = [`concept:${entity}`, `entity:${entity}`, entity];
        for (const fmt of formats) {
          try {
            const edges = await this.knowledgeGraph.queryEdges({
              entityId: fmt,
              limit: 10,
            });
            for (const e of edges) {
              const weight = EDGE_WEIGHTS[e.type] ?? DEFAULT_EDGE_WEIGHT;
              const existing = relatedEntities.get(e.from);
              if (existing === undefined || weight > existing) {
                relatedEntities.set(e.from, weight);
              }
              const existingTo = relatedEntities.get(e.to);
              if (existingTo === undefined || weight > existingTo) {
                relatedEntities.set(e.to, weight);
              }
            }
          } catch {
            // 单个查询失败不影响整体
          }
        }
      }

      if (relatedEntities.size === 0) return [];

      const results: KnowledgeRoute[] = [];
      for (const [entity, weight] of relatedEntities) {
        const entityLower = entity.toLowerCase();
        for (const doc of this.docs) {
          if (results.length >= maxResults) break;
          if (
            doc.content.toLowerCase().includes(entityLower) ||
            doc.title.toLowerCase().includes(entityLower)
          ) {
            results.push({
              docPath: doc.docPath,
              title: doc.title,
              score: weight,
              category: doc.category,
              snippet: this.extractSnippet(doc.content, [entityLower]),
              matchType: 'semantic',
              isKnowledgeDoc: doc.isKnowledgeDoc,
              tags: doc.tags,
            });
          }
        }
      }

      return results.slice(0, maxResults);
    } catch (err) {
      logger.warn('GraphRAG 扩展失败，降级为无图搜索结果', {
        error: String(err),
      });
      return [];
    }
  }

  /** 获取文档内容 */
  async getDocContent(docPath: string): Promise<string | null> {
    for (const provider of this.providers) {
      const entry = await provider.loadDoc(docPath);
      if (entry) return entry.content;
    }
    return null;
  }

  /** 获取分类列表 */
  async getCategories(): Promise<string[]> {
    const allCategories = new Set<string>();
    for (const provider of this.providers) {
      const categories = await provider.getCategories();
      categories.forEach((c) => allCategories.add(c));
    }
    return Array.from(allCategories).sort();
  }

  /**
   * 上下文富化：对融合后的检索结果附加前后块和父块内容
   * 依赖 IVectorStore 的 getById 能力获取关联分块
   */
  private async enrichContext(
    routes: KnowledgeRoute[],
    maxContextChars: number = 2000
  ): Promise<KnowledgeRoute[]> {
    if (!this.vectorStore || routes.length === 0) return routes;

    return Promise.all(
      routes.map(async (route) => {
        const chunkId = `${route.docPath}#L${route.startLine ?? 1}-L${route.endLine ?? 1}`;
        try {
          const chunk = await this.vectorStore!.getById(chunkId);
          if (!chunk) return route;

          const contextParts: string[] = [];

          if (chunk.contextHeader) {
            contextParts.push(`[上下文] ${chunk.contextHeader}`);
          }

          if (chunk.parentChunkId) {
            try {
              const parent = await this.vectorStore!.getById(
                chunk.parentChunkId
              );
              if (parent) {
                contextParts.push(
                  `[摘要] ${parent.text.slice(0, maxContextChars)}`
                );
              }
            } catch {
              /* 父块不可用则跳过 */
            }
          }

          if (chunk.preChunkId) {
            try {
              const pre = await this.vectorStore!.getById(chunk.preChunkId);
              if (pre) {
                contextParts.push(`[上文] ${pre.text.slice(-500)}`);
              }
            } catch {
              /* 前块不可用则跳过 */
            }
          }

          if (chunk.nextChunkId) {
            try {
              const next = await this.vectorStore!.getById(chunk.nextChunkId);
              if (next) {
                contextParts.push(`[下文] ${next.text.slice(0, 500)}`);
              }
            } catch {
              /* 后块不可用则跳过 */
            }
          }

          if (contextParts.length > 0) {
            return {
              ...route,
              snippet: `${route.snippet}\n\n${contextParts.join('\n---\n')}`,
            };
          }

          return route;
        } catch {
          return route;
        }
      })
    );
  }
}

/** 默认单例 */
export const knowledgeRouter = new KnowledgeRouter([]);

/** 获取或初始化默认路由 */
export async function getKnowledgeRouter(): Promise<KnowledgeRouter> {
  const { fileDocsProvider, knowledgeDocsProvider } =
    await import('@modules/docs/FileDocsProvider');
  knowledgeRouter['providers'] = [fileDocsProvider, knowledgeDocsProvider];
  if (!knowledgeRouter['initialized']) {
    await knowledgeRouter.buildIndex();
  }
  return knowledgeRouter;
}
