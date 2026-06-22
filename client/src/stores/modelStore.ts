/**
 * 向后兼容 — 已合并到 appStore
 *
 * 原独立 Store 已合并到 appStore，此文件为薄封装层。
 * 新代码请直接使用 useAppStore。
 */
import { useAppStore } from "./appStore";
import type { ModelInfo } from "../types";

export type { ModelInfo };

/** Model 相关状态切片 */
interface ModelSlice {
  models: ModelInfo[];
  isLoading: boolean;
  error: string | null;
  loadModels: () => Promise<void>;
  toggleModel: (id: string) => Promise<boolean>;
  deleteModel: (id: string) => Promise<void>;
  clearError: () => void;
}

function modelSlice(state: { models: ModelInfo[]; modelLoading: boolean; modelError: string | null; loadModels: () => Promise<void>; toggleModel: (id: string) => Promise<boolean>; deleteModel: (id: string) => Promise<void>; clearModelError: () => void }): ModelSlice {
  return {
    models: state.models,
    isLoading: state.modelLoading,
    error: state.modelError,
    loadModels: state.loadModels,
    toggleModel: state.toggleModel,
    deleteModel: state.deleteModel,
    clearError: state.clearModelError,
  };
}

export function useModelStore(): ModelSlice;
export function useModelStore<T>(selector: (slice: ModelSlice) => T): T;
export function useModelStore(selector?: any): any {
  const models = useAppStore((s) => s.models);
  const isLoading = useAppStore((s) => s.modelLoading);
  const error = useAppStore((s) => s.modelError);
  const loadModels = useAppStore((s) => s.loadModels);
  const toggleModel = useAppStore((s) => s.toggleModel);
  const deleteModel = useAppStore((s) => s.deleteModel);
  const clearError = useAppStore((s) => s.clearModelError);
  const slice = { models, isLoading, error, loadModels, toggleModel, deleteModel, clearError };
  return selector ? selector(slice) : slice;
}

useModelStore.getState = () => modelSlice(useAppStore.getState());
useModelStore.setState = (partial: Partial<ModelSlice>) => {
  useAppStore.setState({
    ...(partial.models !== undefined && { models: partial.models }),
    ...(partial.isLoading !== undefined && { modelLoading: partial.isLoading }),
    ...(partial.error !== undefined && { modelError: partial.error }),
  } as any);
};
