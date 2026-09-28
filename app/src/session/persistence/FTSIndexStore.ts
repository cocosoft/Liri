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
 * FTSIndexStore — FTS 索引的**磁盘布局层**（spec `fts-index-per-session-sharding.md` §8）
 *
 * 独立于 `FTS5SearchEngine`（索引/检索逻辑）的原因：磁盘布局是单一职责，且引擎已近
 * 千行硬约束（`ARCH_MAX_LINES`），片读写无处安放。
 *
 * 布局：`<indexDir>/manifest.json` + `<indexDir>/shards/<safeSessionId>.json`
 * （临时文件 `.tmp.<hex>`，由 `AtomicWriter` 写、`rename` 原子替换）
 *
 * 职责边界（一次定清，避免双缓存/双职责）：
 * - **本类**：磁盘布局、片数据缓存、片级 `dirty`/`dirtySeq`、原子写。
 *   引擎**不缓存片数据**（片缓存唯一入口是本类），否则缓存与磁盘可能互相漂移。
 * - `FTS5SearchEngine`：索引/检索逻辑；内容变更后调 `markShardDirty()`。
 *
 * **缓存冻结为「字节不可变」**（核心不变量，据此才能安全淘汰）：
 * 1. 片只在 `loadShard()` 时从盘读入，**不在引擎侧被原地持有**；
 * 2. 引擎每次以会话为单位的批量变更，都会在该批内 `markShardDirty()`；
 * 3. 片**不会在「未落盘（脏）」状态下丢失**（见下）。
 *
 * **LRU 只淘汰干净片**：脏片 = 未落盘工作集，淘汰即丢变更（违 V7）；且脏片若已不在缓存，
 * 连"把它写出来"都做不到。故上限只约束干净片——它们在盘上有权威副本，淘汰后按需回读
 * （不重新序列化）。空闲期常驻内存 = 清单 + 脏工作集（干净片在下次插入时被压回上限）。
 *
 * 读取侧不变量：**不逐文件 stat / 不读目录**——命中缓存 0 次 I/O；未命中 ≤2 次
 * （`manifest.json` 一次，进程内缓存；目标片文件一次）。目录扫描只出现在
 * `scanTmpResidue()`（启动清理，一次）。
 */
import fs from 'fs/promises';
import path from 'path';
import { getLogger } from '@modules/monitoring';
import {
  computeMd5,
  sanitizeFileName,
} from '@modules/services/file/fileNaming';
import { AtomicWriter } from './AtomicWriter.js';
import type { FTSDocument } from '../FTS5SearchEngine.js';

const logger = getLogger('session:fts:store');

/** 清单格式版本（不匹配即视为不可用 ⇒ 由下游重建，§7 不做迁移） */
export const FTS_INDEX_MANIFEST_VERSION = 1;
/** 清单文件名 */
export const FTS_INDEX_MANIFEST_FILE = 'manifest.json';
/** 片目录名 */
export const FTS_INDEX_SHARDS_DIR = 'shards';
/** 片临时文件前缀（与 `AtomicWriter` 的 `.tmp.<hex>` 命名一致；按前缀识别，命名微调也不漏判） */
export const FTS_SHARD_TMP_PREFIX = '.tmp.';

/** 干净片缓存上限：片数（默认 64；实测 186 会话，热集远小于全量） */
export const DEFAULT_MAX_CACHED_SHARDS = 64;
/** 干净片缓存上限：字节（默认 64 MiB；实测均值约 2.2 MB/片 ⇒ 约 29 片即触顶，双阈值取先到者） */
export const DEFAULT_MAX_CACHED_BYTES = 64 * 1024 * 1024;

/** 单片清单条目（仅统计/一致性校验，不随片内容膨胀） */
export interface FTSShardEntry {
  /** 片内文档数 */
  docCount: number;
  /** 片内 content 字符数合计（清单的 `totalLength` = Σ，见 `flushManifest`） */
  contentLength: number;
  /**
   * 片内词条数（倒排键数）。**口径提示**：全局 `termCount` = Σ 各片值，同一词出现在
   * 多片会被重复计（跨片去重需加载全部片，代价不可接受）；无消费点，仅供统计观测。
   */
  termCount: number;
  /** 片文件序列化字节数（写入时由 `AtomicWriter` 回传，无需再 stat） */
  bytes: number;
}

export interface FTSIndexManifest {
  version: number;
  totalLength: number;
  /** sessionId → 片条目（清单即索引的目录：有清单才有片） */
  shards: Record<string, FTSShardEntry>;
}

/** 片的内存视图（与整索引时代的 `documents`/`invertedIndex` 语义逐条一致） */
export interface FTSShardData {
  documents: Map<string, FTSDocument>;
  invertedIndex: Map<string, Set<string>>;
}

/** 片文件格式（§4.2） */
interface FTSShardFile {
  sessionId: string;
  documents: Array<[string, FTSDocument]>;
  invertedIndex: Array<[string, string[]]>;
}

interface ShardCacheEntry {
  data: FTSShardData;
  /** 结构化标记：是否有未落盘变更（禁字符串匹配判断，CS02） */
  dirty: boolean;
  /** 代际计数：写入期间的变更不被「已落盘」抹掉（与 `dirty` 同时递增） */
  dirtySeq: number;
  /** 已知序列化字节数（写入后回填；用于缓存字节阈值。未写过 ⇒ 0，此时为脏片、不参与淘汰） */
  bytes: number;
}

export interface FTSIndexStoreOptions {
  maxCachedShards?: number;
  maxCachedBytes?: number;
}

export function createEmptyManifest(): FTSIndexManifest {
  return { version: FTS_INDEX_MANIFEST_VERSION, totalLength: 0, shards: {} };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isShardEntry(v: unknown): v is FTSShardEntry {
  if (!isRecord(v)) return false;
  return (
    isFiniteNumber(v.docCount) &&
    isFiniteNumber(v.contentLength) &&
    isFiniteNumber(v.termCount) &&
    isFiniteNumber(v.bytes)
  );
}

function isDocumentEntry(v: unknown): v is [string, FTSDocument] {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [id, doc] = v as [unknown, unknown];
  return (
    typeof id === 'string' &&
    isRecord(doc) &&
    typeof (doc as { content?: unknown }).content === 'string'
  );
}

function isIndexEntry(v: unknown): v is [string, string[]] {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [term, ids] = v as [unknown, unknown];
  return (
    typeof term === 'string' &&
    Array.isArray(ids) &&
    ids.every((id) => typeof id === 'string')
  );
}

/** 片文件结构校验（严格：任一处理不当都要重建该片，故不做"部分容忍"，见 CS05） */
function parseShardFile(parsed: unknown): FTSShardFile | null {
  if (!isRecord(parsed)) return null;
  const { sessionId, documents, invertedIndex } = parsed;
  if (typeof sessionId !== 'string') return null;
  if (!Array.isArray(documents) || !documents.every(isDocumentEntry))
    return null;
  if (!Array.isArray(invertedIndex) || !invertedIndex.every(isIndexEntry)) {
    return null;
  }
  return { sessionId, documents, invertedIndex };
}

export class FTSIndexStore {
  private readonly writer = new AtomicWriter();
  /** 清单内存副本（`readManifest()` 懒加载；`flushManifest()` 落盘） */
  private manifest: FTSIndexManifest | null = null;
  /** 片数据缓存（唯一入口：`loadShard()`；Map 迭代序 = 插入/提升序 ⇒ LRU） */
  private readonly shardCache = new Map<string, ShardCacheEntry>();
  /**
   * 损坏片登记（清单有记录、但文件不可读/结构非法）。
   *
   * 为什么在 store 侧登记：store 是唯一读片者（能发现损坏），但没有会话文档来源；
   * 由**有 storage 的一方**（`SessionGateway`）在落盘驱动 tick 时取走并重建单片
   * （§8-6 片级重建），避免在检索路径内做全量重建而卡住搜索。
   */
  private readonly corruptShardIds = new Set<string>();
  private readonly maxCachedShards: number;
  private readonly maxCachedBytes: number;

  constructor(
    private readonly indexDir: string,
    options: FTSIndexStoreOptions = {}
  ) {
    this.maxCachedShards = options.maxCachedShards ?? DEFAULT_MAX_CACHED_SHARDS;
    this.maxCachedBytes = options.maxCachedBytes ?? DEFAULT_MAX_CACHED_BYTES;
  }

  // ───────────────────────── 路径 ─────────────────────────

  /** 清单文件绝对路径 */
  get manifestPath(): string {
    return path.join(this.indexDir, FTS_INDEX_MANIFEST_FILE);
  }

  /** 片目录绝对路径 */
  get shardsDirPath(): string {
    return path.join(this.indexDir, FTS_INDEX_SHARDS_DIR);
  }

  /**
   * 会话 → 片文件名（净化非法字符，禁 `:` `/` `\` 等）。
   *
   * 净化发生替换（`safe !== sessionId`）或结果为空时，追加原 id 的短哈希：
   * 否则 `qq:1` 与 `qq/1` 会净化成同名文件而互相覆盖（渠道会话 id 确含 `:`）。
   */
  shardFileName(sessionId: string): string {
    const safe = sanitizeFileName(sessionId);
    if (safe === sessionId && safe.length > 0) return `${safe}.json`;
    return `${safe || 'session'}_${computeMd5(sessionId).slice(0, 8)}.json`;
  }

  /** 会话 → 片文件绝对路径 */
  shardPath(sessionId: string): string {
    return path.join(this.shardsDirPath, this.shardFileName(sessionId));
  }

  // ───────────────────────── 清单 ─────────────────────────

  /**
   * 读取清单（进程内缓存；返回**可变更的内存副本引用**，改动由 `flushManifest()` 落盘）。
   *
   * **任何不可用形态一律回落为空清单，且不抛错**：清单是派生物，由下游按会话重建片
   * 即可；抛错会中断调用链（历史事故：索引读取异常中断 `ensureSessionsLoaded`，导致
   * 历史会话不显示）。不可用形态：不存在（首启，正常）/ 读取失败 / JSON 解析失败 /
   * 顶层结构非法 / 版本不匹配。
   */
  async readManifest(): Promise<FTSIndexManifest> {
    if (this.manifest) return this.manifest;

    const target = this.manifestPath;
    let raw: string;
    try {
      raw = await fs.readFile(target, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.warn('FTS 清单读取失败，按空清单处理（将触发片重建）', {
          path: target,
          error: String(err),
        });
      }
      this.manifest = createEmptyManifest();
      return this.manifest;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn('FTS 清单解析失败，按空清单处理（将触发片重建）', {
        path: target,
        error: String(err),
      });
      this.manifest = createEmptyManifest();
      return this.manifest;
    }

    this.manifest = this.normalizeManifest(parsed, target);
    return this.manifest;
  }

  /** 结构校验：非法顶层/版本 ⇒ 空清单；仅丢弃损坏的分片条目，保留其余 */
  private normalizeManifest(parsed: unknown, target: string): FTSIndexManifest {
    if (!isRecord(parsed)) {
      logger.warn('FTS 清单结构非法，按空清单处理（将触发片重建）', {
        path: target,
      });
      return createEmptyManifest();
    }

    if (parsed.version !== FTS_INDEX_MANIFEST_VERSION) {
      logger.warn('FTS 清单版本不匹配，按空清单处理（将触发片重建）', {
        path: target,
        version: parsed.version,
        expected: FTS_INDEX_MANIFEST_VERSION,
      });
      return createEmptyManifest();
    }

    const manifest = createEmptyManifest();
    if (isFiniteNumber(parsed.totalLength))
      manifest.totalLength = parsed.totalLength;

    const rawShards = parsed.shards;
    if (rawShards === undefined) return manifest;
    if (!isRecord(rawShards)) {
      logger.warn('FTS 清单 shards 结构非法，按空清单处理（将触发片重建）', {
        path: target,
      });
      return manifest;
    }

    let dropped = 0;
    for (const [sessionId, entry] of Object.entries(rawShards)) {
      if (isShardEntry(entry)) {
        manifest.shards[sessionId] = entry;
      } else {
        dropped++;
      }
    }
    if (dropped > 0) {
      logger.warn('FTS 清单含损坏分片条目，已丢弃（受影响会话由下游重建）', {
        path: target,
        dropped,
      });
    }
    return manifest;
  }

  /**
   * 原子写入清单（`AtomicWriter`：tmp + rename + Windows 覆盖重试；目录自动创建）
   */
  async writeManifest(manifest: FTSIndexManifest): Promise<void> {
    this.manifest = manifest;
    await this.writer.writeJSON(this.manifestPath, manifest);
  }

  /**
   * 写盘当前清单：落盘前**汇总** `totalLength = Σ 各片 contentLength`。
   *
   * 汇总而非增量维护：全局计数器会在"片被重写/删除/重建"时漂移，而 Σ 恒自洽。
   */
  async flushManifest(): Promise<void> {
    const manifest = await this.readManifest();
    manifest.totalLength = Object.values(manifest.shards).reduce(
      (sum, entry) => sum + entry.contentLength,
      0
    );
    await this.writeManifest(manifest);
  }

  // ───────────────────────── 片读写 ─────────────────────────

  /**
   * 启动恢复：清理 `shards/` 下的原子写残留临时文件（`.tmp.<hex>`）。
   *
   * 为什么需要：`AtomicWriter` 失败即自清，但**进程崩溃/被杀**会留下 tmp 残渣。
   * 扫描目录是 IO 热点（历史 `tools:glob` EPERM 风暴），故只在启动调用一次；
   * 日常路径**不读目录**（见类注释的读取侧不变量）。
   *
   * @returns 清理的残渣数
   */
  async scanTmpResidue(): Promise<number> {
    const dir = this.shardsDirPath;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.warn('FTS 片目录扫描失败，跳过临时文件清理', {
          path: dir,
          error: String(err),
        });
      }
      return 0;
    }

    let removed = 0;
    for (const name of names) {
      if (!name.startsWith(FTS_SHARD_TMP_PREFIX)) continue;
      const target = path.join(dir, name);
      try {
        await fs.unlink(target);
        removed++;
      } catch (err) {
        // @ignore-catch: 残渣删除失败不影响主流程（文件不在清单内，永不被读取）
        logger.warn('FTS 片临时文件清理失败', {
          path: target,
          error: String(err),
        });
      }
    }
    if (removed > 0) {
      logger.info('FTS 片目录残留临时文件已清理', { removed, path: dir });
    }
    return removed;
  }

  /**
   * 加载片（会话内检索/扇出的入口）。
   *
   * **清单即目录**：清单未记录该会话 ⇒ 直接返回 `null`（不读文件、不扫目录），由下游
   * 从会话文档重建该片。命中缓存 0 次 I/O；未命中先查清单（进程内缓存）再读目标文件。
   *
   * @returns 片的**内存视图**（缓存中为同一引用，随后的变更须 `markShardDirty()`）；无片 ⇒ null
   */
  async loadShard(sessionId: string): Promise<FTSShardData | null> {
    const cached = this.shardCache.get(sessionId);
    if (cached) {
      // LRU：命中即提升（Map 迭代序 = 插入/提升序）
      this.shardCache.delete(sessionId);
      this.shardCache.set(sessionId, cached);
      return cached.data;
    }

    const manifest = await this.readManifest();
    const entry = manifest.shards[sessionId];
    if (!entry) return null;

    const data = await this.readShardFile(sessionId);
    if (!data) {
      // 清单有记录却读不出来 ⇒ 损坏（readShardFile 已记 warn）：登记待重建，本次按缺失返回
      this.corruptShardIds.add(sessionId);
      return null;
    }

    this.shardCache.set(sessionId, {
      data,
      dirty: false,
      dirtySeq: 0,
      bytes: entry.bytes,
    });
    this.evictCleanShardsIfNeeded();
    return data;
  }

  /**
   * 建立/替换片的内存视图并标脏（索引写入与片重建使用）。
   *
   * 若该会话已有缓存片，先 `unloadShard()` 丢弃旧视图：否则替换后旧引用仍可能被回写，
   * 形成"陈旧数据覆盖新数据"。
   */
  async putShard(sessionId: string, data: FTSShardData): Promise<void> {
    if (this.shardCache.has(sessionId)) {
      await this.unloadShard(sessionId);
    }
    this.shardCache.set(sessionId, {
      data,
      dirty: true,
      dirtySeq: 1,
      bytes: 0,
    });
    this.evictCleanShardsIfNeeded();
  }

  /**
   * 删除片：内存视图 + 磁盘文件 + 清单条目一并移除（用于 `clear()` / 会话彻底移除）。
   * 文件删除失败仅告警——清单条目已移除，遗留文件不会被读取（下次同名写入会覆盖）。
   */
  async removeShard(sessionId: string): Promise<void> {
    this.shardCache.delete(sessionId);
    this.corruptShardIds.delete(sessionId);
    try {
      await fs.rm(this.shardPath(sessionId), { force: true });
    } catch (err) {
      logger.warn('FTS 片删除失败（清单条目已移除，遗留文件不会被读取）', {
        sessionId,
        error: String(err),
      });
    }
    const manifest = await this.readManifest();
    delete manifest.shards[sessionId];
  }

  /**
   * 标记"该片有未落盘变更"（引擎在文档级变更后调用）。
   *
   * 未加载的片无内存视图可标脏 —— 磁盘即最新，无需回写。
   */
  markShardDirty(sessionId: string): void {
    const entry = this.shardCache.get(sessionId);
    if (!entry) return;
    entry.dirty = true;
    entry.dirtySeq++;
  }

  /** 该片是否有未落盘变更（结构化标记，非字符串判断，CS02） */
  isShardDirty(sessionId: string): boolean {
    return this.shardCache.get(sessionId)?.dirty ?? false;
  }

  /**
   * 显式卸载片（释放内存；片重建/会话删除后**必须**调用，避免陈旧视图被回写）。
   *
   * 先尽力落盘未写变更再丢弃；若仍失败则明确告警后丢弃（索引为派生物，可由会话重建），
   * 不静默保留脏引用。
   */
  async unloadShard(sessionId: string): Promise<void> {
    const entry = this.shardCache.get(sessionId);
    if (!entry) return;
    if (entry.dirty) {
      await this.flushShard(sessionId);
      if (entry.dirty) {
        logger.warn(
          'FTS 片卸载时仍有未落盘变更，已丢弃（索引为派生物，可由会话重建）',
          {
            sessionId,
          }
        );
      }
    }
    this.shardCache.delete(sessionId);
  }

  /**
   * 取走（并清空）"损坏待重建"的会话 id 列表（§8-6 片级重建）。
   * 由**有 storage 的一方**在落盘驱动 tick 中消费：读该会话消息 ⇒ `rebuildSession()`。
   */
  takeCorruptShardIds(): string[] {
    const ids = [...this.corruptShardIds];
    this.corruptShardIds.clear();
    return ids;
  }

  /**
   * 已知片 id（**清单 ∪ 缓存**）。
   *
   * 为什么必须含缓存：新建片在**首次落盘前不在清单里**（清单条目由 `flushShard` 写入）。
   * 若检索只认清单，新会话的消息在下一个落盘 tick（≤60s）前检索不到——M5 回归即此场景
   * （发消息后立即检索须命中）。
   */
  async knownShardIds(): Promise<string[]> {
    const manifest = await this.readManifest();
    const ids = new Set(Object.keys(manifest.shards));
    for (const sessionId of this.shardCache.keys()) ids.add(sessionId);
    return [...ids];
  }

  /** 当前缓存片数（含脏片） */
  get cachedShardCount(): number {
    return this.shardCache.size;
  }

  /** 当前缓存字节数（已写出片的序列化尺寸之和；未写出的脏片按 0 计） */
  get cachedShardBytes(): number {
    let total = 0;
    for (const entry of this.shardCache.values()) total += entry.bytes;
    return total;
  }

  // ───────────────────────── 落盘 ─────────────────────────

  /**
   * 落盘单个片（写入前先取快照，故无 TOCTOU：内容来自内存快照）。
   *
   * 三重保护（与整索引时代 `saveToDisk` 语义一致，下沉到片粒度）：
   * ① **无变更 ⇒ 不 stat、不看文件、不写盘**，直接返回 0；
   * ② 失败**不清脏** ⇒ 下轮重试（KB-FTS-SAVE-LOG：静默丢索引不可接受）；
   * ③ CAS 代际保护：写入期间的文档级变更（`dirtySeq` 变化）不被「已落盘」抹掉。
   *
   * @returns 写入字节数；跳过（无缓存/不脏/写失败）⇒ 0
   */
  async flushShard(sessionId: string): Promise<number> {
    const entry = this.shardCache.get(sessionId);
    if (!entry || !entry.dirty) return 0;

    const documents = Array.from(entry.data.documents.entries());
    let contentLength = 0;
    for (const [, doc] of documents) contentLength += doc.content.length;

    // CS05（2026-09-18）教训：Set 不能直接 JSON.stringify（序列化为 `{}`）⇒ 落盘前转数组
    const invertedIndex: Array<[string, string[]]> = [];
    for (const [term, ids] of entry.data.invertedIndex) {
      invertedIndex.push([term, Array.from(ids)]);
    }

    const seqAtStart = entry.dirtySeq;
    const payload: FTSShardFile = { sessionId, documents, invertedIndex };

    let bytes: number;
    try {
      // 单片小（实测均值约 2.2 MB）⇒ 单次 stringify 可接受，无需整索引时代的流式分片
      bytes = await this.writer.write(
        this.shardPath(sessionId),
        JSON.stringify(payload)
      );
    } catch (err) {
      logger.warn('FTS 片写入失败（保留脏标记，下轮重试）', {
        sessionId,
        error: String(err),
      });
      return 0;
    }

    if (entry.dirtySeq === seqAtStart) entry.dirty = false;
    entry.bytes = bytes;

    const manifest = await this.readManifest();
    manifest.shards[sessionId] = {
      docCount: documents.length,
      contentLength,
      termCount: invertedIndex.length,
      bytes,
    };
    return bytes;
  }

  /**
   * 落盘全部**脏片**（§8-4 驱动入口：定时器/关闭时调用）。
   *
   * **无脏片 ⇒ 立即返回 0**：不建目录、不写盘、不重写清单 —— 空闲系统上定时器零写盘
   * （对齐 `saveToDisk` P2-18 的「无变更跳过」，杜绝 60s 全量 403MB 重写）。
   * 清单在片写入后**只重写一次**（不是每片一次）。
   *
   * @returns 写入总字节数；无脏片或全部写失败 ⇒ 0
   */
  async flushPendingShards(): Promise<number> {
    const dirtyShardIds: string[] = [];
    for (const [sessionId, entry] of this.shardCache) {
      if (entry.dirty) dirtyShardIds.push(sessionId);
    }
    if (dirtyShardIds.length === 0) return 0;

    let totalBytes = 0;
    for (const sessionId of dirtyShardIds) {
      totalBytes += await this.flushShard(sessionId);
    }
    if (totalBytes === 0) return 0;

    await this.flushManifest();
    // 落盘后这些片已转**干净**，可安全压回缓存上限：否则"整目录重建"会把全部片
    // 留在内存（实测 156 片 ⇒ RSS 峰值 3052MB），且干净片只在**新插入**时才淘汰 ⇒ 长期驻留
    this.evictCleanShardsIfNeeded();
    return totalBytes;
  }

  // ───────────────────────── LRU（只淘汰干净片） ─────────────────────────

  /**
   * 仅淘汰**干净**片（脏片是未落盘工作集，淘汰即丢变更；且不在缓存就无法把它写出来）。
   * 干净片在盘上有权威副本 ⇒ 淘汰后按需回读，无需重新序列化。
   *
   * @returns 淘汰片数
   */
  private evictCleanShardsIfNeeded(): number {
    let evicted = 0;
    while (this.shardCache.size > this.maxCachedShards) {
      const victim = this.oldestCleanShardId();
      if (!victim) break;
      this.shardCache.delete(victim);
      evicted++;
    }
    while (this.cachedShardBytes > this.maxCachedBytes) {
      const victim = this.oldestCleanShardId();
      if (!victim) break;
      this.shardCache.delete(victim);
      evicted++;
    }
    return evicted;
  }

  /** 最久未使用的**干净**片（Map 迭代序 = 插入/提升序） */
  private oldestCleanShardId(): string | undefined {
    for (const [sessionId, entry] of this.shardCache) {
      if (!entry.dirty) return sessionId;
    }
    return undefined;
  }

  // ───────────────────────── 内部：读片 ─────────────────────────

  /**
   * 从盘读片并构建内存视图。
   *
   * 不可用形态（读取失败 / JSON 损坏 / 结构非法 / **文件内 `sessionId` 与请求不符**）
   * 一律返回 `null`（不抛）：由下游从会话文档重建该片。`sessionId` 自述校验用于兜底
   * 文件名净化碰撞/内容错位——宁可重建，不可把别的会话的片当自己的用。
   */
  private async readShardFile(sessionId: string): Promise<FTSShardData | null> {
    const target = this.shardPath(sessionId);
    let raw: string;
    try {
      raw = await fs.readFile(target, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        logger.warn('FTS 片读取失败，按缺失处理（由下游重建）', {
          sessionId,
          error: String(err),
        });
      }
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn('FTS 片解析失败，按缺失处理（由下游重建）', {
        sessionId,
        error: String(err),
      });
      return null;
    }

    const file = parseShardFile(parsed);
    if (!file || file.sessionId !== sessionId) {
      logger.warn(
        'FTS 片结构非法或 sessionId 不匹配，按缺失处理（由下游重建）',
        {
          sessionId,
          fileBytes: raw.length,
        }
      );
      return null;
    }

    return {
      documents: new Map(file.documents),
      invertedIndex: new Map(
        file.invertedIndex.map(([term, ids]) => [term, new Set(ids)])
      ),
    };
  }
}
