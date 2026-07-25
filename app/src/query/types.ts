/**
 * query 模块共享类型和枚举
 * 从 TAORLoop.ts 提取，打破 FileCheckpointStorage ↔ TAORLoop 循环依赖
 */
import type { TokenBudgetState } from '../core/tokenBudget/TokenBudgetController.js';

/** TAOR 循环阶段枚举 */
export enum TAORPhase {
  THINK = 'think',
  ACT = 'act',
  OBSERVE = 'observe',
  COMPLETED = 'completed',
}

/** TAOR检查点数据结构 */
export interface TAORCheckpoint {
  id: string;
  sessionId: string;
  turnCount: number;
  phase: TAORPhase;
  budgetState: TokenBudgetState;
  conversationSummary: string;
  lastPrompt: string;
  createdAt: number;
  type: 'auto' | 'manual' | 'before_abort';
  /** 断路器状态（用于检查点恢复） */
  breakerState?: {
    state: string;
    failureCount: number;
    consecutiveSameErrorCount: number;
    lastError: string | null;
    totalFailures: number;
    totalSuccesses: number;
    trippedAt: number;
  };
  /** 循环检测器状态 */
  loopDetectorState?: { noToolCallStreak: number };
  /** 错误恢复管理器状态 */
  errorRecoveryState?: {
    attempts: Array<[string, { type: string; retryCount: number }]>;
    compactAttempted?: boolean;
  };
}

/** 检查点存储接口 */
export interface CheckpointStorage {
  save(checkpoint: TAORCheckpoint): Promise<string>;
  load(id: string): Promise<TAORCheckpoint | null>;
  findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null>;
  delete(id: string): Promise<boolean>;
  cleanup(expireTime: number): Promise<number>;
}
