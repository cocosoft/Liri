/**
 * MediaCache 媒体文件缓存
 * 为各通道提供图片/音频/视频/文件的本地缓存服务
 * 支持 LRU 淘汰、TTL 过期、磁盘持久化和下载即缓存
 */

import { resolveDataSubDir } from '@modules/core/paths';
import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  readdir,
  stat,
} from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/** 媒体类型枚举 */
export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'other';

/** 媒体缓存条目元数据 */
export interface MediaMeta {
  /** URL 或来源标识 */
  source: string;
  /** 媒体类型 */
  mediaType: MediaType;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 缓存时间戳 */
  cachedAt: number;
  /** 最后访问时间戳 */
  lastAccessed: number;
  /** 访问次数 */
  accessCount: number;
  /** 宽（仅图片/视频） */
  width?: number;
  /** 高（仅图片/视频） */
  height?: number;
  /** 持续时间（秒，仅音频/视频） */
  duration?: number;
  /** 原始文件名 */
  fileName?: string;
}

/** 缓存命中结果 */
export interface MediaCacheHit {
  meta: MediaMeta;
  data: Buffer;
  fromDisk: boolean;
}

/** 缓存配置 */
export interface MediaCacheConfig {
  /** 缓存目录（默认 data/cache/media/） */
  cacheDir?: string;
  /** 最大磁盘使用量（字节，默认 500MB） */
  maxDiskBytes?: number;
  /** 最大内存条目数（默认 100） */
  maxMemoryItems?: number;
  /** 默认 TTL（毫秒，默认 24 小时） */
  defaultTTL?: number;
  /** 清理间隔（毫秒，默认 5 分钟） */
  cleanupInterval?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<MediaCacheConfig> = {
  cacheDir: resolveDataSubDir('cache/media'),
  maxDiskBytes: 500 * 1024 * 1024,
  maxMemoryItems: 100,
  defaultTTL: 24 * 60 * 60 * 1000,
  cleanupInterval: 5 * 60 * 1000,
};

/** 内存缓存节点 */
interface MemoryNode {
  key: string;
  meta: MediaMeta;
  data: Buffer;
  expiresAt: number;
  prev: MemoryNode | null;
  next: MemoryNode | null;
}

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.ico',
]);

/** 支持的音频扩展名 */
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
]);

/** 支持的视频扩展名 */
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.avi',
  '.mov',
  '.mkv',
  '.flv',
  '.wmv',
]);

/**
 * 根据文件名推断媒体类型
 */
function inferMediaType(fileName: string): MediaType {
  const ext = extname(fileName).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (ext === '.pdf' || ext === '.doc' || ext === '.docx' || ext === '.zip')
    return 'document';

  return 'other';
}

/**
 * 根据 Content-Type 推断媒体类型
 */
function inferMediaTypeFromMime(mime: string): MediaType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.includes('pdf') || mime.includes('document') || mime.includes('zip'))
    return 'document';

  return 'other';
}

/**
 * MediaCache - 通道媒体文件缓存
 *
 * 特性：
 * - 自动从 URL 下载并缓存媒体文件
 * - 双级缓存：内存 LRU + 磁盘持久化
 * - TTL 过期自动清理
 * - LRU 淘汰策略
 * - 磁盘用量监控与自动清理
 */
export class MediaCache {
  private config: Required<MediaCacheConfig>;

  /** 内存 LRU 缓存 */
  private memCache: Map<string, MemoryNode> = new Map();
  private memHead: MemoryNode | null = null;
  private memTail: MemoryNode | null = null;

  /** 统计 */
  private hits = 0;
  private misses = 0;
  private diskHits = 0;
  private bytesDownloaded = 0;
  private bytesServedFromCache = 0;

  /** 清理定时器 */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** 初始化状态 */
  private initialized = false;

  constructor(config?: MediaCacheConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化缓存系统
   * 创建缓存目录并启动清理定时器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await mkdir(this.config.cacheDir, { recursive: true });
    this.initialized = true;

    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.error('MediaCache 清理失败', {
          error: String(err),
        });
      });
    }, this.config.cleanupInterval);

    logger.info('MediaCache 已初始化', {
      cacheDir: this.config.cacheDir,
      maxDiskBytes: this.config.maxDiskBytes,
      maxMemoryItems: this.config.maxMemoryItems,
    });
  }

  /**
   * 获取媒体文件缓存
   * 尝试内存 → 磁盘 → 下载三级查找
   *
   * @param url 媒体 URL
   * @param ttl 自定义 TTL（可选）
   */
  async get(url: string, ttl?: number): Promise<MediaCacheHit> {
    const key = this.hashKey(url);
    const effectiveTTL = ttl ?? this.config.defaultTTL;

    // 1. 尝试内存缓存
    const memNode = this.memCache.get(key);
    if (memNode && Date.now() < memNode.expiresAt) {
      this.hits++;
      memNode.meta.accessCount++;
      memNode.meta.lastAccessed = Date.now();
      this.moveToHead(memNode);

      this.bytesServedFromCache += memNode.data.length;

      return { meta: memNode.meta, data: memNode.data, fromDisk: false };
    }

    // 内存中有但已过期
    if (memNode) {
      this.removeNode(memNode);
      this.memCache.delete(key);
    }

    // 2. 尝试磁盘缓存
    const diskPath = this.diskPath(key);
    try {
      const diskMeta = await this.readDiskMeta(key);
      if (diskMeta && Date.now() - diskMeta.cachedAt < effectiveTTL) {
        const data = await readFile(diskPath);
        this.diskHits++;
        this.hits++;

        diskMeta.accessCount++;
        diskMeta.lastAccessed = Date.now();

        // 回填到内存
        this.setMemory(key, data, diskMeta, effectiveTTL);

        this.bytesServedFromCache += data.length;

        return { meta: diskMeta, data, fromDisk: true };
      }
    } catch {
      // 磁盘缓存不可用，忽略
    }

    // 3. 下载并缓存
    this.misses++;

    return this.downloadAndCache(url, key, effectiveTTL);
  }

  /**
   * 手动存入缓存
   *
   * @param key 缓存键
   * @param data 二进制数据
   * @param meta 元数据
   * @param ttl 自定义 TTL（可选）
   */
  async set(
    key: string,
    data: Buffer,
    meta: MediaMeta,
    ttl?: number
  ): Promise<void> {
    const cacheKey = this.hashKey(key);
    const effectiveTTL = ttl ?? this.config.defaultTTL;

    meta.cachedAt = Date.now();
    meta.lastAccessed = Date.now();
    meta.accessCount = 0;

    // 写入内存
    this.setMemory(cacheKey, data, meta, effectiveTTL);

    // 写入磁盘
    await this.writeToDisk(cacheKey, data, meta);
  }

  /**
   * 检查缓存是否存在且未过期
   */
  async has(url: string, ttl?: number): Promise<boolean> {
    const key = this.hashKey(url);
    const effectiveTTL = ttl ?? this.config.defaultTTL;

    // 检查内存
    const memNode = this.memCache.get(key);
    if (memNode && Date.now() < memNode.expiresAt) return true;

    // 检查磁盘
    try {
      const diskMeta = await this.readDiskMeta(key);
      if (diskMeta && Date.now() - diskMeta.cachedAt < effectiveTTL)
        return true;
    } catch {
      return false;
    }

    return false;
  }

  /**
   * 删除指定缓存
   */
  async delete(url: string): Promise<boolean> {
    const key = this.hashKey(url);
    let removed = false;

    // 删除内存缓存
    const memNode = this.memCache.get(key);
    if (memNode) {
      this.removeNode(memNode);
      this.memCache.delete(key);
      removed = true;
    }

    // 删除磁盘缓存
    try {
      await unlink(this.diskPath(key));
      removed = true;
    } catch {
      // 磁盘文件不存在
    }

    return removed;
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    this.memCache.clear();
    this.memHead = null;
    this.memTail = null;
    this.hits = 0;
    this.misses = 0;
    this.diskHits = 0;
    this.bytesDownloaded = 0;
    this.bytesServedFromCache = 0;

    try {
      const files = await readdir(this.config.cacheDir);
      await Promise.all(
        files.map((f) => unlink(join(this.config.cacheDir, f)).catch(() => {}))
      );
    } catch {
      // 目录可能不存在
    }

    logger.info('MediaCache 已清空');
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    memoryItems: number;
    hits: number;
    misses: number;
    diskHits: number;
    hitRate: number;
    bytesDownloaded: number;
    bytesServedFromCache: number;
    totalBytes: number;
  } {
    const total = this.hits + this.misses;

    let totalBytes = 0;
    for (const node of this.memCache.values()) {
      totalBytes += node.data.length;
    }

    return {
      memoryItems: this.memCache.size,
      hits: this.hits,
      misses: this.misses,
      diskHits: this.diskHits,
      hitRate: total > 0 ? this.hits / total : 0,
      bytesDownloaded: this.bytesDownloaded,
      bytesServedFromCache: this.bytesServedFromCache,
      totalBytes,
    };
  }

  /**
   * 清理过期缓存条目
   * 由定时器自动调用
   */
  async cleanup(): Promise<{ removed: number; freedBytes: number }> {
    let removed = 0;
    let freedBytes = 0;

    // 清理过期内存条目
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, node] of this.memCache) {
      if (now >= node.expiresAt) {
        expiredKeys.push(key);
        freedBytes += node.data.length;
      }
    }

    for (const key of expiredKeys) {
      const node = this.memCache.get(key);
      if (node) {
        this.removeNode(node);
        this.memCache.delete(key);
      }
    }
    removed += expiredKeys.length;

    // 检查磁盘用量并清理
    try {
      const diskUsage = await this.calculateDiskUsage();
      if (diskUsage > this.config.maxDiskBytes) {
        const files = await readdir(this.config.cacheDir);
        const fileStats = await Promise.all(
          files.map(async (f) => {
            const p = join(this.config.cacheDir, f);
            try {
              const s = await stat(p);
              return { name: f, path: p, mtimeMs: s.mtimeMs, size: s.size };
            } catch {
              return null;
            }
          })
        );

        const validStats = fileStats
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .sort((a, b) => a.mtimeMs - b.mtimeMs);

        let excess = diskUsage - this.config.maxDiskBytes;
        for (const file of validStats) {
          if (excess <= 0) break;
          try {
            await unlink(file.path);
            freedBytes += file.size;
            removed++;
            excess -= file.size;
          } catch {
            // 文件可能已被删除
          }
        }
      }
    } catch {
      // 磁盘不可用
    }

    if (removed > 0) {
      logger.info('MediaCache 清理完成', { removed, freedBytes });
    }

    return { removed, freedBytes };
  }

  /**
   * 关闭缓存系统
   * 停止定时器并释放资源
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.memCache.clear();
    this.memHead = null;
    this.memTail = null;

    logger.info('MediaCache 已关闭');
  }

  /** 生成缓存键的哈希值 */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 32);
  }

  /** 获取磁盘缓存文件路径 */
  private diskPath(key: string): string {
    return join(this.config.cacheDir, key);
  }

  /** 获取磁盘元数据文件路径 */
  private metaPath(key: string): string {
    return join(this.config.cacheDir, `${key}.meta.json`);
  }

  /** 读取磁盘元数据 */
  private async readDiskMeta(key: string): Promise<MediaMeta | null> {
    try {
      const content = await readFile(this.metaPath(key), 'utf-8');
      return JSON.parse(content) as MediaMeta;
    } catch {
      return null;
    }
  }

  /** 写入磁盘缓存 */
  private async writeToDisk(
    key: string,
    data: Buffer,
    meta: MediaMeta
  ): Promise<void> {
    try {
      await writeFile(this.diskPath(key), data);
      await writeFile(this.metaPath(key), JSON.stringify(meta));
    } catch (err) {
      logger.warning('MediaCache 磁盘写入失败', {
        key,
        error: String(err),
      });
    }
  }

  /** 写入内存 LRU 缓存 */
  private setMemory(
    key: string,
    data: Buffer,
    meta: MediaMeta,
    ttl: number
  ): void {
    if (
      this.memCache.size >= this.config.maxMemoryItems &&
      !this.memCache.has(key)
    ) {
      this.evictTail();
    }

    const existing = this.memCache.get(key);
    if (existing) {
      existing.data = data;
      existing.meta = {
        ...meta,
        cachedAt: Date.now(),
        lastAccessed: Date.now(),
      };
      existing.expiresAt = Date.now() + ttl;
      this.moveToHead(existing);
      return;
    }

    const node: MemoryNode = {
      key,
      meta: { ...meta, cachedAt: Date.now(), lastAccessed: Date.now() },
      data,
      expiresAt: Date.now() + ttl,
      prev: null,
      next: null,
    };

    this.memCache.set(key, node);
    this.addToHead(node);
  }

  /** 下载 URL 并缓存 */
  private async downloadAndCache(
    url: string,
    key: string,
    ttl: number
  ): Promise<MediaCacheHit> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(
        `下载媒体失败: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    const mimeType =
      response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition =
      response.headers.get('content-disposition') || '';
    const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    const fileName = fileNameMatch
      ? fileNameMatch[1]
      : url.split('/').pop() || 'media';

    const mediaType = inferMediaTypeFromMime(mimeType);
    const meta: MediaMeta = {
      source: url,
      mediaType,
      mimeType,
      size: data.length,
      cachedAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 1,
      fileName,
    };

    this.bytesDownloaded += data.length;

    // 写入内存
    this.setMemory(key, data, meta, ttl);

    // 异步写入磁盘（不阻塞返回）
    this.writeToDisk(key, data, meta).catch((err) => {
      logger.warning('MediaCache 异步磁盘写入失败', {
        error: String(err),
        url,
      });
    });

    return { meta, data, fromDisk: false };
  }

  /** 计算当前磁盘使用量 */
  private async calculateDiskUsage(): Promise<number> {
    let total = 0;
    try {
      const files = await readdir(this.config.cacheDir);
      for (const file of files) {
        if (file.endsWith('.meta.json')) continue;
        try {
          const s = await stat(join(this.config.cacheDir, file));
          total += s.size;
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      return 0;
    }
    return total;
  }

  // ─── LRU 链表操作 ───

  private addToHead(node: MemoryNode): void {
    node.prev = null;
    node.next = this.memHead;

    if (this.memHead) {
      this.memHead.prev = node;
    }

    this.memHead = node;

    if (!this.memTail) {
      this.memTail = node;
    }
  }

  private removeNode(node: MemoryNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.memHead = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.memTail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private moveToHead(node: MemoryNode): void {
    if (node === this.memHead) return;

    this.removeNode(node);
    this.addToHead(node);
  }

  private evictTail(): void {
    if (!this.memTail) return;

    const key = this.memTail.key;
    this.removeNode(this.memTail);
    this.memCache.delete(key);
  }
}

/** 全局单例 */
export const mediaCache = new MediaCache();
