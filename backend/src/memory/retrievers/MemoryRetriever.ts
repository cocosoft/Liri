import type { Memory } from '../types/Memory';
import { MemoryScannerImpl } from '../scanners/MemoryScanner';
import fs from 'fs/promises';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { EmbeddingService } from '../services/EmbeddingService';
import { existsSync, readFileSync } from 'fs';
import { MemoryPrefetchQueue } from '../services/MemoryPrefetchQueue';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 余弦相似度计算
 */
export function cosineSimilarity(a: number[], b: number[]): number {
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
 * MMR（最大边界相关）多样化配置
 * 在搜索结果中平衡相关性与多样性
 */
export interface MMRConfig {
  enabled: boolean;
  lambda: number; // 0.0=纯多样性, 1.0=纯相关性
}

/**
 * 时序衰减配置
 * 使用半衰期模型对记忆进行时间衰减
 */
export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number; // 半衰期天数
  minScore: number; // 最低保留分数
}

/**
 * 记忆搜索配置
 * 控制记忆检索行为与搜索参数
 */
export interface MemorySearchConfig {
  sources: Array<'memory' | 'sessions'>;
  query: {
    maxResults: number;
    minScore: number;
    hybrid?: {
      enabled: boolean;
      vectorWeight: number;
      textWeight: number;
    };
    mmr?: MMRConfig;
    temporalDecay?: TemporalDecayConfig;
  };
  cache: {
    enabled: boolean;
    maxEntries: number;
  };
}

export const MEMORY_SEARCH_DEFAULTS: MemorySearchConfig = {
  sources: ['memory'],
  query: {
    maxResults: 6,
    minScore: 0.35,
    hybrid: {
      enabled: true,
      vectorWeight: 0.5,
      textWeight: 0.5,
    },
    mmr: {
      enabled: false,
      lambda: 0.5,
    },
    temporalDecay: {
      enabled: false,
      halfLifeDays: 30,
      minScore: 0.1,
    },
  },
  cache: {
    enabled: true,
    maxEntries: 1000,
  },
};

/**
 * 从用户设置加载记忆搜索配置
 * 优先级：settings.json.memory.search > MEMORY_SEARCH_DEFAULTS
 */
export function loadMemorySearchConfig(): MemorySearchConfig {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  const settingsPath = path.join(homeDir, '.pyapp', 'settings.json');

  try {
    if (!existsSync(settingsPath)) {
      return MEMORY_SEARCH_DEFAULTS;
    }
    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const searchConfig = settings?.memory?.search;
    if (!searchConfig) {
      return MEMORY_SEARCH_DEFAULTS;
    }
    return {
      ...MEMORY_SEARCH_DEFAULTS,
      ...searchConfig,
      query: {
        ...MEMORY_SEARCH_DEFAULTS.query,
        ...(searchConfig.query || {}),
        hybrid: {
          ...MEMORY_SEARCH_DEFAULTS.query.hybrid!,
          ...(searchConfig.query?.hybrid || {}),
        },
        mmr: {
          ...MEMORY_SEARCH_DEFAULTS.query.mmr!,
          ...(searchConfig.query?.mmr || {}),
        },
        temporalDecay: {
          ...MEMORY_SEARCH_DEFAULTS.query.temporalDecay!,
          ...(searchConfig.query?.temporalDecay || {}),
        },
      },
      cache: {
        ...MEMORY_SEARCH_DEFAULTS.cache,
        ...(searchConfig.cache || {}),
      },
    };
  } catch {
    return MEMORY_SEARCH_DEFAULTS;
  }
}

/**
 * 相似搜索结果
 */
export interface SimilarMemoryResult {
  memory: Memory;
  similarity: number; // 0-1 余弦相似度
}

/**
 * 记忆检索器接口
 */
export interface MemoryRetriever {
  retrieve(query: string, limit?: number): Promise<Memory[]>;

  retrieveByType(type: string, limit?: number): Promise<Memory[]>;

  scanMemoryDirectory(): Promise<void>;

  buildMemoryIndex(): Promise<void>;

  searchMemories(pattern: string): Promise<Memory[]>;

  updateIndex(memory: Memory): void;

  removeFromIndex(memoryId: string): void;

  saveIndex(): Promise<void>;

  loadIndex(): Promise<void>;

  retrieveBySimilarity(
    query: string,
    limit?: number,
    threshold?: number
  ): Promise<SimilarMemoryResult[]>;

  hybridSearch(query: string, limit?: number): Promise<Memory[]>;
}

/**
 * 记忆索引项
 */
interface MemoryIndexItem {
  id: string;
  name: string;
  description: string;
  content: string;
  type: string;
  tags: string[];
  priority: number;
  expiresAt?: Date;
  author?: string;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
  // 预计算的索引数据
  nameTokens: string[];
  contentTokens: string[];
  tagTokens: string[];
}

/**
 * 记忆检索器实现
 */
export class MemoryRetrieverImpl implements MemoryRetriever {
  /**
   * 记忆目录路径
   */
  private memoryDir: string;

  /**
   * 索引文件路径
   */
  private indexFilePath: string;

  /**
   * 记忆扫描器
   */
  private scanner: MemoryScannerImpl;

  /**
   * 记忆索引
   */
  private memoryIndex: Map<string, MemoryIndexItem>;

  /**
   * 词干映射（用于模糊匹配）
   */
  private stemMap: Map<string, string[]>;

  /**
   * 索引是否已加载
   */
  private indexLoaded: boolean = false;

  /**
   * 嵌入服务（可选，用于语义搜索）
   */
  private embeddingService?: EmbeddingService;

  /**
   * 向量缓存
   */
  private vectorCache: Map<string, { vector: number[]; model: string }> =
    new Map();

  /**
   * 搜索配置
   */
  private searchConfig: MemorySearchConfig;

  /**
   * 预取队列
   */
  private prefetchQueue?: MemoryPrefetchQueue;

  /**
   * 构造函数
   * @param memoryDir 记忆目录路径
   * @param embeddingService 可选的嵌入服务
   * @param searchConfig 可选的搜索配置（默认使用 MEMORY_SEARCH_DEFAULTS）
   */
  constructor(
    memoryDir: string = './data/memory',
    embeddingService?: EmbeddingService,
    searchConfig?: MemorySearchConfig
  ) {
    this.memoryDir = memoryDir;
    this.indexFilePath = path.join(memoryDir, 'memory-index.json');
    this.scanner = new MemoryScannerImpl();
    this.memoryIndex = new Map();
    this.stemMap = new Map();
    this.embeddingService = embeddingService;
    this.searchConfig = searchConfig ?? loadMemorySearchConfig();

    // 尝试加载索引
    this.loadIndex().catch(() => {
      // 加载失败时不做处理，后续会重新构建
    });
  }

  /**
   * 更新搜索配置（运行时修改）
   */
  setSearchConfig(config: Partial<MemorySearchConfig>): void {
    this.searchConfig = {
      ...this.searchConfig,
      ...config,
      query: {
        ...this.searchConfig.query,
        ...(config.query || {}),
        hybrid: {
          ...this.searchConfig.query.hybrid!,
          ...(config.query?.hybrid || {}),
        },
        mmr: {
          ...this.searchConfig.query.mmr!,
          ...(config.query?.mmr || {}),
        },
        temporalDecay: {
          ...this.searchConfig.query.temporalDecay!,
          ...(config.query?.temporalDecay || {}),
        },
      },
      cache: {
        ...this.searchConfig.cache,
        ...(config.cache || {}),
      },
    };
  }

  /**
   * 设置嵌入服务
   */
  setEmbeddingService(embeddingService: EmbeddingService): void {
    this.embeddingService = embeddingService;
  }

  /**
   * 启用异步预取
   * 启动后台预取队列，自动缓存未命中向量
   */
  enablePrefetch(
    config?: Partial<
      import('../services/MemoryPrefetchQueue').PrefetchQueueConfig
    >
  ): void {
    if (!this.embeddingService) {
      logger.warn('EmbeddingService 未配置，无法启用预取');
      return;
    }
    if (this.prefetchQueue) {
      this.prefetchQueue.stop();
    }
    this.prefetchQueue = new MemoryPrefetchQueue(config);
    this.prefetchQueue.start();
  }

  /**
   * 禁用异步预取
   */
  disablePrefetch(): void {
    if (this.prefetchQueue) {
      this.prefetchQueue.stop();
      this.prefetchQueue.clear();
      this.prefetchQueue = undefined;
    }
  }

  /**
   * 触发全量向量预取
   * 为所有未缓存的记忆生成向量嵌入
   */
  async prefetchVectorsForAll(): Promise<void> {
    if (!this.embeddingService || !this.prefetchQueue) return;

    const items = Array.from(this.memoryIndex.values());
    const executor = (id: string) => this.prefetchVectorForItem(id);
    const batch = items
      .filter((item) => !this.vectorCache.has(item.id))
      .map((item) => ({
        id: item.id,
        priority: item.priority,
      }));

    this.prefetchQueue.enqueueBatch(batch, executor);
  }

  /**
   * 为单个记忆项预取向量
   */
  private async prefetchVectorForItem(itemId: string): Promise<void> {
    if (!this.embeddingService) return;
    if (this.vectorCache.has(itemId)) return;

    const item = this.memoryIndex.get(itemId);
    if (!item) return;

    const textToEmbed =
      `${item.name} ${item.description} ${item.content}`.substring(0, 8000);
    const emb = await this.embeddingService.embed(textToEmbed);
    this.vectorCache.set(itemId, { vector: emb.vector, model: emb.model });
  }

  /**
   * 余弦相似度计算
   */
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
   * 应用时序衰减（半衰期模型）
   * score_adj = score * 2^(-age / halfLifeDays)
   * @param results 相似搜索结果
   * @param config 时序衰减配置
   */
  static applyTemporalDecay(
    results: SimilarMemoryResult[],
    config: TemporalDecayConfig
  ): void {
    if (!config.enabled || results.length === 0) return;

    const now = Date.now();
    for (const result of results) {
      const updatedAt = result.memory.updatedAt ?? result.memory.createdAt;
      const ageMs = now - updatedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayFactor = Math.pow(2, -ageDays / config.halfLifeDays);
      const adjustedScore = result.similarity * decayFactor;
      result.similarity = Math.max(adjustedScore, config.minScore);
    }
  }

  /**
   * 应用 MMR（最大边界相关）多样化重排序
   * 平衡相关性与多样性，防止结果过于相似
   * MMR = λ * Sim(q, d_i) - (1-λ) * max_{j∈S} Sim(d_i, d_j)
   * @param results 候选结果列表
   * @param queryEmbedding 查询向量
   * @param lambda MMR λ 参数（0=纯多样性, 1=纯相关性）
   * @param limit 返回数量
   * @param embeddingService 嵌入服务（用于计算记忆间相似度）
   * @returns MMR 重排序后的结果
   */
  static async applyMMR(
    results: SimilarMemoryResult[],
    queryEmbedding: number[],
    lambda: number,
    limit: number,
    embeddingService: EmbeddingService
  ): Promise<SimilarMemoryResult[]> {
    if (!lambda || results.length <= limit) return results;

    const selected: SimilarMemoryResult[] = [];
    const candidateIndices = new Set(results.keys());

    let chosenIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < results.length; i++) {
      const sim = results[i].similarity;
      if (sim > bestScore) {
        bestScore = sim;
        chosenIdx = i;
      }
    }
    selected.push(results[chosenIdx]);
    candidateIndices.delete(chosenIdx);

    while (selected.length < limit && candidateIndices.size > 0) {
      let bestCandidateIdx = -1;
      let bestMMRScore = -Infinity;

      for (const i of candidateIndices) {
        const relevanceScore = results[i].similarity;
        const textA = `${results[i].memory.content} ${results[i].memory.metadata.name}`;
        const textAEmb = await embeddingService.embed(textA);
        let maxSimilarity = 0;

        for (const sel of selected) {
          const textB = `${sel.memory.content} ${sel.memory.metadata.name}`;
          const textBEmb = await embeddingService.embed(textB);
          const sim = cosineSimilarity(textAEmb.vector, textBEmb.vector);
          if (sim > maxSimilarity) maxSimilarity = sim;
        }

        const mmrScore = lambda * relevanceScore - (1 - lambda) * maxSimilarity;

        if (mmrScore > bestMMRScore) {
          bestMMRScore = mmrScore;
          bestCandidateIdx = i;
        }
      }

      if (bestCandidateIdx === -1) break;
      selected.push(results[bestCandidateIdx]);
      candidateIndices.delete(bestCandidateIdx);
    }

    return selected;
  }

  /**
   * 从索引项构建 Memory 对象
   */
  private indexItemToMemory(item: MemoryIndexItem): Memory {
    return {
      id: item.id,
      content: item.content,
      metadata: {
        name: item.name,
        description: item.description,
        type: item.type,
        tags: item.tags,
        priority: item.priority,
        expiresAt: item.expiresAt,
        author: item.author,
        source: item.source,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  /**
   * 扫描记忆目录
   */
  async scanMemoryDirectory(): Promise<void> {
    const memories = await this.scanner.scan(this.memoryDir);
    this.buildMemoryIndexFromMemories(memories);
    await this.saveIndex();
  }

  /**
   * 构建记忆索引
   */
  async buildMemoryIndex(): Promise<void> {
    await this.scanMemoryDirectory();
  }

  /**
   * 从记忆列表构建索引
   * @param memories 记忆列表
   */
  private buildMemoryIndexFromMemories(memories: Memory[]): void {
    this.memoryIndex.clear();
    this.stemMap.clear();

    for (const memory of memories) {
      this.updateIndex(memory);
    }

    this.indexLoaded = true;
  }

  /**
   * 增量更新索引
   * @param memory 记忆对象
   */
  updateIndex(memory: Memory): void {
    const indexItem: MemoryIndexItem = {
      id: memory.id,
      name: memory.metadata.name,
      description: memory.metadata.description,
      content: memory.content,
      type: memory.metadata.type,
      tags: memory.metadata.tags || [],
      priority: memory.metadata.priority || 0,
      expiresAt: memory.metadata.expiresAt,
      author: memory.metadata.author,
      source: memory.metadata.source,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      nameTokens: this.tokenize(memory.metadata.name),
      contentTokens: this.tokenize(memory.content),
      tagTokens: memory.metadata.tags
        ? memory.metadata.tags.flatMap((tag) => this.tokenize(tag))
        : [],
    };

    this.memoryIndex.set(memory.id, indexItem);

    // 更新词干映射
    this.updateStemMap(indexItem);
  }

  /**
   * 从索引中移除记忆
   * @param memoryId 记忆ID
   */
  removeFromIndex(memoryId: string): void {
    const memory = this.memoryIndex.get(memoryId);
    if (memory) {
      this.memoryIndex.delete(memoryId);
      // 这里可以添加清理词干映射的逻辑，但为了简单起见暂时省略
    }
  }

  /**
   * CJK 字符正则（汉字范围）
   */
  private static readonly CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

  /**
   * 判断是否为纯 ASCII 字符（字母/数字）
   */
  private static readonly ASCII_ALPHA_RE = /^[a-zA-Z0-9]+$/;

  /**
   * 分词
   * ASCII 部分沿用原有空格拆分；CJK 字符按单字+双字拆分，零依赖
   * @param text 文本
   * @returns 分词结果
   */
  private tokenize(text: string | undefined | null): string[] {
    if (!text) return [];

    const tokens: string[] = [];
    const lowerText = text.toLowerCase();

    // 1) ASCII 词：保留字母数字，过滤非 ASCII 符号
    const asciiTokens = lowerText
      .replace(/[^\x20-\x7e]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
    // ASCII 单字母（a/i 等）视为噪声过滤，但保留数字和双字母以上
    for (const t of asciiTokens) {
      if (t.length === 1 && !/^[0-9]$/.test(t)) continue;
      if (t.length > 1 || /^[0-9]$/.test(t)) tokens.push(t);
    }

    // 2) CJK 拆分：提取所有中文字符
    const cjkChars = [...lowerText].filter((ch) =>
      MemoryRetrieverImpl.CJK_RE.test(ch)
    );
    if (cjkChars.length > 0) {
      // 单字（unigram）—— 每个汉字都有独立语义
      tokens.push(...cjkChars);
      // 双字（bigram）
      for (let i = 0; i < cjkChars.length - 1; i++) {
        tokens.push(cjkChars[i] + cjkChars[i + 1]);
      }
    }

    return [...new Set(tokens)];
  }

  /**
   * 更新词干映射
   * @param memory 记忆索引项
   */
  private updateStemMap(memory: MemoryIndexItem): void {
    const allTokens = [
      ...memory.nameTokens,
      ...memory.contentTokens,
      ...memory.tagTokens,
    ];

    for (const token of allTokens) {
      const stem = this.getStem(token);
      if (!this.stemMap.has(stem)) {
        this.stemMap.set(stem, []);
      }
      this.stemMap.get(stem)?.push(memory.id);
    }
  }

  /**
   * 获取词干
   * CJK 字符不适用词干提取，直接返回原词
   * @param word 单词
   * @returns 词干
   */
  private getStem(word: string): string {
    // CJK 字符跳过词干提取
    if (MemoryRetrieverImpl.CJK_RE.test(word)) return word;
    // 简单的词干提取算法
    if (word.endsWith('ing')) return word.slice(0, -3);
    if (word.endsWith('ed')) return word.slice(0, -2);
    if (word.endsWith('s')) return word.slice(0, -1);
    if (word.endsWith('ly')) return word.slice(0, -2);
    return word;
  }

  /**
   * 计算记忆与查询的相关性得分
   * @param memory 记忆索引项
   * @param query 查询字符串
   * @returns 相关性得分
   */
  private calculateRelevanceScore(
    memory: MemoryIndexItem,
    query: string
  ): number {
    let score = 0;
    const queryLower = query.toLowerCase();
    const queryTokens = this.tokenize(query);

    // 检查名称
    const nameScore = this.calculateTokenScore(memory.nameTokens, queryTokens);
    score += nameScore * 3; // 名称权重最高

    // 检查描述
    const descriptionScore = this.calculateTokenScore(
      this.tokenize(memory.description),
      queryTokens
    );
    score += descriptionScore * 2;

    // 检查内容
    const contentScore = this.calculateTokenScore(
      memory.contentTokens,
      queryTokens
    );
    score += contentScore * 1;

    // 检查标签
    const tagScore = this.calculateTokenScore(memory.tagTokens, queryTokens);
    score += tagScore * 2.5;

    // 检查类型
    const typeScore = this.calculateTokenScore(
      this.tokenize(memory.type),
      queryTokens
    );
    score += typeScore * 1.5;

    // 时间衰减因子
    const now = new Date();
    const ageInDays =
      (now.getTime() - memory.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    const timeFactor = Math.max(0.1, 1 - ageInDays / 30); // 30天后衰减到10%

    // 长度因子（优先选择较短的记忆）
    const lengthFactor = Math.max(0.5, 1 - memory.content.length / 5000);

    return score * timeFactor * lengthFactor;
  }

  /**
   * 计算 token 匹配得分
   * @param memoryTokens 记忆 tokens
   * @param queryTokens 查询 tokens
   * @returns 得分
   */
  private calculateTokenScore(
    memoryTokens: string[],
    queryTokens: string[]
  ): number {
    if (queryTokens.length === 0) return 0;

    let matchedTokens = 0;
    const memoryTokenSet = new Set(memoryTokens);

    for (const token of queryTokens) {
      // 精确匹配
      if (memoryTokenSet.has(token)) {
        matchedTokens++;
      } else {
        // 词干匹配
        const stem = this.getStem(token);
        const memoryStems = new Set(memoryTokens.map((t) => this.getStem(t)));
        if (memoryStems.has(stem)) {
          matchedTokens += 0.7; // 词干匹配得分稍低
        }
      }
    }

    return matchedTokens / queryTokens.length;
  }

  /**
   * 检索相关记忆
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @returns 相关记忆列表
   */
  async retrieve(query: string, limit?: number): Promise<Memory[]> {
    if (this.memoryIndex.size === 0 && !this.indexLoaded) {
      await this.scanMemoryDirectory();
    }

    const resultLimit = limit ?? this.searchConfig.query.maxResults;
    const minScore = this.searchConfig.query.minScore;
    const scoredMemories: { memory: MemoryIndexItem; score: number }[] = [];

    for (const memory of this.memoryIndex.values()) {
      const score = this.calculateRelevanceScore(memory, query);
      if (score > minScore) {
        scoredMemories.push({ memory, score });
      }
    }

    scoredMemories.sort((a, b) => b.score - a.score);

    const topMemories = scoredMemories.slice(0, resultLimit);

    const memories: Memory[] = [];
    for (const { memory } of topMemories) {
      memories.push({
        id: memory.id,
        content: memory.content,
        metadata: {
          name: memory.name,
          description: memory.description,
          type: memory.type,
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
          tags: memory.tags,
          priority: memory.priority,
          expiresAt: memory.expiresAt,
          author: memory.author,
          source: memory.source,
        },
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      });
    }

    return memories;
  }

  /**
   * 按类型检索记忆
   * @param type 记忆类型
   * @param limit 返回数量限制
   * @returns 指定类型的记忆列表
   */
  async retrieveByType(type: string, limit: number = 10): Promise<Memory[]> {
    if (this.memoryIndex.size === 0 && !this.indexLoaded) {
      await this.scanMemoryDirectory();
    }

    const typedMemories: Memory[] = [];

    for (const memory of this.memoryIndex.values()) {
      if (memory.type === type) {
        typedMemories.push({
          id: memory.id,
          content: memory.content,
          metadata: {
            name: memory.name,
            description: memory.description,
            type: memory.type,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            tags: memory.tags,
            priority: memory.priority,
            expiresAt: memory.expiresAt,
            author: memory.author,
            source: memory.source,
          },
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
        });
      }
    }

    typedMemories.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return typedMemories.slice(0, limit);
  }

  /**
   * 搜索记忆
   * @param pattern 搜索模式
   * @returns 匹配的记忆列表
   */
  async searchMemories(pattern: string): Promise<Memory[]> {
    // 如果索引为空，先扫描目录
    if (this.memoryIndex.size === 0 && !this.indexLoaded) {
      await this.scanMemoryDirectory();
    }

    const regex = new RegExp(pattern, 'i');
    const matchingMemories: Memory[] = [];

    for (const memory of this.memoryIndex.values()) {
      if (
        regex.test(memory.name) ||
        regex.test(memory.description) ||
        regex.test(memory.content) ||
        memory.tags.some((tag) => regex.test(tag))
      ) {
        matchingMemories.push({
          id: memory.id,
          content: memory.content,
          metadata: {
            name: memory.name,
            description: memory.description,
            type: memory.type,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            tags: memory.tags,
            priority: memory.priority,
            expiresAt: memory.expiresAt,
            author: memory.author,
            source: memory.source,
          },
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
        });
      }
    }

    return matchingMemories;
  }

  /**
   * 保存索引到文件
   */
  async saveIndex(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.indexFilePath), { recursive: true });
      const indexData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        memories: Array.from(this.memoryIndex.values()),
      };

      await fs.writeFile(
        this.indexFilePath,
        JSON.stringify(indexData, null, 2),
        'utf8'
      );
    } catch (error) {
      logger.error(
        'Error saving memory index',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 从文件加载索引
   */
  async loadIndex(): Promise<void> {
    // 如果内存索引已通过扫描加载，跳过加载以避免覆盖
    if (this.memoryIndex.size > 0) {
      this.indexLoaded = true;
      return;
    }

    try {
      try {
        await fs.access(this.indexFilePath);
      } catch {
        return;
      }

      const content = await fs.readFile(this.indexFilePath, 'utf8');
      const indexData = JSON.parse(content);

      if (indexData.memories && Array.isArray(indexData.memories)) {
        this.memoryIndex.clear();
        this.stemMap.clear();

        for (const memoryData of indexData.memories) {
          memoryData.createdAt = new Date(memoryData.createdAt);
          memoryData.updatedAt = new Date(memoryData.updatedAt);
          if (memoryData.expiresAt) {
            memoryData.expiresAt = new Date(memoryData.expiresAt);
          }

          this.memoryIndex.set(memoryData.id, memoryData);
          this.updateStemMap(memoryData);
        }

        this.indexLoaded = true;
      }
    } catch (error) {
      logger.error(
        'Error loading memory index',
        error instanceof Error ? error : new Error(String(error))
      );
      this.indexLoaded = false;
    }
  }

  /**
   * 获取记忆索引
   * @returns 记忆索引
   */
  getMemoryIndex(): Map<string, MemoryIndexItem> {
    return this.memoryIndex;
  }

  /**
   * 清除记忆索引
   */
  clearMemoryIndex(): void {
    this.memoryIndex.clear();
    this.stemMap.clear();
    this.indexLoaded = false;
  }

  /**
   * 获取索引大小
   * @returns 索引大小
   */
  getIndexSize(): number {
    return this.memoryIndex.size;
  }

  /**
   * 语义相似度搜索
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @param threshold 相似度阈值（0-1）
   * @returns 排序后的相似记忆结果
   */
  async retrieveBySimilarity(
    query: string,
    limit?: number,
    threshold?: number
  ): Promise<SimilarMemoryResult[]> {
    if (this.memoryIndex.size === 0 && !this.indexLoaded) {
      await this.scanMemoryDirectory();
    }

    if (!this.embeddingService) {
      logger.warn('EmbeddingService 未配置，无法进行语义搜索');
      return [];
    }

    const resultLimit = limit ?? this.searchConfig.query.maxResults;
    const minScore = threshold ?? this.searchConfig.query.minScore;
    const queryEmb = await this.embeddingService.embed(query);
    const results: SimilarMemoryResult[] = [];

    for (const item of this.memoryIndex.values()) {
      const memory = this.indexItemToMemory(item);
      const textToEmbed =
        `${item.name} ${item.description} ${item.content}`.substring(0, 8000);

      let vector: number[];
      const cached = this.vectorCache.get(item.id);
      if (cached) {
        vector = cached.vector;
      } else {
        const emb = await this.embeddingService.embed(textToEmbed);
        vector = emb.vector;
        this.vectorCache.set(item.id, { vector, model: emb.model });
      }

      const similarity = this.cosineSimilarity(queryEmb.vector, vector);
      if (similarity >= minScore) {
        results.push({ memory, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    // 触发后台预取：为未缓存的记忆项入队向量嵌入任务
    if (this.prefetchQueue && this.embeddingService) {
      const uncached = Array.from(this.memoryIndex.values())
        .filter((item) => !this.vectorCache.has(item.id))
        .map((item) => ({
          id: item.id,
          priority: item.priority,
        }));
      if (uncached.length > 0) {
        this.prefetchQueue.enqueueBatch(uncached, (id) =>
          this.prefetchVectorForItem(id)
        );
      }
    }

    return results.slice(0, resultLimit);
  }

  /**
   * 混合搜索（关键词+语义）
   * 使用配置中的 vectorWeight / textWeight 进行加权合并
   * @param query 查询字符串
   * @param limit 返回数量限制
   * @returns 排序后的记忆列表
   */
  async hybridSearch(query: string, limit?: number): Promise<Memory[]> {
    const resultLimit = limit ?? this.searchConfig.query.maxResults;
    const hybridConfig = this.searchConfig.query.hybrid;
    const keywordResults = await this.retrieve(query, resultLimit * 2);

    if (!hybridConfig?.enabled || !this.embeddingService) {
      return keywordResults.slice(0, resultLimit);
    }

    const semanticResults = await this.retrieveBySimilarity(
      query,
      resultLimit * 2
    );
    const { vectorWeight, textWeight } = hybridConfig;

    const scoreMap = new Map<
      string,
      { memory: Memory; keywordScore: number }
    >();

    for (let i = 0; i < keywordResults.length; i++) {
      const mem = keywordResults[i];
      const normalized =
        keywordResults.length > 1 ? 1 - i / (keywordResults.length - 1) : 1;
      scoreMap.set(mem.id, { memory: mem, keywordScore: normalized });
    }

    const semanticScoreMap = new Map<string, number>();
    const allResults: Memory[] = [];

    for (const { memory: mem, similarity } of semanticResults) {
      semanticScoreMap.set(mem.id, similarity);
      if (!scoreMap.has(mem.id)) {
        scoreMap.set(mem.id, { memory: mem, keywordScore: 0 });
      }
    }

    for (const { memory: mem } of semanticResults) {
      if (!allResults.find((m) => m.id === mem.id)) {
        allResults.push(mem);
      }
    }
    for (let i = 0; i < keywordResults.length; i++) {
      if (!allResults.find((m) => m.id === keywordResults[i].id)) {
        allResults.push(keywordResults[i]);
      }
    }

    const scoredResults: { memory: Memory; score: number }[] = [];

    for (const mem of allResults) {
      const entry = scoreMap.get(mem.id);
      const keywordScore = entry?.keywordScore ?? 0;
      const semanticScore = semanticScoreMap.get(mem.id) ?? 0;
      const score = textWeight * keywordScore + vectorWeight * semanticScore;
      scoredResults.push({ memory: mem, score });
    }

    scoredResults.sort((a, b) => b.score - a.score);
    return scoredResults.slice(0, resultLimit).map((c) => c.memory);
  }
}
