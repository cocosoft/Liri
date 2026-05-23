/**
 * SQLite FTS5 全文搜索服务
 * 对标 Hermes hermes_state.py 的 FTS5 搜索能力
 * 将全文搜索引入会话和记忆搜索
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 搜索文档
 */
export interface FTSDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 搜索结果
 */
export interface FTSSearchResult {
  document: FTSDocument;
  score: number;
  snippet: string;
}

/**
 * FTS5 搜索配置
 */
export interface FTSConfig {
  dbPath: string;
  maxResults: number;
  snippetLength: number;
  cacheEnabled: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: FTSConfig = {
  dbPath: './data/fts.db',
  maxResults: 50,
  snippetLength: 200,
  cacheEnabled: true,
};

/**
 * FTS5 全文搜索引擎
 * 纯 TypeScript 实现，无需 SQLite C 扩展
 * 使用内存倒排索引模拟 FTS5 能力
 */
export class FTS5SearchEngine {
  private documents: Map<string, FTSDocument> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private config: FTSConfig;

  constructor(config?: Partial<FTSConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 索引文档
   * @param doc 文档
   */
  index(doc: FTSDocument): void {
    this.documents.set(doc.id, doc);

    const tokens = this.tokenize(doc.title + ' ' + doc.content);

    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(doc.id);
    }
  }

  /**
   * 批量索引文档
   * @param docs 文档列表
   */
  indexBatch(docs: FTSDocument[]): void {
    for (const doc of docs) {
      this.index(doc);
    }
  }

  /**
   * 全文搜索
   * @param query 搜索查询
   * @param category 按类别过滤（可选）
   * @param limit 最大结果数
   * @param metadataFilter 按元数据过滤（可选）
   * @returns 搜索结果列表
   */
  search(
    query: string,
    category?: string,
    limit?: number,
    metadataFilter?: (doc: FTSDocument) => boolean
  ): FTSSearchResult[] {
    const maxResults = limit || this.config.maxResults;
    const tokens = this.tokenize(query);

    if (tokens.length === 0) return [];

    const docScores = new Map<string, number>();

    for (const token of tokens) {
      const docIds = this.invertedIndex.get(token);
      if (!docIds) continue;

      for (const docId of docIds) {
        const doc = this.documents.get(docId);
        if (!doc) continue;

        if (category && doc.category !== category) continue;

        if (metadataFilter && !metadataFilter(doc)) continue;

        const current = docScores.get(docId) || 0;

        if (doc.title.toLowerCase().includes(token)) {
          docScores.set(docId, current + 3);
        } else if (doc.content.toLowerCase().includes(token)) {
          docScores.set(docId, current + 1);
        } else if (doc.metadata) {
          const metaStr = JSON.stringify(doc.metadata).toLowerCase();
          if (metaStr.includes(token)) {
            docScores.set(docId, current + 0.5);
          }
        } else {
          docScores.set(docId, current + 0.5);
        }
      }
    }

    const results: FTSSearchResult[] = [];

    for (const [docId, score] of docScores) {
      const doc = this.documents.get(docId)!;
      const snippet = this.generateSnippet(doc.content, tokens);

      results.push({ document: doc, score, snippet });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
  }

  /**
   * 前缀搜索（自动补全）
   * @param prefix 前缀
   * @param limit 最大结果数
   * @returns 匹配的文档列表
   */
  prefixSearch(prefix: string, limit: number = 10): FTSDocument[] {
    const lower = prefix.toLowerCase();
    const results: FTSDocument[] = [];

    for (const doc of this.documents.values()) {
      if (
        doc.title.toLowerCase().startsWith(lower) ||
        doc.content.toLowerCase().includes(lower)
      ) {
        results.push(doc);
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * 删除文档
   * @param docId 文档 ID
   */
  remove(docId: string): void {
    this.documents.delete(docId);

    for (const docIds of this.invertedIndex.values()) {
      docIds.delete(docId);
    }
  }

  /**
   * 获取索引统计
   */
  getStats(): {
    documentCount: number;
    termCount: number;
    avgDocLength: number;
  } {
    const docCount = this.documents.size;
    let totalLength = 0;

    for (const doc of this.documents.values()) {
      totalLength += doc.content.length;
    }

    return {
      documentCount: docCount,
      termCount: this.invertedIndex.size,
      avgDocLength: docCount > 0 ? Math.round(totalLength / docCount) : 0,
    };
  }

  /**
   * 清除所有索引
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
  }

  /**
   * 生成搜索摘要
   * @param content 文档内容
   * @param tokens 搜索词
   * @param maxLen 最大长度
   * @returns 摘要文本
   */
  private generateSnippet(
    content: string,
    tokens: string[],
    maxLen?: number
  ): string {
    const snippetLen = maxLen || this.config.snippetLength;
    const lower = content.toLowerCase();

    let bestStart = 0;
    let bestScore = 0;

    for (let i = 0; i < lower.length; i++) {
      let score = 0;
      for (const token of tokens) {
        if (lower.slice(i, i + snippetLen).includes(token)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
      }
    }

    let snippet = content.slice(bestStart, bestStart + snippetLen);

    if (bestStart > 0) snippet = '...' + snippet;
    if (bestStart + snippetLen < content.length) snippet += '...';

    return snippet;
  }

  /**
   * 分词器（简单空格 + CJK 单字符）
   * @param text 原始文本
   * @returns 词条列表
   */
  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const lower = text.toLowerCase();
    const wordPattern = /[a-z0-9_\u4e00-\u9fff]+/gi;
    let match;

    while ((match = wordPattern.exec(lower)) !== null) {
      const word = match[0];

      if (/^[a-z0-9_]+$/i.test(word)) {
        tokens.push(word);
      } else {
        for (const ch of word) {
          tokens.push(ch);
        }
      }
    }

    return [...new Set(tokens)];
  }

  /**
   * 持久化索引到磁盘
   * @param filePath 文件路径
   */
  saveToDisk(filePath?: string): void {
    const target = filePath || this.config.dbPath;
    const dir = path.dirname(target);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      documents: Array.from(this.documents.entries()),
      invertedIndex: Array.from(this.invertedIndex.entries()),
    };

    fs.writeFileSync(target, JSON.stringify(data), 'utf-8');
  }

  /**
   * 从磁盘加载索引
   * @param filePath 文件路径
   */
  loadFromDisk(filePath?: string): void {
    const target = filePath || this.config.dbPath;

    if (!fs.existsSync(target)) return;

    const raw = fs.readFileSync(target, 'utf-8');
    const data = JSON.parse(raw);

    this.documents = new Map(data.documents);

    this.invertedIndex = new Map();
    for (const [key, values] of data.invertedIndex) {
      this.invertedIndex.set(key, new Set(values));
    }
  }
}

/**
 * 全局 FTS5 引擎实例
 */
let globalFTS: FTS5SearchEngine | null = null;

/**
 * 获取全局 FTS5 搜索引擎
 */
export function getFTS5SearchEngine(): FTS5SearchEngine {
  if (!globalFTS) {
    globalFTS = new FTS5SearchEngine();
  }

  return globalFTS;
}

/**
 * 重置全局 FTS5 引擎
 */
export function resetFTS5SearchEngine(): void {
  globalFTS = null;
}
