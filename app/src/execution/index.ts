/**
 * Execution 生命周期模块（PR1 / 2026-10-09）
 *
 * 唯一出口：消费方一律 `@modules/execution`（R03-002 模块出口单一）。
 * 详见 `.trae/specs/execution-lifecycle-ownership.md`。
 */
export {
  EXECUTION_STATUSES,
  ABORT_REASONS,
  canTransition,
  isActiveStatus,
  isTerminalStatus,
} from './types';
export type {
  AbortReason,
  ExecutionGeneration,
  ExecutionId,
  ExecutionRecord,
  ExecutionStatus,
} from './types';
export {
  ExecutionAbortedError,
  StaleExecutionError,
  isExecutionAbortedError,
} from './errors';
export { ExecutionLease } from './ExecutionLease';
export {
  ExecutionManager,
  getExecutionManager,
  // PR5-S2（2026-10-09）：心跳陈旧阈值（启动期恢复用）
  DEFAULT_EXEC_HEARTBEAT_STALE_MS,
  resolveHeartbeatStaleMs,
} from './ExecutionManager';
// PR5-S1（2026-10-09）：Execution 持久化记录（见 `.trae/specs/durable-execution.md`）
export {
  ExecutionStore,
  getExecutionStore,
  resetExecutionStore,
  EXECUTIONS_TABLE,
  EXECUTION_EVENTS_TABLE,
  TOOL_CALLS_TABLE,
} from './ExecutionStore';
export type {
  PersistedExecution,
  PersistedExecutionEvent,
  PersistedToolCall,
} from './ExecutionStore';
// PR5-S3（2026-10-09）：execution 生命周期会话事件发射器（宿主经 setExecutionEventSink 注入）
export { setExecutionEventSink, emitExecutionEvent } from './eventSink';
export type { ExecutionEventAppender, ExecutionEventType } from './eventSink';
