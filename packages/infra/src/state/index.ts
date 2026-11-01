/**
 * 状态管理层入口
 *
 * 统一导出状态机相关全部组件。
 */

export * from './errors';

// 通用状态引擎
export { StateMachine, computeDefaultTerminal } from './engine/StateMachine';
export { StateMachineRegistry } from './engine/StateMachineRegistry';
export type {
  RegistryConfig,
  RegistryEntry,
} from './engine/StateMachineRegistry';
export type {
  TransitionRules,
  TransitionRecord,
  StateSnapshot,
  StateChangeListener,
  StateMachineConfig,
} from './engine/types';

// 四原语**只读投影**广播 Broker（阶段 4 / 2026-10-12；词汇 + 载荷 + 广播，零域依赖）
export {
  EXECUTION_PRIMITIVES,
  STATE_PROJECTION_BROADCAST_FLAG,
  isStateProjectionBroadcastEnabled,
  publishStateProjection,
} from './engine/projectionBroker';
export type {
  ExecutionPrimitive,
  StateProjectionBroadcast,
  StateProjectionDomain,
} from './engine/projectionBroker';
// T2-8 / `✅-17`（2026-10-13）：编排域只读投影出口（形态 A：只读上报，不承载断言/锁定）
export { publishOrchestrationProjection } from './engine/orchestrationProjection';

// 会话状态机（阶段 3 / 2026-10-12：8 态 → 3 态；旧 `SessionState` 枚举已删除）
export { SessionStateMachine } from './session/SessionStateMachine';
export { SESSION_TRANSITIONS } from './session/types';
export type {
  RequiresActionDetails,
  SimplifiedSessionState,
} from './session/types';

// 应用状态机
export { AppStateMachine } from './app/AppStateMachine';
export { AppState, APP_TRANSITIONS } from './app/types';
export {
  initAppStateMachine,
  getAppStateMachine,
  getAppState,
  markAppBusy,
  markAppIdle,
  markAppPaused,
  markAppError,
} from './app/AppLifecycle';

// 后台任务状态机
export {
  BackgroundTaskStateMachine,
  BackgroundTaskState,
  BACKGROUND_TASK_TRANSITIONS,
  getBackgroundTaskStateMachine,
} from './background/BackgroundTaskStateMachine';

// 任务状态机（task-system 域）
export {
  TaskStateMachine,
  TASK_TRANSITIONS,
  getTaskStateMachine,
} from './task/TaskStateMachine';
