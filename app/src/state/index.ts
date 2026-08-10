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

// 会话状态机
export { SessionStateMachine } from './session/SessionStateMachine';
export { SessionState, SESSION_TRANSITIONS } from './session/types';
export type { RequiresActionDetails } from './session/types';

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
