/**
 * Buddy/Companion 组件状态管理
 * 从 state/ 目录迁移至 core/state/
 */

import { create } from 'zustand';

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

const useAppStore = create<{
  state: AppState;
  setState: (
    partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)
  ) => void;
}>((set) => ({
  state: {
    companionReaction: undefined,
    companionPetAt: undefined,
    footerSelection: undefined,
  },
  setState: (partial) =>
    set((state) => ({
      state:
        typeof partial === 'function'
          ? { ...state.state, ...partial(state.state) }
          : { ...state.state, ...partial },
    })),
}));

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useAppStore((store) => selector(store.state));
}

export function useSetAppState() {
  return useAppStore((store) => store.setState);
}
