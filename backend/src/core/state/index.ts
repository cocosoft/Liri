// 核心状态管理（应用状态）
export {
  appStateStore,
  createAppStateStore,
  getGlobalStore,
  initializeGlobalStore,
} from './AppStateStore';

export type {
  CompletionBoundary,
  SpeculationResult,
  SpeculationState,
  FooterItem,
  RemoteConnectionStatus,
  StateChangeListener,
  StateUpdater,
} from './AppState';

export type { AppStateStore } from './AppState';

export type {
  Store,
  StoreOptions,
  StoreMiddleware,
  Listener,
  OnChange,
} from './Store';

export { StateMigrator } from './StateMigrator';

export type {
  DenialTrackingState,
  ToolPermissionContext,
  MCPServerConnection,
  MCPState,
  PluginLoadState,
  TaskState,
  Notification,
  NotificationType,
} from './types';
