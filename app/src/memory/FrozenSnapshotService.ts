// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FrozenSnapshotService — 会话级记忆冻结快照
 *
 * P1-2: 对标 Anthropic cache_control 优化
 *
 * 会话开始时冻结 Memory 快照到 System Prompt，会话中间所有 Memory
 * 写入不触发 System Prompt 重建，保持 PromptCacheManager 的
 * cache_control 断点持续有效。
 *
 * 原理：
 *   - 首条消息：计算 memoryContext → 冻结 → 注入 System Prompt
 *   - 后续消息：直接返回冻结快照（零 I/O，零 hash 计算）
 *   - 会话结束/切换：unfreeze → 下个会话重新计算
 *
 * 过期策略：1 小时 TTL，防止长时间会话使用过期记忆
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:frozenSnapshot');

interface FrozenEntry {
  content: string;
  frozenAt: number;
}

/** 默认 TTL：1 小时 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export class FrozenSnapshotService {
  private snapshots = new Map<string, FrozenEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * 冻结当前 session 的记忆内容
   * @param sessionId 会话 ID
   * @param content 记忆上下文块（已格式化的 memoryContext）
   */
  freeze(sessionId: string, content: string): void {
    this.snapshots.set(sessionId, {
      content,
      frozenAt: Date.now(),
    });
    logger.debug('frozenSnapshot:frozen', { sessionId });
  }

  /**
   * 获取冻结快照
   * @returns 冻结内容，若不存在或已过期则返回 null
   */
  getFrozen(sessionId: string): string | null {
    const entry = this.snapshots.get(sessionId);
    if (!entry) return null;

    if (Date.now() - entry.frozenAt > this.ttlMs) {
      logger.info('frozenSnapshot:expired', {
        sessionId,
        ageMs: Date.now() - entry.frozenAt,
      });
      this.snapshots.delete(sessionId);
      return null;
    }

    return entry.content;
  }

  /**
   * 检查是否存在有效冻结快照
   */
  isFrozen(sessionId: string): boolean {
    return this.getFrozen(sessionId) !== null;
  }

  /**
   * 解冻指定 session
   */
  unfreeze(sessionId: string): void {
    if (this.snapshots.delete(sessionId)) {
      logger.debug('frozenSnapshot:unfrozen', { sessionId });
    }
  }

  /**
   * 解冻所有 session
   * 在 /clear 或 /compact 时调用
   */
  unfreezeAll(): void {
    const count = this.snapshots.size;
    this.snapshots.clear();
    if (count > 0) {
      logger.info('frozenSnapshot:unfreezeAll', { count });
    }
  }

  /**
   * 获取当前冻结的 session 数量（用于监控）
   */
  get frozenCount(): number {
    return this.snapshots.size;
  }
}

/** 全局单例 */
let instance: FrozenSnapshotService | null = null;

export function getFrozenSnapshotService(): FrozenSnapshotService {
  if (!instance) {
    instance = new FrozenSnapshotService();
  }
  return instance;
}

/** 仅用于测试 — 重置单例 */
export function resetFrozenSnapshotService(): void {
  instance = null;
}
