/**
 * 通用状态引擎入口
 *
 * 统一导出所有通用状态机组件，供上层模块（会话/流/应用状态机）使用。
 */

export { StateMachine, computeDefaultTerminal } from './StateMachine';
export { StateMachineRegistry } from './StateMachineRegistry';
export type { RegistryConfig, RegistryEntry } from './StateMachineRegistry';
export type {
  TransitionRules,
  TransitionRecord,
  StateSnapshot,
  StateChangeListener,
  StateMachineConfig,
} from './types';
