/**
 * ApprovalCache — 审批缓存
 *
 * 同一 session 内同一工具审批结果缓存（默认 5 分钟）。
 * 用户批准一个工具后，后续调用不再重复询问。
 *
 * 集成方式（在 PermissionManager 中）：
 * ```
 * const cache = new ApprovalCache();
 * ...
 * async checkPermission(toolName, input, context) {
 *   const cached = cache.get(sessionId, toolName);
 *   if (cached) return cached;  // 直接返回缓存结果
 *   const decision = await this.doActualCheck(toolName, input, context);
 *   if (decision.type === 'allow') {
 *     cache.set(sessionId, toolName, decision);
 *   }
 *   return decision;
 * }
 * ```
 */

/**
 * 审批缓存的每条记录
 */
interface ApprovalEntry {
  toolName: string;
  expiresAt: number;
  sessionId: string;
  cachedAt: number;
}

/**
 * ApprovalCache 配置
 */
export interface ApprovalCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 分钟
const DEFAULT_MAX_ENTRIES = 200;

export class ApprovalCache {
  private entries: Map<string, ApprovalEntry> = new Map();

  private options: Required<ApprovalCacheOptions>;

  constructor(options: ApprovalCacheOptions = {}) {
    this.options = {
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    };
  }

  /**
   * 生成缓存 key（session + toolName）
   */
  private makeKey(sessionId: string, toolName: string): string {
    return `${sessionId}::${toolName}`;
  }

  /**
   * 记录审批通过（缓存该工具的审批结果）
   */
  set(sessionId: string, toolName: string): void {
    if (this.entries.size >= this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    const key = this.makeKey(sessionId, toolName);
    this.entries.set(key, {
      toolName,
      sessionId,
      expiresAt: Date.now() + this.options.ttlMs,
      cachedAt: Date.now(),
    });
  }

  /**
   * 检查审批缓存是否命中
   */
  get(sessionId: string, toolName: string): boolean {
    const key = this.makeKey(sessionId, toolName);
    const entry = this.entries.get(key);

    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 清除指定 session 的所有审批缓存
   */
  clearSession(sessionId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * 清除指定工具的审批缓存（跨 session）
   */
  clearTool(toolName: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.toolName === toolName) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * 手动淘汰过期条目
   */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * 清空所有审批缓存
   */
  clearAll(): void {
    this.entries.clear();
  }

  /**
   * 判断指定 key 是否存在且未过期
   */
  has(sessionId: string, toolName: string): boolean {
    return this.get(sessionId, toolName);
  }

  /**
   * 获取缓存统计
   */
  stats(): { entries: number; toolCount: number; sessionCount: number } {
    const sessions = new Set<string>();
    const tools = new Set<string>();

    for (const entry of this.entries.values()) {
      sessions.add(entry.sessionId);
      tools.add(entry.toolName);
    }

    return {
      entries: this.entries.size,
      toolCount: tools.size,
      sessionCount: sessions.size,
    };
  }
}
