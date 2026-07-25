/**
 * ResumeManager — Durable Resume 管理器
 *
 * 启动时扫描文件系统上的 TAOR 检查点，
 * 检测未完成的会话并提供断点恢复能力。
 */

import { Logger } from '@modules/monitoring';
import { FileTAORCheckpointStorage } from './FileTAORCheckpointStorage.js';
import type { TAORCheckpoint } from './types.js';
import type { TAORLoop, TAORLoopConfig } from './TAORLoop.js';

const logger = new Logger({ module: 'query:resumeManager' });

/** 恢复候选 */
export interface ResumeCandidate {
  sessionId: string;
  checkpoint: TAORCheckpoint;
  savedAt: number;
  stopType: string; // 'auto' | 'manual' | 'before_abort'
  age: number; // 检查点创建至今的毫秒数
}

export class ResumeManager {
  private storage: FileTAORCheckpointStorage;

  constructor(storage?: FileTAORCheckpointStorage) {
    this.storage = storage ?? new FileTAORCheckpointStorage();
  }

  /** 扫描所有待恢复的会话 */
  async scanPending(): Promise<ResumeCandidate[]> {
    try {
      const sessionIds = await this.storage.getPendingSessions();
      if (sessionIds.length === 0) return [];

      const now = Date.now();
      const candidates: ResumeCandidate[] = [];

      for (const sessionId of sessionIds) {
        const latest = await this.storage.getLatestIncomplete(sessionId);
        if (!latest) continue;

        // 超过 24 小时的检查点视为过期
        if (now - latest.createdAt > 24 * 60 * 60 * 1000) {
          logger.info('Stale checkpoint ignored', {
            sessionId,
            checkpointId: latest.id,
            age: now - latest.createdAt,
          });
          continue;
        }

        candidates.push({
          sessionId,
          checkpoint: latest,
          savedAt: latest.createdAt,
          stopType: latest.type,
          age: now - latest.createdAt,
        });
      }

      return candidates.sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      logger.error('Failed to scan pending checkpoints', { error: String(e) });
      return [];
    }
  }

  /** 检查特定 session 是否有待恢复的检查点 */
  async hasPending(sessionId: string): Promise<boolean> {
    const latest = await this.storage.getLatestIncomplete(sessionId);
    if (!latest) return false;
    // 过期检查
    if (Date.now() - latest.createdAt > 24 * 60 * 60 * 1000) return false;
    return true;
  }

  /** 获取会话的最新检查点 */
  async getLatestCheckpoint(sessionId: string): Promise<TAORCheckpoint | null> {
    return this.storage.getLatestIncomplete(sessionId);
  }

  /** 删除会话的所有检查点 */
  async clearSession(sessionId: string): Promise<number> {
    return this.storage.deleteSession(sessionId);
  }
}

/** 全局单例 */
export const resumeManager = new ResumeManager();
