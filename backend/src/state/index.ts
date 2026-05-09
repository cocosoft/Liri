// 重新导出 core/state 的核心功能（统一状态管理层）
export {
  appStateStore,
  getGlobalStore,
  initializeGlobalStore,
} from '../core/state/AppStateStore';

export type { AppStateStore as CoreAppStateStore } from '../core/state/AppState';

export type {
  Store,
  StoreOptions,
  StoreMiddleware,
  Listener,
  OnChange,
} from '../core/state/Store';

export type {
  AppState as CoreAppState,
  CompletionBoundary,
  SpeculationResult,
  SpeculationState,
  FooterItem,
  RemoteConnectionStatus,
  StateChangeListener,
  StateUpdater,
} from '../core/state/AppState';

export { createAppStateStore } from '../core/state/AppStateStore';

export { StateMigrator } from '../core/state/StateMigrator';

// 本目录特有功能（buddy/companion 状态）
export type { AppState } from './AppStateStore';
export { getDefaultAppState } from './AppStateStore';
export { useAppState, useSetAppState } from './AppState';
