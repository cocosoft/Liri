// 重新导出 core/state/AppState 的类型，同时保持向后兼容
export type {
  AppState,
  CompletionBoundary,
  SpeculationResult,
  SpeculationState,
  FooterItem,
  RemoteConnectionStatus,
  StateChangeListener,
  StateUpdater,
} from '../core/state/AppState';

// Buddy/Companion 状态钩子（已迁移至 core/state/buddyAppState）
export { useAppState, useSetAppState } from '../core/state/buddyAppState.js';
