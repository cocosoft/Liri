/**
 * 文件路径解析缓存 — MarkdownRenderer V1/V2 共享
 * MIT License
 *
 * 模块级单例，避免同一条消息中重复请求相同路径。
 * 使用 sessionId 作为 key 前缀实现会话级隔离。
 *
 * v2: 添加 TTL 过期机制，解决 FileLink 不稳定问题
 *   - 正向缓存 TTL: 5 分钟
 *   - 负缓存 (文件不存在) TTL: 30 秒（允许快速重试）
 */

/** 缓存条目：存储规范路径及其别名集合 */
export interface PathCacheEntry {
  canonical: string;
  /** 别名列表（大小写变体、无扩展名变体等），用于快速查找 */
  aliases: Set<string>;
  /** 缓存创建时间 (monotonic clock ms，防 NTP 跳变) */
  createdAt: number;
  /** 是否为否定缓存（后端确认文件不存在） */
  isNegative: boolean;
}

/** 正向缓存 TTL: 5 分钟 */
const POSITIVE_CACHE_TTL_MS = 5 * 60 * 1000;

/** 负缓存 TTL: 30 秒（文件可能被临时移除后恢复） */
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

/** 会话级缓存 key 前缀分隔符 */
const SESSION_KEY_SEPARATOR = "::";

/** 已解析路径缓存 */
export const pathResolveCache = new Map<string, PathCacheEntry>();

/** 进行中的请求去重集合 */
export const pathResolvePending = new Set<string>();

/**
 * BUG-5 修复：别名候选索引 aliasKey → 规范化 key 集合
 * 同一别名（如 main.ts）可能对应多个不同文件（client/src/main.ts vs app/src/main.ts），
 * 用 Set 累积候选而非覆盖，避免"后写覆盖先写"导致的指向漂移。
 */
const pathAliasCandidates = new Map<string, Set<string>>();

/**
 * 生成带 sessionId 的缓存 key
 * P2-11 修复：filePath 统一 toLowerCase —— 大小写归一化收敛在 key 生成处（唯一入口），
 * 写入（setPathCache）/ 读取（getCacheEntry）/ 失效（invalidateCacheEntry）三方天然一致。
 * sessionId 是精确标识符，保持原始大小写。
 */
export function getCacheKey(sessionId: string, filePath: string): string {
  return `${sessionId}${SESSION_KEY_SEPARATOR}${filePath.toLowerCase()}`;
}

/**
 * 从缓存获取条目，自动处理 TTL 过期
 * @param key 必须经 getCacheKey() 生成（大小写已归一化）
 * @returns 有效条目或 null（已过期/不存在）
 */
export function getCacheEntry(key: string): PathCacheEntry | null {
  const entry = pathResolveCache.get(key);
  if (entry) {
    // BUG11 修复：使用 monotonic clock 防止 NTP/夏令时跳变导致缓存异常
    const now = performance.now();
    const ttl = entry.isNegative
      ? NEGATIVE_CACHE_TTL_MS
      : POSITIVE_CACHE_TTL_MS;
    if (now - entry.createdAt > ttl) {
      // 过期：删除并触发后台刷新
      pathResolveCache.delete(key);
      return null;
    }
    return entry;
  }
  // BUG-5 修复：别名候选消歧 —— 仅当唯一候选时经规范化 key 命中；
  // 多个候选（同名不同目录）视为歧义返回 null，交由异步 resolve 决定，不再漂移
  const candidates = pathAliasCandidates.get(key);
  if (candidates && candidates.size === 1) {
    const [canonicalKey] = candidates;
    if (canonicalKey !== key) return getCacheEntry(canonicalKey);
  }
  return null;
}

/**
 * 清除失效的缓存条目（用于 FileLink 点击失败时清除对应缓存）
 */
export function invalidateCacheEntry(key: string): void {
  pathResolveCache.delete(key);
}

/**
 * 多级 fallback 文件路径匹配
 * 按优先级依次尝试：精确匹配 → 不区分大小写 → 无扩展名匹配 → 后缀包含匹配
 */
export function matchFilePath(
  mention: string,
  knownPaths: string[],
): string | null {
  // 1. 精确匹配
  const exact = knownPaths.find((p) => p === mention);
  if (exact) return exact;

  // 2. 不区分大小写匹配（处理 Windows 大小写不敏感问题）
  const mentionLower = mention.toLowerCase();
  const caseInsensitive = knownPaths.find(
    (p) => p.toLowerCase() === mentionLower,
  );
  if (caseInsensitive) return caseInsensitive;

  // 3. 无扩展名匹配（用户提及 app/src/main 但真实路径为 app/src/main.ts）
  const mentionNoExt = mentionLower.replace(/\.\w+$/, "");
  const extMatch = knownPaths.find(
    (p) => p.replace(/\.\w+$/, "").toLowerCase() === mentionNoExt,
  );
  if (extMatch) return extMatch;

  // 4. 路径后缀匹配（处理 LLM 截断：提及 src/main.ts 但真实路径为 app/src/main.ts）
  // BUG-3 修复：endsWith 命中多个候选（如 client/src/FileLink.tsx vs app/data/knowledge/raw/FileLink.tsx）时，
  // find 返回数组第一个可能指错；改为取路径最短者（最接近完整提及）
  const tailMatches = knownPaths.filter((p) =>
    p.toLowerCase().endsWith(mentionLower),
  );
  if (tailMatches.length > 0) {
    return tailMatches.reduce((best, p) => (p.length < best.length ? p : best));
  }

  return null;
}

/**
 * 清除所有路径缓存（会话切换时调用，防止旧会话路径残留）
 */
export function clearPathCache(): void {
  pathResolveCache.clear();
  pathResolvePending.clear();
  pathAliasCandidates.clear();
}

/**
 * 向缓存添加条目，同时生成并存储别名（方便后续快速查找）
 * @param sessionId 当前会话 ID，用于会话级隔离
 * @param key 缓存 key（原始路径）
 * @param canonical 规范路径（空字符串表示文件不存在 — 负缓存）
 */
export function setPathCache(
  sessionId: string,
  key: string,
  canonical: string,
): void {
  const isNegative = canonical === "";
  const sessionKey = getCacheKey(sessionId, key);
  // BUG11 修复：使用 monotonic clock
  const now = performance.now();
  const aliases = new Set<string>();

  if (!isNegative) {
    aliases.add(canonical.toLowerCase());
    // 无扩展名别名
    const noExt = canonical.replace(/\.\w+$/, "");
    if (noExt !== canonical) aliases.add(noExt.toLowerCase());
    // 路径后缀别名（逐级回退）
    const parts = canonical.replace(/[\\/]/g, "/").split("/");
    let suffix = "";
    for (let i = parts.length - 1; i >= 0; i--) {
      suffix = suffix ? `${parts[i]}/${suffix}` : parts[i];
      aliases.add(suffix.toLowerCase());
    }
  }

  const entry: PathCacheEntry = {
    canonical,
    aliases,
    createdAt: now,
    isNegative,
  };
  pathResolveCache.set(sessionKey, entry);

  if (!isNegative) {
    // 规范化 key 也建立映射：mention 与 canonical 不一致（如大小写变体）时，
    // 后续可按 canonical 直接命中
    const canonicalKey = getCacheKey(sessionId, canonical);
    if (canonicalKey !== sessionKey) {
      pathResolveCache.set(canonicalKey, entry);
    }

    // BUG-5 修复：别名索引冲突时不覆盖先写，改为累积候选（aliasKey → Set<canonicalKey>）。
    // 原实现后写覆盖先写，同一消息中 main.ts 指向随网络时序漂移。
    for (const alias of aliases) {
      const aliasKey = getCacheKey(sessionId, alias);
      if (aliasKey === sessionKey || aliasKey === canonicalKey) continue;
      let candidates = pathAliasCandidates.get(aliasKey);
      if (!candidates) {
        candidates = new Set();
        pathAliasCandidates.set(aliasKey, candidates);
      }
      candidates.add(canonicalKey);
    }
  }
}
