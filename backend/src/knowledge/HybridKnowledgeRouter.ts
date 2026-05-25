/**
 * 混合知识路由
 * 语义搜索（Embedding）+ 关键词搜索（倒排索引）双通道合并
 *
 * 架构：
 * - 关键词通道：委托 KnowledgeRouter.search()，使用倒排索引 + 分层权重
 * - 语义通道：使用 EmbeddingService 将文档向量化，余弦相似度检索
 * - 合并策略：两路结果去重合并，归一化分数后加权排序
 */

import { KnowledgeRouter } from '../docs/KnowledgeRouter';
import type {
  KnowledgeRoute,
  KnowledgeRouterOptions,
  IKnowledgeSearch,
} from '../docs/KnowledgeRouter';
import type { FileDocsProvider } from '../docs/FileDocsProvider';
import { EmbeddingService } from '../memory/services/EmbeddingService';
import { Logger, LogLevel } from '../monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 向量索引条目 */
interface VectorIndexEntry {
  docPath: string;
  title: string;
  category: string;
  snippet: string;
  isKnowledgeDoc: boolean;
  vector: number[];
}

/** 混合搜索配置 */
export interface HybridSearchConfig {
  /** 关键词搜索权重（默认 0.4） */
  keywordWeight?: number;
  /** 语义搜索权重（默认 0.6） */
  semanticWeight?: number;
  /** 语义匹配最低阈值（默认 0.3，低于此值的语义结果不纳入合并） */
  semanticThreshold?: number;
  /** 关键词通道额外获取倍数（默认 3，即获取 maxResults*3 给合并排序使用） */
  keywordFetchMultiplier?: number;
}

const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  keywordWeight: 0.4,
  semanticWeight: 0.6,
  semanticThreshold: 0.3,
  keywordFetchMultiplier: 3,
};

export class HybridKnowledgeRouter implements IKnowledgeSearch {
  private keywordRouter: KnowledgeRouter;
  private embeddingService: EmbeddingService;
  private providers: FileDocsProvider[];
  private vectorIndex: VectorIndexEntry[] = [];
  private initialized: boolean = false;
  private hybridConfig: HybridSearchConfig;

  constructor(
    providers: FileDocsProvider | FileDocsProvider[],
    embeddingService?: EmbeddingService,
    knownUsernames?: string[],
    hybridConfig?: HybridSearchConfig
  ) {
    this.providers = Array.isArray(providers) ? providers : [providers];
    this.keywordRouter = new KnowledgeRouter(this.providers, knownUsernames);
    this.embeddingService =
      embeddingService ??
      new EmbeddingService({
        defaultModel: 'local-simple',
      });
    this.hybridConfig = { ...DEFAULT_HYBRID_CONFIG, ...hybridConfig };
  }

  setKnownUsernames(usernames: string[]): void {
    this.keywordRouter.setKnownUsernames(usernames);
  }

  /** 双通道索引构建 */
  async buildIndex(): Promise<void> {
    await this.keywordRouter.buildIndex();
    await this.buildVectorIndex();
    this.initialized = true;
    logger.info('混合知识路由索引构建完成', {
      vectorCount: this.vectorIndex.length,
    });
  }

  /** 构建向量索引 */
  private async buildVectorIndex(): Promise<void> {
    this.vectorIndex = [];

    const docs: Array<{
      docPath: string;
      title: string;
      category: string;
      content: string;
      isKnowledgeDoc: boolean;
    }> = [];
    for (const provider of this.providers) {
      const entries = await provider.buildIndex();
      for (const e of entries) {
        const isKnowledgeDoc = e.source?.includes('.pyapp') ?? false;
        docs.push({
          docPath: e.relativePath,
          title: e.title,
          category: e.category,
          content: e.content,
          isKnowledgeDoc,
        });
      }
    }

    if (docs.length === 0) return;

    const texts = docs.map((d) =>
      `${d.title}\n${d.content}`.substring(0, 8000)
    );
    const embeddings = await this.embeddingService.embedBatch(texts);

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const firstLine = doc.content
        .split('\n')
        .find((l) => l.trim().length > 0);
      this.vectorIndex.push({
        docPath: doc.docPath,
        title: doc.title,
        category: doc.category,
        snippet: firstLine ? firstLine.trim().slice(0, 120) : '',
        isKnowledgeDoc: doc.isKnowledgeDoc,
        vector: embeddings[i].vector,
      });
    }
  }

  /** 语义搜索通道 */
  private async semanticSearch(query: string): Promise<KnowledgeRoute[]> {
    if (this.vectorIndex.length === 0) return [];

    const queryEmb = await this.embeddingService.embed(query);
    const threshold = this.hybridConfig.semanticThreshold ?? 0.3;

    const results: KnowledgeRoute[] = [];

    for (const entry of this.vectorIndex) {
      const similarity = this.cosineSimilarity(queryEmb.vector, entry.vector);
      if (similarity >= threshold) {
        results.push({
          docPath: entry.docPath,
          title: entry.title,
          score: Math.round(similarity * 100) / 100,
          category: entry.category,
          snippet: entry.snippet,
          matchType: 'semantic',
          isKnowledgeDoc: entry.isKnowledgeDoc,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
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

  /** 对关键词结果进行归一化处理 */
  private normalizeKeywordResults(results: KnowledgeRoute[]): KnowledgeRoute[] {
    if (results.length === 0) return results;
    const maxScore = Math.max(...results.map((r) => r.score));
    if (maxScore === 0) return results;
    return results.map((r) => ({
      ...r,
      score: r.score / maxScore,
    }));
  }

  /** 双通道结果合并与排序 */
  private mergeAndRank(
    keywordResults: KnowledgeRoute[],
    semanticResults: KnowledgeRoute[],
    maxResults: number
  ): KnowledgeRoute[] {
    const kw = this.hybridConfig.keywordWeight ?? 0.4;
    const sm = this.hybridConfig.semanticWeight ?? 0.6;

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

  /** 双通道混合搜索 */
  async search(
    query: string,
    options?: KnowledgeRouterOptions
  ): Promise<KnowledgeRoute[]> {
    if (!this.initialized) {
      await this.buildIndex();
    }

    const maxResults = options?.maxResults ?? 10;
    const multiplier = this.hybridConfig.keywordFetchMultiplier ?? 3;
    const keywordFetchCount = maxResults * multiplier;

    const [keywordResults, semanticResults] = await Promise.all([
      this.keywordRouter.search(query, {
        maxResults: keywordFetchCount,
        minScore: options?.minScore,
      }),
      this.semanticSearch(query),
    ]);

    return this.mergeAndRank(keywordResults, semanticResults, maxResults);
  }

  /** 获取文档内容（委托给 KnowledgeRouter） */
  async getDocContent(docPath: string): Promise<string | null> {
    return this.keywordRouter.getDocContent(docPath);
  }

  /** 获取分类列表（委托给 KnowledgeRouter） */
  async getCategories(): Promise<string[]> {
    return this.keywordRouter.getCategories();
  }

  /** 重建向量索引（知识变更后调用） */
  async refreshVectorIndex(): Promise<void> {
    await this.buildVectorIndex();
    logger.info('向量索引已刷新', { count: this.vectorIndex.length });
  }
}

/** 默认单例（延迟初始化） */
let _hybridRouter: HybridKnowledgeRouter | null = null;

/** 获取或初始化混合路由 */
export async function getHybridKnowledgeRouter(): Promise<HybridKnowledgeRouter> {
  if (!_hybridRouter) {
    const { fileDocsProvider, knowledgeDocsProvider } =
      await import('../docs/FileDocsProvider');
    _hybridRouter = new HybridKnowledgeRouter(
      [fileDocsProvider, knowledgeDocsProvider],
      undefined,
      [],
      { keywordWeight: 0.4, semanticWeight: 0.6 }
    );
    await _hybridRouter.buildIndex();
  } else if (!_hybridRouter['initialized']) {
    await _hybridRouter.buildIndex();
  }
  return _hybridRouter;
}
