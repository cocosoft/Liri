// 重新导出 core/state 的核心功能，同时保持向后兼容
export {
  appStateStore,
  getGlobalStore,
  initializeGlobalStore,
} from '../core/state/AppStateStore';

export type { AppStateStore as CoreAppStateStore } from '../core/state/AppState';

/**
 * 简单应用状态接口（用于 buddy/companion 组件）
 */
export interface AppState {
  companionReaction?: string;
  companionPetAt?: number;
  footerSelection?: string;
}

/**
 * 获取默认应用状态
 */
export function getDefaultAppState(): AppState {
  return {
    companionReaction: undefined,
    companionPetAt: undefined,
    footerSelection: undefined,
  };
}
