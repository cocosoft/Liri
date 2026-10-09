/**
 * Execution 生命周期 —— 类型与状态机（PR1 / 2026-10-09）
 *
 * 归属：`execution` 模块（service 层）。仅依赖 `@modules/core`（错误基座）与 `@modules/monitoring`。
 * 见 `.trae/specs/execution-lifecycle-ownership.md`。
 */

/** 执行标识（branded，防与其他 string id 混用） */
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };

/** 执行代次（branded）：同 session 每次 acquire 递增，用于 generation fencing */
export type ExecutionGeneration = number & {
  readonly __brand: 'ExecutionGeneration';
};

/** 执行状态（唯一事实源） */
export const EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING_USER',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'COMPLETED',
  'FAILED',
  'STALE',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * 集中状态机（唯一转移事实源）。
 *
 * - 终态（CANCELLED / COMPLETED / FAILED / STALE）不可再转移；
 * - `CANCEL_REQUESTED` 只能走向 `CANCELLED`（确认）或 `STALE`（被顶替）；
 *   未被确认的底层执行"晚到完成"不得把状态改回 `COMPLETED`（fencing）。
 */
const TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  QUEUED: ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING: ['WAITING_USER', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'STALE'],
  WAITING_USER: [
    'RUNNING',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'COMPLETED',
    'FAILED',
    'STALE',
  ],
  CANCEL_REQUESTED: ['CANCELLED', 'STALE'],
  CANCELLED: [],
  COMPLETED: [],
  FAILED: [],
  STALE: [],
};

/** 是否允许状态转移（非法转移返回 false） */
export function canTransition(
  from: ExecutionStatus,
  to: ExecutionStatus
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

/** 终态判定 */
export function isTerminalStatus(status: ExecutionStatus): boolean {
  return (
    status === 'CANCELLED' ||
    status === 'COMPLETED' ||
    status === 'FAILED' ||
    status === 'STALE'
  );
}

/** "占用中"判定：持有 session 执行所有权的状态 */
export function isActiveStatus(status: ExecutionStatus): boolean {
  return (
    status === 'RUNNING' ||
    status === 'WAITING_USER' ||
    status === 'CANCEL_REQUESTED'
  );
}

/**
 * 执行中止原因（**类型化**）。
 *
 * 用途：替代 `error.message.includes('超时…')` 式文案匹配（CS02：状态/判定禁止字符串匹配）。
 * 由 `ExecutionAbortedError` 携带；消费者按 `reason` 判定，不解析文案。
 */
export const ABORT_REASONS = [
  /** 活动心跳超时（连续无 chunk 超过阈值） */
  'INACTIVITY_TIMEOUT',
  /** 用户显式取消 */
  'USER_CANCEL',
  /** 被新执行顶替（generation fencing） */
  'SUPERSEDED',
  /** 进程/服务关闭 */
  'SHUTDOWN',
] as const;
export type AbortReason = (typeof ABORT_REASONS)[number];

/** 执行记录（内存视图；PR5 起由 DB 派生） */
export interface ExecutionRecord {
  executionId: ExecutionId;
  sessionId: string;
  messageId?: string;
  generation: ExecutionGeneration;
  status: ExecutionStatus;
  startedAt: number;
  updatedAt: number;
  heartbeatAt: number;
}
