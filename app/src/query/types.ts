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

/** A 阶段一（2026-09-05）：检查点恢复归属标记——chat（普通对话）/ goal（PDL 目标运行） */
export type TAORCheckpointKind = 'chat' | 'goal';

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
  /** Phase 3: 检查点保存时未完成的工具调用 */
  pendingToolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
  }>;
  /** Phase 3: 检查点保存时的消息历史计数 */
  messageCount?: number;
  /** Phase 3: 检查点关联的 Inbox 状态 */
  inboxState?: CheckpointInboxState;
  /** A 阶段一（2026-09-05）：恢复归属标记——缺省（历史存量）按 chat 宽容读；
   *  goal = PDL 快路径目标运行产出的检查点，Durable Resume 跳过（/goal 恢复） */
  kind?: TAORCheckpointKind;
}

/** 检查点时关联的 Inbox 待审批项 */
export interface CheckpointInboxState {
  pendingInboxItems: Array<{
    itemId: string;
    source: 'permission' | 'pdca' | 'agent_question';
    status: 'pending' | 'approved' | 'rejected';
    toolCallId?: string;
    toolName?: string;
  }>;
}

/** 检查点完整性校验结果 */
export interface CheckpointIntegrity {
  phase: TAORPhase;
  pendingToolCalls: number;
  tokenConsistency: boolean;
  messageCountMatch: boolean;
}

/** 检查点存储接口 */
export interface CheckpointStorage {
  save(checkpoint: TAORCheckpoint): Promise<string>;
  load(id: string): Promise<TAORCheckpoint | null>;
  findBySessionId(sessionId: string): Promise<TAORCheckpoint[] | null>;
  delete(id: string): Promise<boolean>;
  cleanup(expireTime: number): Promise<number>;
  /** 获取最新的未完成检查点（用于恢复） */
  getLatestIncomplete(sessionId: string): Promise<TAORCheckpoint | null>;
  /** 获取所有有未完成检查点的 session ID 列表 */
  getPendingSessions(): Promise<string[]>;
  /** 删除某 session 的所有检查点 */
  deleteSession(sessionId: string): Promise<number>;
}
