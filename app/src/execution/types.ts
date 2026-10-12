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
 * 工具调用状态（G14，S2-1）：**语义化枚举**（唯一事实源）。
 *
 * 此前 `PersistedToolCall.status` 为裸 `string`、`settleToolCall` 与恢复判据靠字面量匹配
 * （`ExecutionStore.ts:381,453`、`ExecutionManager.ts:448-459`）⇒ 拼写漂移静默通过。
 *
 * ⚠️ 取值沿用**既有数据词表**（`running`/`completed`/`failed`/`unknown`）——方案 §4 原列
 * `prepared`/`succeeded` 未采纳：① `prepared` 无生产者（`recordToolCall` 落盘即 `running`，
 * 与 `running` 不可区分）；② `completed` 与 `executions` 表 `COMPLETED` 同源，改名需数据迁移
 * 且破坏"数出同源"（用户偏好），零功能收益。
 */
export const TOOL_CALL_STATUSES = [
  /** 已开始、未结算（`recordToolCall` 落盘；`:404`/`:429`） */
  'running',
  /** 结算：成功 */
  'completed',
  /** 结算：失败（携 `error`） */
  'failed',
  /** 恢复期结算：副作用是否发生**不可知**（P0-4） */
  'unknown',
] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

/** 初始状态（`recordToolCall` 落盘值）—— 避免 SQL 中出现裸字面量 */
export const TOOL_CALL_INITIAL_STATUS: ToolCallStatus = 'running';
/** 结算：成功（`settleToolCall` 落盘值）—— 避免 chunk/SSE 层出现裸字面量（状态机方案 阶段 2.2） */
export const TOOL_CALL_COMPLETED_STATUS: ToolCallStatus = 'completed';
/** 结算：失败（`settleToolCall` 落盘值，携 `error`）—— 同上 */
export const TOOL_CALL_FAILED_STATUS: ToolCallStatus = 'failed';
/** 恢复期"副作用不可知"状态（P0-4，`markUnsettledToolCallsUnknown` 落盘值） */
export const TOOL_CALL_UNKNOWN_STATUS: ToolCallStatus = 'unknown';

/** 终态（结算后不再变更） */
export const TOOL_CALL_TERMINAL_STATUSES: readonly ToolCallStatus[] = [
  'completed',
  'failed',
  'unknown',
];

/** 集中状态机（G14）：`running` 只可走向三个终态；终态无出边 */
const TOOL_CALL_TRANSITIONS: Record<ToolCallStatus, readonly ToolCallStatus[]> =
  {
    running: ['completed', 'failed', 'unknown'],
    completed: [],
    failed: [],
    unknown: [],
  };

/** 是否允许工具调用状态转移（非法转移返回 false；`from === to` 亦为 false） */
export function canTransitionToolCall(
  from: ToolCallStatus,
  to: ToolCallStatus
): boolean {
  if (from === to) return false;
  return TOOL_CALL_TRANSITIONS[from].includes(to);
}

/** 工具调用终态判定 */
export function isToolCallTerminalStatus(status: ToolCallStatus): boolean {
  return TOOL_CALL_TERMINAL_STATUSES.includes(status);
}

/** 是否为合法工具调用状态（运行期校验；用于 DB 读回/外部入参） */
export function isToolCallStatus(value: unknown): value is ToolCallStatus {
  return (
    typeof value === 'string' &&
    (TOOL_CALL_STATUSES as readonly string[]).includes(value)
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

/**
 * P0-4（`.trae/specs/unknown-tool-call-recovery.md`）：恢复期被判 `unknown` 的工具调用。
 *
 * 语义：崩溃时该次工具调用的**外部副作用是否已发生不可知**（既非成功也非失败）。
 * 调用方（组合根）据工具幂等性（`resolveToolRecoveryPolicy`）判定可否**自动重放**；
 * 非幂等 / 未声明 ⇒ **禁止自动重放**。
 */
export interface RecoveredUnknownToolCall {
  executionId: ExecutionId;
  sessionId: string;
  toolName: string;
}

/** `ExecutionManager.recover()` 结果 */
export interface RecoveryResult {
  /** 被判孤儿（STALE + generation++）的执行数 */
  recovered: number;
  /** 心跳不陈旧而保留（`foreignActive`）的执行数 */
  kept: number;
  /** 恢复期被判 `unknown` 的工具调用（副作用不可知；P0-4） */
  unknownToolCalls: RecoveredUnknownToolCall[];
}
