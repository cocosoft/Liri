// 重新导出 core/state 的核心功能，同时保持向后兼容
export {
  appStateStore,
  getGlobalStore,
  initializeGlobalStore,
} from '../core/state/AppStateStore';

export type { AppStateStore as CoreAppStateStore } from '../core/state/AppState';

// Buddy/Companion 状态（已迁移至 core/state/）
export { getDefaultAppState } from '../core/state/buddyAppState.js';
export type { AppState } from '../core/state/buddyAppState.js';
