import { LRUCache } from 'lru-cache';
import { normalize } from 'path';

export type FileState = {
  content: string;
  timestamp: number;
  offset: number | undefined;
  limit: number | undefined;
  // True when this entry was populated by auto-injection (e.g. Liri.md) and
  // the injected content did not match disk (stripped HTML comments, stripped
  // frontmatter, truncated MEMORY.md). The model has only seen a partial view;
  // Edit/Write must require an explicit Read first. `content` here holds the
  // RAW disk bytes (for getChangedFiles diffing), not what the model saw.
  isPartialView?: boolean;
  // B1：文件 mtime（ms）。FileReadTool 记录，FileEditTool 用其做写前新鲜度校验
  // （mtime 比对避免编码感知读取带来的内容差异误报）
  mtimeMs?: number;
};

// Default max entries for read file state caches
export const READ_FILE_STATE_CACHE_SIZE = 100;

// Default size limit for file state caches (25MB)
// This prevents unbounded memory growth from large file contents
const DEFAULT_MAX_CACHE_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * A file state cache that normalizes all path keys before access.
 * This ensures consistent cache hits regardless of whether callers pass
 * relative vs absolute paths with redundant segments (e.g. /foo/../bar)
 * or mixed path separators on Windows (/ vs \).
 */
export class FileStateCache {
  private cache: LRUCache<string, FileState>;

  constructor(maxEntries: number, maxSizeBytes: number) {
    this.cache = new LRUCache<string, FileState>({
      max: maxEntries,
      maxSize: maxSizeBytes,
      sizeCalculation: (value) => Math.max(1, Buffer.byteLength(value.content)),
    });
  }

  get(key: string): FileState | undefined {
    return this.cache.get(normalize(key));
  }

  set(key: string, value: FileState): this {
    this.cache.set(normalize(key), value);
    return this;
  }

  has(key: string): boolean {
    return this.cache.has(normalize(key));
  }

  delete(key: string): boolean {
    return this.cache.delete(normalize(key));
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  get max(): number {
    return this.cache.max;
  }

  get maxSize(): number {
    return this.cache.maxSize;
  }

  get calculatedSize(): number {
    return this.cache.calculatedSize;
  }

  keys(): Generator<string> {
    return this.cache.keys();
  }

  entries(): Generator<[string, FileState]> {
    return this.cache.entries();
  }

  dump(): ReturnType<LRUCache<string, FileState>['dump']> {
    return this.cache.dump();
  }

  load(entries: ReturnType<LRUCache<string, FileState>['dump']>): void {
    this.cache.load(entries);
  }
}

/**
 * Factory function to create a size-limited FileStateCache.
 * Uses LRUCache's built-in size-based eviction to prevent memory bloat.
 * Note: Images are not cached (see FileReadTool) so size limit is mainly
 * for large text files, notebooks, and other editable content.
 */
export function createFileStateCacheWithSizeLimit(
  maxEntries: number,
  maxSizeBytes: number = DEFAULT_MAX_CACHE_SIZE_BYTES
): FileStateCache {
  return new FileStateCache(maxEntries, maxSizeBytes);
}

// Helper function to convert cache to object (used by compact.ts)
export function cacheToObject(
  cache: FileStateCache
): Record<string, FileState> {
  return Object.fromEntries(cache.entries());
}

// Helper function to get all keys from cache (used by several components)
export function cacheKeys(cache: FileStateCache): string[] {
  return Array.from(cache.keys());
}

// Helper function to clone a FileStateCache
// Preserves size limit configuration from the source cache
export function cloneFileStateCache(cache: FileStateCache): FileStateCache {
  const cloned = createFileStateCacheWithSizeLimit(cache.max, cache.maxSize);
  cloned.load(cache.dump());
  return cloned;
}

/**
 * B1：从 ToolUseContext.readFileState（unknown）中提取可用的文件状态缓存。
 *
 * 兼容三种形态：
 *   - FileStateCache 实例（mcp.ts 已使用）
 *   - 结构等价的缓存对象（含 get/set/has/delete）
 *   - 普通空对象 / 未提供（返回 null，工具回退为宽松行为，不破坏既有调用方）
 */
export function resolveReadFileState(
  readFileState: unknown
): FileStateCache | null {
  if (readFileState == null || typeof readFileState !== 'object') return null;
  if (readFileState instanceof FileStateCache) return readFileState;
  const candidate = readFileState as {
    get?: unknown;
    set?: unknown;
    has?: unknown;
    delete?: unknown;
  };
  if (
    typeof candidate.get === 'function' &&
    typeof candidate.set === 'function' &&
    typeof candidate.has === 'function' &&
    typeof candidate.delete === 'function'
  ) {
    return candidate as unknown as FileStateCache;
  }
  return null;
}

// Merge two file state caches, with more recent entries (by timestamp) overriding older ones
export function mergeFileStateCaches(
  first: FileStateCache,
  second: FileStateCache
): FileStateCache {
  const merged = cloneFileStateCache(first);
  for (const [filePath, fileState] of second.entries()) {
    const existing = merged.get(filePath);
    // Only override if the new entry is more recent
    if (!existing || fileState.timestamp > existing.timestamp) {
      merged.set(filePath, fileState);
    }
  }
  return merged;
}
