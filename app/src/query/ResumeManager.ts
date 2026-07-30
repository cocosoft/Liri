/**
 * ResumeManager — Durable Resume 管理器
 *
 * 启动时扫描文件系统上的 TAOR 检查点，
 * 检测未完成的会话并提供断点恢复能力。
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { EventEmitter } from 'events';
import { FileTAORCheckpointStorage } from './FileTAORCheckpointStorage.js';
import {
  TAORPhase,
  type TAORCheckpoint,
  type CheckpointIntegrity,
} from './types.js';
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

/** 恢复进度事件 */
export interface ResumeProgressEvent {
  phase: 'scanning' | 'validating' | 'restoring' | 'injecting' | 'ready';
  sessionId?: string;
  progress?: number;
  detail?: string;
}

export class ResumeManager {
  private storage: FileTAORCheckpointStorage;
  private emitter: EventEmitter;

  constructor(storage?: FileTAORCheckpointStorage) {
    this.storage = storage ?? new FileTAORCheckpointStorage();
    this.emitter = new EventEmitter();
  }

  /**
   * 订阅恢复进度事件（用于前端显示进度）
   */
  onProgress(listener: (event: ResumeProgressEvent) => void): () => void {
    this.emitter.on('progress', listener);
    return () => this.emitter.off('progress', listener);
  }

  /** 发射进度事件（也可被外部如 ChatManager 调用） */
  emitProgress(event: ResumeProgressEvent): void {
    this.emitter.emit('progress', event);
  }

  /** 扫描所有待恢复的会话 */
  async scanPending(): Promise<ResumeCandidate[]> {
    try {
      this.emitProgress({ phase: 'scanning', detail: '正在扫描断点检查点...' });
      const sessionIds = await this.storage.getPendingSessions();
      if (sessionIds.length === 0) {
        this.emitProgress({ phase: 'ready', detail: '无待恢复会话' });
        return [];
      }

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
      await handleError(e, {
        module: 'query:resume',
        action: '扫描待恢复检查点',
      });
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

  /**
   * 验证检查点完整性
   *
   * @param checkpoint 持久化的检查点
   * @param liveMessageCount 当前会话的实际消息数
   * @param liveTokenConsumed 当前 Token 预算的实际消耗
   * @returns 完整性校验结果
   */
  validateCheckpointIntegrity(
    checkpoint: TAORCheckpoint,
    liveMessageCount: number,
    liveTokenConsumed: number
  ): CheckpointIntegrity {
    return {
      phase: checkpoint.phase,
      pendingToolCalls: checkpoint.pendingToolCalls?.length ?? 0,
      tokenConsistency:
        checkpoint.budgetState.totalTokensUsed <= liveTokenConsumed,
      messageCountMatch:
        checkpoint.messageCount === undefined ||
        checkpoint.messageCount === liveMessageCount,
    };
  }

  /**
   * 获取恢复策略建议（基于完整性和阶段）
   */
  getRestoreStrategy(integrity: CheckpointIntegrity): {
    skipToolExecution: boolean;
    reExecuteTools: boolean;
    reason: string;
  } {
    switch (integrity.phase) {
      case TAORPhase.ACT:
        return {
          skipToolExecution: false,
          reExecuteTools: integrity.pendingToolCalls > 0,
          reason: `ACT 阶段中断，${integrity.pendingToolCalls} 个工具需重新执行`,
        };
      case TAORPhase.OBSERVE:
        return {
          skipToolExecution: true,
          reExecuteTools: false,
          reason: 'OBSERVE 阶段中断，工具已执行完，跳过进入 THINK',
        };
      case TAORPhase.THINK:
      default:
        return {
          skipToolExecution: false,
          reExecuteTools: false,
          reason: 'THINK 阶段中断，正常恢复',
        };
    }
  }
}

/** 全局单例 */
export const resumeManager = new ResumeManager();
