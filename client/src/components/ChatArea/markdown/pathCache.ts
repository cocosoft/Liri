/**
 * 文件路径解析缓存 — MarkdownRenderer V1/V2 共享
 * MIT License
 *
 * 模块级单例，避免同一条消息中重复请求相同路径
 */

/** 缓存条目：存储规范路径及其别名集合 */
export interface PathCacheEntry {
  canonical: string;
  /** 别名列表（大小写变体、无扩展名变体等），用于快速查找 */
  aliases: Set<string>;
}

/** 已解析路径缓存 */
export const pathResolveCache = new Map<string, PathCacheEntry>();

/** 进行中的请求去重集合 */
export const pathResolvePending = new Set<string>();

/**
 * 多级 fallback 文件路径匹配
 * 按优先级依次尝试：精确匹配 → 不区分大小写 → 无扩展名匹配 → 后缀包含匹配
 */
export function matchFilePath(mention: string, knownPaths: string[]): string | null {
  // 1. 精确匹配
  const exact = knownPaths.find(p => p === mention);
  if (exact) return exact;

  // 2. 不区分大小写匹配（处理 Windows 大小写不敏感问题）
  const mentionLower = mention.toLowerCase();
  const caseInsensitive = knownPaths.find(p => p.toLowerCase() === mentionLower);
  if (caseInsensitive) return caseInsensitive;

  // 3. 无扩展名匹配（用户提及 app/src/main 但真实路径为 app/src/main.ts）
  const mentionNoExt = mentionLower.replace(/\.\w+$/, '');
  const extMatch = knownPaths.find(p =>
    p.replace(/\.\w+$/, '').toLowerCase() === mentionNoExt
  );
  if (extMatch) return extMatch;

  // 4. 路径后缀匹配（处理 LLM 截断：提及 src/main.ts 但真实路径为 app/src/main.ts）
  const tailMatch = knownPaths.find(p =>
    p.toLowerCase().endsWith(mentionLower)
  );
  if (tailMatch) return tailMatch;

  return null;
}

/**
 * 向缓存添加条目，同时生成并存储别名（方便后续快速查找）
 */
export function setPathCache(key: string, canonical: string): void {
  const aliases = new Set<string>();
  aliases.add(canonical.toLowerCase());
  // 无扩展名别名
  const noExt = canonical.replace(/\.\w+$/, '');
  if (noExt !== canonical) aliases.add(noExt.toLowerCase());
  // 路径后缀别名（逐级回退）
  const parts = canonical.replace(/[\\/]/g, '/').split('/');
  let suffix = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    suffix = suffix ? `${parts[i]}/${suffix}` : parts[i];
    aliases.add(suffix.toLowerCase());
  }
  pathResolveCache.set(key, { canonical, aliases });

  // 同时用所有别名索引该条目，使后续查询能通过别名直接命中
  for (const alias of aliases) {
    // 仅当别名键不存在或指向不同 canonical 时才覆盖
    if (!pathResolveCache.has(alias) || pathResolveCache.get(alias)!.canonical !== canonical) {
      pathResolveCache.set(alias, { canonical, aliases });
    }
  }
}