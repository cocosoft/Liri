/**
 * SQLite FTS5 全文搜索服务
 * 对标 Hermes hermes_state.py 的 FTS5 搜索能力
 * 将全文搜索引入会话和记忆搜索
 */
import fs from 'fs';
import path from 'path';
import { enterPhase, exitPhase } from '@modules/diagnostics';

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
  /**
   * 索引持久化路径。H1 修复：不再提供默认 `fts.db` 路径，
   * 统一由调用方显式传入（SessionGateway.getFTSIndexPath()），
   * 消除「读 fts.db、写 fts-index.json」的路径不对称。
   * 无参 saveToDisk/loadFromDisk 在未提供 dbPath 时报错。
   */
  dbPath?: string;
  maxResults: number;
  snippetLength: number;
  cacheEnabled: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: FTSConfig = {
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
  /** 索引自上次落盘后是否有变更（P2-18 修复：无变更时跳过全量写盘） */
  private isDirty: boolean = false;
  /**
   * R7（2026-09-21）：变更代际计数 —— 与 `isDirty` 同时递增。
   *
   * 用途：落盘改为**异步**后，"序列化期间又发生变更"成为可能；写盘结束时按
   * `dirtySeq` 是否变化决定能否清 `isDirty`，避免把写入期间的新变更一并抹掉。
   */
  private dirtySeq: number = 0;
  /** R7：落盘重入保护（异步写盘未完成时跳过本 tick，`isDirty` 保持待下轮） */
  private saving: boolean = false;
  /** L7：累计文档 content 长度（getStats 增量计数，消除 O(n) 遍历） */
  private totalLength: number = 0;

  constructor(config?: Partial<FTSConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** R7：标记索引已变更（`isDirty` + 代际递增的唯一入口） */
  private touchDirty(): void {
    this.isDirty = true;
    this.dirtySeq++;
  }

  /**
   * 索引文档
   * @param doc 文档
   */
  index(doc: FTSDocument): void {
    // BUG12 修复：检查文档元数据中的路径是否在允许范围内
    this.validateDocumentPaths(doc);
    const existing = this.documents.get(doc.id);
    if (existing) {
      this.totalLength -= existing.content.length;
    }
    this.documents.set(doc.id, doc);
    this.totalLength += doc.content.length;

    const tokens = this.tokenize(doc.title + ' ' + doc.content);

    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(doc.id);
    }

    this.touchDirty();
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
    const existing = this.documents.get(docId);
    if (existing) {
      this.totalLength -= existing.content.length;
    }
    this.documents.delete(docId);

    for (const docIds of this.invertedIndex.values()) {
      docIds.delete(docId);
    }

    this.touchDirty();
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

    return {
      documentCount: docCount,
      termCount: this.invertedIndex.size,
      avgDocLength: docCount > 0 ? Math.round(this.totalLength / docCount) : 0,
    };
  }

  /**
   * BUG12 修复：验证文档元数据中的路径是否在允许范围内
   * 防止搜索结果暴露受限目录的文件路径
   */
  private validateDocumentPaths(doc: FTSDocument): void {
    const { isPathWithin, resolvePyappHome } = require('@modules/core/paths');
    const allowedRoots = [resolvePyappHome()];

    // 检查 metadata 中常见的路径字段
    const pathKeys = ['filePath', 'path', 'sourcePath', 'targetPath'];
    for (const key of pathKeys) {
      const value = doc.metadata?.[key];
      if (typeof value === 'string' && value) {
        const isAllowed = allowedRoots.some((root) =>
          isPathWithin(root, value)
        );
        if (!isAllowed) {
          // 将越权路径标记为受限（不阻塞索引，但清除路径信息）
          if (doc.metadata) {
            doc.metadata[key] = '[restricted]';
          }
        }
      }
    }
  }

  /**
   * 清除所有索引
   */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.totalLength = 0;
    this.touchDirty();
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
   * 持久化索引到磁盘（R7，2026-09-21：**异步 + 分片让出 + 原子替换**）
   *
   * **修复前**：`Array.from(...)` 全量物化 + **单次** `JSON.stringify`（该文件实测
   * **260.8MB**）+ `fs.writeFileSync` —— 全程在主线程同步执行，由
   * `SessionGateway.startFTSIndexPersistence()` 的 `setInterval(60_000)` 驱动。
   * 真机证据：`Event Loop 滞后 37520ms / 28335ms / 39217ms`（13:20 / 14:07 / 14:32），
   * 三次的 `memRssMb` 均 ≈5GB 而 `heapUsedMb` 仅 ≈1.2GB（差额即序列化中间体），
   * 同秒前端上报 `Failed to fetch` / `请求超时 (30000ms)`。
   *
   * **修复后**：
   *  ① 分片序列化 —— 逐词条产出，攒够 ~1MB 写一次并 `setImmediate` **让出事件循环**
   *   （最大连续阻塞从"整个索引"降到"单片的字符串化"）；
   *  ② `fs.promises` + 先写临时文件再 `rename` **原子替换**（不会留下半截索引）；
   *  ③ 重入保护：上一次未写完 ⇒ 本次 tick 直接返回（`isDirty` 保持，下轮再试）；
   *  ④ 代际保护：写入期间有新变更（`dirtySeq` 变化）⇒ **不清** `isDirty`。
   *
   * 一致性说明：分片期间索引可能被并发修改（异步让出所致），写出的文件可能"某词条
   * 缺失 / 引用已被删除的文档"—— 前者只是该轮检索不到（下轮重写即恢复），后者由
   * `search()` 的 `if (!doc) continue`（L135-136）安全跳过，故不会读到坏数据。
   *
   * @returns 是否真的写了盘（未变更 / 重入跳过 ⇒ false）
   */
  async saveToDisk(filePath?: string): Promise<boolean> {
    enterPhase('fts:saveToDisk');
    try {
      // P2-18：索引无变更时跳过全量序列化写盘，避免每 60s 无条件写放大
      if (!this.isDirty) return false;
      if (this.saving) return false; // ③ 重入保护

      const target = filePath ?? this.config.dbPath;
      if (!target) {
        throw new Error(
          'FTS5SearchEngine.saveToDisk: 未提供 dbPath，索引持久化路径缺失'
        );
      }
      const dir = path.dirname(target);
      const seqAtStart = this.dirtySeq;
      const tmpPath = `${target}.tmp-${process.pid}`;

      this.saving = true;
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const handle = await fs.promises.open(tmpPath, 'w');
        try {
          let buffer = '';
          let pieces = 0;
          for await (const piece of this.serializeChunks()) {
            buffer += piece;
            pieces++;
            // 攒满 ~1MB 或每 200 片写一次 → 让出事件循环（避免长同步块）
            if (buffer.length >= 1 << 20 || pieces >= 200) {
              await handle.write(buffer);
              buffer = '';
              pieces = 0;
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
          if (buffer.length > 0) {
            await handle.write(buffer);
          }
        } finally {
          await handle.close();
        }
        // ② 原子替换：loadFromDisk 只会看到"旧完整文件"或"新完整文件"
        await fs.promises.rename(tmpPath, target);
        // ④ 写入期间无新变更 ⇒ 才算"已落盘"；否则保留下轮写
        if (this.dirtySeq === seqAtStart) {
          this.isDirty = false;
        }
        return true;
      } catch (err) {
        // 清理半截临时文件（内存索引不受影响；下次 tick 会重试）
        try {
          await fs.promises.unlink(tmpPath);
        } catch {
          // @ignore-catch: 临时文件可能未创建（open 失败）或已被 rename
        }
        throw err;
      } finally {
        this.saving = false;
      }
    } finally {
      exitPhase('fts:saveToDisk');
    }
  }

  /**
   * R7：分片序列化（与既有落盘格式**逐字节等价**：`{documents:[[id,doc]…],
   * invertedIndex:[[term,[ids]…]…]}`，仅把"一次性拼装"改为逐条产出）。
   *
   * 逐条 `JSON.stringify` 单个词条 ⇒ 单次 CPU 时间与词条大小同阶（微秒级），
   * 配合调用方的让出点，把 28–39s 的单次阻塞拆成大量可忽略的小块。
   */
  private async *serializeChunks(): AsyncGenerator<string> {
    yield '{"documents":[';
    let first = true;
    for (const entry of this.documents.entries()) {
      yield (first ? '' : ',') + JSON.stringify(entry);
      first = false;
    }
    yield '],"invertedIndex":[';
    first = true;
    for (const [key, values] of this.invertedIndex.entries()) {
      // CS05（2026-09-18）：Set 不能直接 JSON.stringify（序列化为 {}），
      // 落盘前转数组，保证 loadFromDisk 可正确恢复（曾致索引文件损坏后
      // loadFromDisk 崩溃，中断 ensureSessionsLoaded 使历史会话不显示）。
      yield (first ? '' : ',') + JSON.stringify([key, Array.from(values)]);
      first = false;
    }
    yield ']}';
  }

  /**
   * 从磁盘加载索引
   * @param filePath 文件路径
   */
  loadFromDisk(filePath?: string): void {
    const target = filePath ?? this.config.dbPath;
    if (!target) {
      throw new Error(
        'FTS5SearchEngine.loadFromDisk: 未提供 dbPath，索引持久化路径缺失'
      );
    }

    if (!fs.existsSync(target)) return;

    const raw = fs.readFileSync(target, 'utf-8');
    const data = JSON.parse(raw);

    this.documents = new Map(data.documents);

    this.totalLength = 0;
    for (const doc of this.documents.values()) {
      this.totalLength += doc.content.length;
    }

    this.invertedIndex = new Map();
    // 先复位 dirty：循环中检测到损坏词条时置 true（持久化重写修复文件）
    this.isDirty = false;
    for (const [key, values] of data.invertedIndex) {
      // CS05（2026-09-18）：容错旧损坏文件（values 为 {} 而非数组，
      // 旧版 saveToDisk 直接 stringify Set 所致）。跳过损坏词条并标记
      // dirty，循环后从 documents 全量重建索引，避免索引缺失。
      if (!Array.isArray(values)) {
        this.touchDirty();
        continue;
      }
      this.invertedIndex.set(key, new Set(values));
    }
    // CS05（2026-09-18）补漏：磁盘文件可能已被"空倒排索引"覆盖
    // （上一版容错把损坏词条全部跳过并持久化，造成 documents 有值
    // 但 invertedIndex 为空、全文搜索永久失效）。满足任一条件即从
    // documents 全量重建倒排索引：
    //  ① 本轮检测到损坏词条（旧文件整体损坏）
    //  ② documents 非空但 invertedIndex 为空（空索引被持久化）
    if (
      this.isDirty ||
      (this.documents.size > 0 && this.invertedIndex.size === 0)
    ) {
      this.rebuildIndexFromDocuments();
      this.touchDirty();
    }
  }

  /**
   * 基于已加载的 documents 全量重建倒排索引
   * CS05（2026-09-18）：损坏词条"跳过"策略会让倒排索引永久缺失，
   * 改为从 documents 重新 tokenize 全量重建，保证搜索功能可用。
   */
  private rebuildIndexFromDocuments(): void {
    const rebuilt = new Map<string, Set<string>>();
    for (const [id, doc] of this.documents) {
      const tokens = this.tokenize(doc.title + ' ' + doc.content);
      for (const token of tokens) {
        let ids = rebuilt.get(token);
        if (!ids) {
          ids = new Set<string>();
          rebuilt.set(token, ids);
        }
        ids.add(id);
      }
    }
    this.invertedIndex = rebuilt;
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
