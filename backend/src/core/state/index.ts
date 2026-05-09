//
/**
 * 状态管理模块导出
 */

export { appStateStore } from './AppStateStore';
export * from './Store';
export * from './types';
export type {
  CompletionBoundary,
  SpeculationResult,
  SpeculationState,
  FooterItem,
  RemoteConnectionStatus,
  StateChangeListener,
  StateUpdater,
} from './AppState';
export { getDefaultAppState } from './AppState';
export * from './StateMigrator';
