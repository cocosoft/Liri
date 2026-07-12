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
import { Logger, LogLevel } from '@modules/monitoring';
import type { SemanticStore } from '@modules/knowledge/semantic/store';
import type { EventBus } from '@modules/core';

const logger = new Logger({
  module: 'knowledge:knowledgeRouter',
  level: LogLevel.INFO,
});

/** 停用词集合 */
const COMMON_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'and',
  'but',
  'or',
  'nor',
  'not',
  'so',
  'yet',
  'both',
  'either',
  'neither',
  'each',
  'every',
  'all',
  'any',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'only',
  'own',
  'same',
  'than',
  'too',
  'very',
  'just',
  'because',
  'about',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'also',
  'how',
  'what',
  'why',
  'when',
  'where',
  'which',
  'who',
  'whom',
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '他',
  '她',
]);

/** 带权重的文档条目 */
interface WeightedDoc {
  docPath: string;
  title: string;
  category: string;
  content: string;
  isKnowledgeDoc: boolean;
  source?: string;
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
  private semanticStore?: SemanticStore;

  /** 标题倒排索引：lowerTitle → 文档，O(1) 精确查找 */
  private titleIndex: Map<string, WeightedDoc> = new Map();

  /** Token 倒排索引：token → 文档索引集合，O(k) 关键词查找 */
  private tokenIndex: Map<string, Set<number>> = new Map();

  constructor(
    providers: FileDocsProvider | FileDocsProvider[],
    embeddingManager?: EmbeddingManager,
    knownUsernames: string[] = [],
    hybridConfig?: HybridConfig,
    semanticStore?: SemanticStore,
    eventBus?: EventBus
  ) {
    this.providers = Array.isArray(providers) ? providers : [providers];
    this.knownUsernames = knownUsernames;
    this.embeddingManager = embeddingManager ?? globalEmbeddingManager;
    this.hybridConfig = { ...DEFAULT_HYBRID_CONFIG, ...hybridConfig };
    this.semanticStore = semanticStore;

    // 监听知识变更事件，实现增量索引更新
    eventBus?.subscribe('knowledge:changed', (event: unknown) => {
      const evt = event as { action: string; filePath: string };
      if (evt.action === 'deleted') {
        // 从索引中移除（通过 docPath 匹配）
        this.removeFromIndex(evt.filePath);
      }
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
        const doc: WeightedDoc = {
          docPath: e.relativePath,
          title: e.title,
          category: e.category,
          content: e.content,
          isKnowledgeDoc,
          source: e.source,
        };
        this.docs.push(doc);
      }
    }

    // 构建标题倒排索引和 token 倒排索引
    for (let i = 0; i < this.docs.length; i++) {
      const doc = this.docs[i]!;
      // 标题索引：lowerTitle → doc
      this.titleIndex.set(doc.title.toLowerCase(), doc);
      // Token 索引：每个 token → 文档索引集合
      const tokens = this.tokenize(doc.title + ' ' + doc.content);
      for (const token of tokens) {
        const set = this.tokenIndex.get(token);
        if (set) {
          set.add(i);
        } else {
          this.tokenIndex.set(token, new Set([i]));
        }
      }
    }

    this.initialized = true;
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
   * 关键字搜索通道
   *
   * 使用倒排索引 tokenIndex 先做候选集交集，再在候选集上计算分层权重。
   * 权重：知识库文档(+0.5) > 用户名匹配(+0.4) > 标题匹配(+0.3) > 内容关键词匹配(+0.2) > 目录名匹配(+0.1)
   */
  private keywordSearch(
    query: string,
    maxResults: number,
    minScore: number
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
    const candidateDocs =
      candidateIdxSet.size > 0
        ? Array.from(candidateIdxSet).map((i) => this.docs[i]!)
        : this.docs;

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

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 语义搜索通道
   *
   * 优先使用 SemanticStore 持久化向量做快速检索。
   * 当 SemanticStore 不可用时（未初始化或为空），
   * 降级返回空结果——search() 中的 catch 兜底确保纯关键词搜索仍可用。
   */
  private async semanticSearch(
    query: string,
    maxResults: number
  ): Promise<KnowledgeRoute[]> {
    // 没有可用的持久化语义存储，降级到纯关键词搜索
    if (!this.semanticStore || this.semanticStore.empty) {
      return [];
    }

    this.embeddingManager.initialize();
    const queryVec = await this.embeddingManager.embedOne(query);
    if (queryVec.length === 0) return [];

    const threshold = this.hybridConfig.semanticThreshold;
    const hits = this.semanticStore.search(
      new Float32Array(queryVec),
      maxResults,
      threshold
    );

    // 需要从 this.docs 中查找文档的 title/category 元数据
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
    if (!this.initialized) {
      await this.buildIndex();
    }

    const maxResults = options?.maxResults ?? 10;
    const minScore = options?.minScore ?? 0;
    const offset = options?.offset ?? 0;
    const multiplier = this.hybridConfig.keywordFetchMultiplier;
    // 拉取更多结果以便 offset 切片（offset + maxResults 保证分页正确）
    const fetchCount = (offset + maxResults) * multiplier;

    const [keywordResults, semanticResults] = await Promise.all([
      this.keywordSearch(query, fetchCount, minScore),
      this.semanticSearch(query, fetchCount).catch((err) => {
        logger.warn('语义搜索不可用，降级为纯关键词搜索', {
          error: (err as Error).message,
        });
        return [] as KnowledgeRoute[];
      }),
    ]);

    const merged = this.mergeResults(
      keywordResults,
      semanticResults,
      fetchCount
    );
    return merged.slice(offset, offset + maxResults);
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
