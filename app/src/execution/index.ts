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
  // 状态机方案 阶段 2.1（2026-10-12）：工具调用状态（G14 单一事实源）**必须**经本出口暴露 ——
  // 否则 chunk/SSE/前端契约只能各自复写 `'running'|'completed'|'failed'` 字面量（正是阶段 2 要消除的分叉）。
  TOOL_CALL_STATUSES,
  TOOL_CALL_INITIAL_STATUS,
  TOOL_CALL_COMPLETED_STATUS,
  TOOL_CALL_FAILED_STATUS,
  TOOL_CALL_UNKNOWN_STATUS,
  TOOL_CALL_TERMINAL_STATUSES,
  canTransitionToolCall,
  isToolCallTerminalStatus,
  isToolCallStatus,
} from './types';
export type {
  AbortReason,
  ExecutionGeneration,
  ExecutionId,
  ExecutionRecord,
  ExecutionStatus,
  ToolCallStatus,
  // P0-4（2026-10-10）：恢复期 unknown 工具调用 + recover() 结果
  RecoveredUnknownToolCall,
  RecoveryResult,
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
// 阶段 4（2026-10-12）：执行域「原生状态 → 四原语」**只读投影**（映射纯函数 + 广播出口）
export {
  projectExecutionStatus,
  publishExecutionProjection,
} from './executionProjection';
