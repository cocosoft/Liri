// 重新导出 core/state/AppState 的类型，同时保持向后兼容
export type {
  CompletionBoundary,
  SpeculationResult,
  SpeculationState,
  FooterItem,
  RemoteConnectionStatus,
  StateChangeListener,
  StateUpdater,
} from '../core/state/AppState';

// Zustand 状态钩子（仅用于 buddy 组件）
import { create } from 'zustand';
import type { AppState } from './AppStateStore';

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
