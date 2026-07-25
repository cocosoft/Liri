/**
 * FileLockManager — 多会话文件级并发锁
 *
 * 防止多个 /goal 任务同时修改同一文件导致冲突。
 * 粘性锁：不自动释放，由 Goal task 完成或取消时显式释放。
 *
 * 使用场景（§11 多会话并发策略）：
 *   - 同一 session 多 /goal → 互斥（session 级 task lock）
 *   - 多 session 不同文件 → 并行
 *   - 多 session 相同文件 → 文件级锁
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'tasks:fileLock' });

interface LockEntry {
  goalId: string;
  sessionId: string;
  acquiredAt: number;
}

export class FileLockManager {
  private locks: Map<string, LockEntry> = new Map();

  /**
   * 尝试获取文件锁
   * @returns true 获取成功，false 文件已被其他 goal task 锁定
   */
  tryAcquire(filePath: string, goalId: string, sessionId: string): boolean {
    const normalized = this.normalizePath(filePath);
    const existing = this.locks.get(normalized);

    if (existing) {
      // 同一 session → 允许（同一个 goal task）
      if (existing.sessionId === sessionId) return true;

      logger.warn('File locked by another session', {
        filePath: normalized,
        lockedBy: existing.goalId,
        requestedBy: goalId,
      });
      return false;
    }

    this.locks.set(normalized, { goalId, sessionId, acquiredAt: Date.now() });
    logger.info('File lock acquired', { filePath: normalized, goalId });
    return true;
  }

  /**
   * 释放文件锁
   */
  release(filePath: string, goalId: string): void {
    const normalized = this.normalizePath(filePath);
    const entry = this.locks.get(normalized);

    if (entry && entry.goalId === goalId) {
      this.locks.delete(normalized);
      logger.info('File lock released', { filePath: normalized, goalId });
    }
  }

  /**
   * 释放某 goal task 持有的所有锁（任务完成/取消时调用）
   */
  releaseAll(goalId: string): number {
    let count = 0;
    for (const [path, entry] of this.locks) {
      if (entry.goalId === goalId) {
        this.locks.delete(path);
        count++;
      }
    }
    if (count > 0) {
      logger.info('All file locks released for goal', { goalId, count });
    }
    return count;
  }

  /**
   * 检查文件是否被锁定
   */
  isLocked(filePath: string): boolean {
    return this.locks.has(this.normalizePath(filePath));
  }

  /**
   * 获取锁的持有者信息
   */
  getLockOwner(filePath: string): LockEntry | null {
    return this.locks.get(this.normalizePath(filePath)) ?? null;
  }

  /** 路径归一化（处理大小写和分隔符差异） */
  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
  }
}

/** 全局单例 */
export const fileLockManager = new FileLockManager();
