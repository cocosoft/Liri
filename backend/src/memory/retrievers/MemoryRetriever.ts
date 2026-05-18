import type { Memory } from '../types/Memory';
import { MemoryScannerImpl } from '../scanners/MemoryScanner';
import fs from 'fs';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 记忆检索器接口
 */
export interface MemoryRetriever {
  // 检索相关记忆
  retrieve(query: string, limit?: number): Promise<Memory[]>;

  // 按类型检索记忆
  retrieveByType(type: string, limit?: number): Promise<Memory[]>;

  // 扫描记忆目录
  scanMemoryDirectory(): Promise<void>;

  // 构建记忆索引
  buildMemoryIndex(): Promise<void>;

  // 搜索记忆
  searchMemories(pattern: string): Promise<Memory[]>;

  // 增量更新索引
  updateIndex(memory: Memory): void;

  // 从索引中移除记忆
  removeFromIndex(memoryId: string): void;

  // 保存索引到文件
  saveIndex(): Promise<void>;

  // 从文件加载索引
  loadIndex(): Promise<void>;
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
   * 构造函数
   * @param memoryDir 记忆目录路径
   */
  constructor(memoryDir: string = './data/memory') {
    this.memoryDir = memoryDir;
    this.indexFilePath = path.join(memoryDir, 'memory-index.json');
    this.scanner = new MemoryScannerImpl();
    this.memoryIndex = new Map();
    this.stemMap = new Map();

    // 尝试加载索引
    this.loadIndex().catch(() => {
      // 加载失败时不做处理，后续会重新构建
    });
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
  async retrieve(query: string, limit: number = 5): Promise<Memory[]> {
    if (this.memoryIndex.size === 0 && !this.indexLoaded) {
      await this.scanMemoryDirectory();
    }

    const scoredMemories: { memory: MemoryIndexItem; score: number }[] = [];

    for (const memory of this.memoryIndex.values()) {
      const score = this.calculateRelevanceScore(memory, query);
      if (score > 0.1) {
        scoredMemories.push({ memory, score });
      }
    }

    scoredMemories.sort((a, b) => b.score - a.score);

    const topMemories = scoredMemories.slice(0, limit);

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
      const indexData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        memories: Array.from(this.memoryIndex.values()),
      };

      fs.writeFileSync(this.indexFilePath, JSON.stringify(indexData, null, 2));
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
    try {
      if (fs.existsSync(this.indexFilePath)) {
        const content = fs.readFileSync(this.indexFilePath, 'utf8');
        const indexData = JSON.parse(content);

        if (indexData.memories && Array.isArray(indexData.memories)) {
          this.memoryIndex.clear();
          this.stemMap.clear();

          for (const memoryData of indexData.memories) {
            // 转换日期字符串为 Date 对象
            memoryData.createdAt = new Date(memoryData.createdAt);
            memoryData.updatedAt = new Date(memoryData.updatedAt);

            this.memoryIndex.set(memoryData.id, memoryData);
            this.updateStemMap(memoryData);
          }

          this.indexLoaded = true;
        }
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
}
