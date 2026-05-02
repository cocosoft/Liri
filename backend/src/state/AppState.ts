import { create } from 'zustand';
import { AppState, getDefaultAppState } from './AppStateStore';

// 创建状态存储
const useAppStore = create<{
  state: AppState;
  setState: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
}>((set) => ({
  state: getDefaultAppState(),
  setState: (partial) => set((state) => ({
    state: typeof partial === 'function' ? { ...state.state, ...partial(state.state) } : { ...state.state, ...partial }
  })),
}));

/**
 * 使用应用状态的钩子
 * @param selector 状态选择器函数
 * @returns 选中的状态值
 */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useAppStore((store) => selector(store.state));
}

/**
 * 使用设置应用状态的钩子
 * @returns 设置状态的函数
 */
export function useSetAppState() {
  return useAppStore((store) => store.setState);
}