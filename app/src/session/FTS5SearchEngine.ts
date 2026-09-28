/**
 * FTS5 全文搜索服务（**分片实现**）
 *
 * 对标 Hermes hermes_state.py 的 FTS5 搜索能力；分片重构见
 * spec `.trae/specs/fts-index-per-session-sharding.md`。
 *
 * **职责边界**（§4.6）：
 * - 本类：索引/检索逻辑（分词、打分、摘要）与**文档级变更**标记；
 * - `FTSIndexStore`：磁盘布局（`manifest.json` + `shards/`）、片数据缓存、片级 `dirty`、
 *   原子写、LRU。**本类不持有索引数据**（唯一例外：单次调用内从 store 取到的可写片引用，
 *   用完即 `markShardDirty` 归还）——否则缓存与磁盘会互相漂移。
 *
 * **分片归属**：片键 = `doc.metadata.sessionId`。分片模型下没有归属的文档**无法索引**
 * （拒收 + warn，禁止静默塞进某个片）。
 *
 * **读取侧**：会话内检索 = 1 片；全局检索 = 按清单扇出（并发上限 + 总超时，超时返回部分结果）。
 * 片缺失/损坏 ⇒ 跳过该片（不阻塞检索），由 `SessionGateway` 在落盘驱动 tick 中按会话重建（§8-6）。
 */
import { enterPhase, exitPhase } from '@modules/diagnostics';
import { getLogger } from '@modules/monitoring';
import {
  FTSIndexStore,
  type FTSShardData,
} from './persistence/FTSIndexStore.js';

const logger = getLogger('session:fts');

/** 全局扇出并发上限（片数多时避免同时打开过多文件） */
export const FTS_FANOUT_CONCURRENCY = 4;
/** 全局扇出总超时（超时返回已收集的部分结果并告警，不无限等待） */
export const FTS_FANOUT_TIMEOUT_MS = 3000;

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
 *
 * 说明：索引**路径**不在此处（§8-1/§11.8-4：路径统一归 `FTSIndexStore` 构造参数，避免双入口）。
 */
export interface FTSConfig {
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

/** 检索选项（`sessionIds` 缺省/`null` ⇒ 全局扇出） */
export interface FTSSearchOptions {
  category?: string;
  limit?: number;
  /** 作用域：仅检索这些会话的片；`null`/省略 ⇒ 全局 */
  sessionIds?: Iterable<string> | null;
  metadataFilter?: (doc: FTSDocument) => boolean;
  /** 扇出保护（默认见 `FTS_FANOUT_*`；测试可注入以验证超时） */
  fanout?: { concurrency?: number; timeoutMs?: number };
}

/**
 * 分词（与整索引时代逐字一致：仅把方法下沉为函数，供片内写入复用）
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const words = text
    .toLowerCase()
    .split(/[\s,，。！？；：、（）()\[\]{}"'`~@#$%^&*+=|\\<>/]+/);

  for (const word of words) {
    if (!word) continue;
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

/** 把文档写入片的内存视图（documents + invertedIndex） */
function addDocumentToShard(shard: FTSShardData, doc: FTSDocument): void {
  shard.documents.set(doc.id, doc);
  for (const token of tokenize(doc.title + ' ' + doc.content)) {
    let ids = shard.invertedIndex.get(token);
    if (!ids) {
      ids = new Set<string>();
      shard.invertedIndex.set(token, ids);
    }
    ids.add(doc.id);
  }
}

/**
 * FTS5 全文搜索引擎（分片实现，纯 TypeScript，无需 SQLite C 扩展）
 */
export class FTS5SearchEngine {
  private readonly store: FTSIndexStore;
  private readonly config: FTSConfig;

  constructor(store: FTSIndexStore, config?: Partial<FTSConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ───────────────────────── 写 ─────────────────────────

  /**
   * 索引文档（按 `doc.metadata.sessionId` 归属片）
   */
  async index(doc: FTSDocument): Promise<void> {
    await this.indexBatch([doc]);
  }

  /**
   * 批量索引文档
   *
   * 跨会话文档可混批（各自归入自己的片）；无归属文档被拒收并记 warn。
   */
  async indexBatch(docs: FTSDocument[]): Promise<void> {
    for (const doc of docs) {
      const sessionId = this.shardKeyOf(doc);
      if (!sessionId) {
        logger.warn(
          'FTS 索引写入缺少 metadata.sessionId，已拒收（分片模型下无归属）',
          {
            docId: doc.id,
          }
        );
        continue;
      }
      this.validateDocumentPaths(doc);
      const shard = await this.mutableShard(sessionId);
      if (!shard) continue; // 损坏片：拒绝单文档覆盖式写入，等按会话重建
      addDocumentToShard(shard, doc);
      this.store.markShardDirty(sessionId);
    }
  }

  /**
   * 删除文档（按会话定位片）
   */
  async remove(sessionId: string, docId: string): Promise<void> {
    // 无片 / 损坏片 ⇒ 无可移除（损坏片整体由重建覆盖，逐个删无意义）
    const shard = await this.store.loadShard(sessionId);
    if (!shard) return;
    if (!shard.documents.delete(docId)) return;

    for (const ids of shard.invertedIndex.values()) {
      ids.delete(docId);
    }
    this.store.markShardDirty(sessionId);
  }

  /**
   * 整片替换（§8-6 片级重建）：调用方（有 storage 的一方）提供该会话**全部**文档。
   */
  async rebuildSession(sessionId: string, docs: FTSDocument[]): Promise<void> {
    const shard: FTSShardData = {
      documents: new Map(),
      invertedIndex: new Map(),
    };
    let skipped = 0;
    for (const doc of docs) {
      if (this.shardKeyOf(doc) !== sessionId) {
        skipped++;
        continue;
      }
      this.validateDocumentPaths(doc);
      addDocumentToShard(shard, doc);
    }
    if (skipped > 0) {
      logger.warn('FTS 片重建时发现归属不符的文档，已跳过', {
        sessionId,
        skipped,
      });
    }
    await this.store.putShard(sessionId, shard);
  }

  /**
   * 清空全部索引（内存视图 + 磁盘片 + 清单条目）。
   *
   * **当前无调用点**（保留 API；去留见 spec §11.8-2）。
   */
  async clear(): Promise<void> {
    const manifest = await this.store.readManifest();
    for (const sessionId of Object.keys(manifest.shards)) {
      await this.store.removeShard(sessionId);
    }
    await this.store.flushManifest();
  }

  // ───────────────────────── 读 ─────────────────────────

  /**
   * 全文搜索
   *
   * 排序键固定为 **`(score desc, docId asc)`**：分片归并后「Map 插入序」不再稳定，
   * 必须显式定序（spec §11.3，V4 逐条一致判定的前提）。
   */
  async search(
    query: string,
    options: FTSSearchOptions = {}
  ): Promise<FTSSearchResult[]> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const limit = options.limit ?? this.config.maxResults;

    const { items, skipped } = await this.collectFromShards(
      options.sessionIds ?? null,
      (data) => this.scoreShard(data, tokens, options),
      options.fanout
    );
    items.sort(
      (a, b) =>
        b.score - a.score ||
        (a.document.id < b.document.id
          ? -1
          : a.document.id > b.document.id
            ? 1
            : 0)
    );
    if (skipped > 0) {
      logger.warn('FTS 检索跳过不可用分片（待重建）', { skipped });
    }
    return items.slice(0, limit);
  }

  /**
   * 前缀搜索（自动补全）
   *
   * **当前无调用点**（保留 API；去留见 spec §11.8-2）。
   */
  async prefixSearch(
    prefix: string,
    limit: number = 10
  ): Promise<FTSDocument[]> {
    const lower = prefix.toLowerCase();
    const { items } = await this.collectFromShards(null, (data) => {
      const matched: FTSDocument[] = [];
      for (const doc of data.documents.values()) {
        if (
          doc.title.toLowerCase().startsWith(lower) ||
          doc.content.toLowerCase().includes(lower)
        ) {
          matched.push(doc);
        }
      }
      return matched;
    });
    return items.slice(0, limit);
  }

  /**
   * 获取索引统计
   *
   * 全部由清单汇总（**零读片**）：`documentCount` / `totalLength` 精确；
   * `termCount` = Σ 片内词条数，同一词跨片会重复计（口径见 `FTSShardEntry.termCount`）；
   * **统计口径**：以**已落盘清单**为准 —— 尚未落盘的脏片不计入（下一个落盘 tick 后一致）。
   */
  async getStats(): Promise<{
    documentCount: number;
    termCount: number;
    avgDocLength: number;
  }> {
    const manifest = await this.store.readManifest();
    let documentCount = 0;
    let termCount = 0;
    let totalLength = 0;
    for (const entry of Object.values(manifest.shards)) {
      documentCount += entry.docCount;
      termCount += entry.termCount;
      totalLength += entry.contentLength;
    }
    return {
      documentCount,
      termCount,
      avgDocLength:
        documentCount > 0 ? Math.round(totalLength / documentCount) : 0,
    };
  }

  // ───────────────────────── 持久化（委托 store） ─────────────────────────

  /**
   * 落盘全部脏片（§8-4 驱动入口）。无脏片 ⇒ 0（不建目录、不写盘、不重写清单）。
   */
  async flush(): Promise<number> {
    enterPhase('fts:flushShards');
    try {
      return await this.store.flushPendingShards();
    } finally {
      exitPhase('fts:flushShards');
    }
  }

  /** 释放某会话的片内存视图（片重建/会话删除后调用，避免陈旧视图回写） */
  async unloadSession(sessionId: string): Promise<void> {
    await this.store.unloadShard(sessionId);
  }

  // ───────────────────────── 内部 ─────────────────────────

  /** 片键：`metadata.sessionId`（分片模型下无归属即无法索引） */
  private shardKeyOf(doc: FTSDocument): string | null {
    const sessionId = doc.metadata?.sessionId;
    return typeof sessionId === 'string' && sessionId.length > 0
      ? sessionId
      : null;
  }

  /**
   * 取得**可写**的片内存视图：
   * - 已有片（缓存/磁盘）⇒ 返回其引用（调用方变更后须 `markShardDirty`）；
   * - 无片 ⇒ 新建空片并 `putShard`（已标脏）；
   * - 清单有记录但不可读（**损坏**）⇒ 返回 `null`：拒绝单文档覆盖式写入，等按会话重建
   *   （否则该会话其余文档会被这次覆盖写永久丢掉）。
   */
  private async mutableShard(sessionId: string): Promise<FTSShardData | null> {
    const loaded = await this.store.loadShard(sessionId);
    if (loaded) return loaded;

    const manifest = await this.store.readManifest();
    if (manifest.shards[sessionId]) {
      logger.warn('FTS 片损坏，拒绝单文档写入（等待按会话重建）', {
        sessionId,
      });
      return null;
    }

    const created: FTSShardData = {
      documents: new Map(),
      invertedIndex: new Map(),
    };
    await this.store.putShard(sessionId, created);
    return created;
  }

  /** 单片打分（与整索引时代逐条等价，仅数据源换成单片） */
  private scoreShard(
    data: FTSShardData,
    tokens: string[],
    options: FTSSearchOptions
  ): FTSSearchResult[] {
    const docScores = new Map<string, number>();

    for (const token of tokens) {
      const docIds = data.invertedIndex.get(token);
      if (!docIds) continue;

      for (const docId of docIds) {
        const doc = data.documents.get(docId);
        if (!doc) continue;

        if (options.category && doc.category !== options.category) continue;
        if (options.metadataFilter && !options.metadataFilter(doc)) continue;

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
      const doc = data.documents.get(docId);
      if (!doc) continue;
      results.push({
        document: doc,
        score,
        snippet: this.generateSnippet(doc.content, tokens),
      });
    }
    return results;
  }

  /**
   * 遍历候选片并归并结果。
   *
   * - `sessionIds === null` ⇒ 全局扇出：候选 = **清单 ∪ 缓存**（按 id 排序保证遍历稳定）——
   *   含缓存是因为新建片在首次落盘前不在清单里，只认清单会让新会话消息 ≤60s 检索不到；
   * - 给定会话集合 ⇒ 仅这些片中**已知**的（未登记的会话直接排除，不算"跳过"）；
   * - 并发上限 + 总超时：超时停止调度，返回已收集结果（不无限等待）；
   * - 片缺失/损坏 ⇒ `skipped++`（由调用方告警，不阻塞检索）。
   */
  private async collectFromShards<R>(
    sessionIds: Iterable<string> | null,
    perShard: (data: FTSShardData) => R[],
    fanout?: { concurrency?: number; timeoutMs?: number }
  ): Promise<{ items: R[]; skipped: number }> {
    const known = await this.store.knownShardIds();
    const scoped = sessionIds === null ? null : new Set(sessionIds);
    const targets = (
      scoped ? known.filter((id) => scoped.has(id)) : known
    ).sort();

    const concurrency = Math.max(
      1,
      fanout?.concurrency ?? FTS_FANOUT_CONCURRENCY
    );
    const timeoutMs = fanout?.timeoutMs ?? FTS_FANOUT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    const items: R[] = [];
    let skipped = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        if (Date.now() > deadline) return;
        const sessionId = targets[cursor++];
        const data = await this.store.loadShard(sessionId);
        if (!data) {
          skipped++;
          continue;
        }
        items.push(...perShard(data));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, targets.length) }, () =>
        worker()
      )
    );

    if (cursor < targets.length) {
      logger.warn('FTS 扇出检索超时，已返回部分结果', {
        scanned: cursor,
        total: targets.length,
        timeoutMs,
      });
    }
    return { items, skipped };
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

    for (const token of tokens) {
      let idx = lower.indexOf(token);
      while (idx !== -1) {
        const start = Math.max(0, idx - Math.floor(snippetLen / 4));
        const window = lower.slice(start, start + snippetLen);
        let score = 0;
        for (const t of tokens) {
          if (window.includes(t)) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestStart = start;
        }
        idx = lower.indexOf(token, idx + 1);
      }
    }

    const snippet = content.slice(
      bestStart,
      Math.min(content.length, bestStart + snippetLen)
    );
    const prefix = bestStart > 0 ? '...' : '';
    const suffix = bestStart + snippetLen < content.length ? '...' : '';
    return prefix + snippet + suffix;
  }
}

/**
 * 全局 FTS5 引擎实例
 */
let globalFTS: FTS5SearchEngine | null = null;

/**
 * 获取全局 FTS5 搜索引擎
 *
 * @param store 首次调用必须注入（索引目录归属 `FTSIndexStore`，引擎不持有路径）
 */
export function getFTS5SearchEngine(store?: FTSIndexStore): FTS5SearchEngine {
  if (!globalFTS) {
    if (!store) {
      throw new Error(
        'getFTS5SearchEngine: 首次调用必须注入 FTSIndexStore（索引目录归 store 所有）'
      );
    }
    globalFTS = new FTS5SearchEngine(store);
  }

  return globalFTS;
}

/**
 * 重置全局 FTS5 引擎
 */
export function resetFTS5SearchEngine(): void {
  globalFTS = null;
}
