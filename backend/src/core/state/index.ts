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
  AppState,
  Notification,
  NotificationType,
  AppStateStore,
} from './AppState';

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
  SessionId,
} from './types';
export { generateSessionId } from './types';

// Buddy/Companion 状态（从 state/ 迁移）
export {
  getDefaultAppState,
  useAppState,
  useSetAppState,
} from './buddyAppState.js';
export type { AppState as BuddyAppState } from './buddyAppState.js';
