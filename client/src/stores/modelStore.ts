import { create } from 'zustand';
import { modelService } from '../services/modelService';
import type { ModelInfo } from '../types';

interface ModelStore {
  models: ModelInfo[];
  isLoading: boolean;
  error: string | null;

  loadModels: () => Promise<void>;
  clearError: () => void;
}

export const useModelStore = create<ModelStore>((set) => ({
  models: [],
  isLoading: false,
  error: null,

  loadModels: async () => {
    set({ isLoading: true, error: null });
    try {
      const models = await modelService.list();
      set({ models, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取模型列表失败', isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
