import { create } from 'zustand';
import { modelService } from '../services/modelService';
import type { ModelInfo } from '../types';

interface ModelStore {
  models: ModelInfo[];
  isLoading: boolean;
  error: string | null;
  updatingId: string | null;

  loadModels: () => Promise<void>;
  toggleModel: (id: string, enabled: boolean) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useModelStore = create<ModelStore>((set) => ({
  models: [],
  isLoading: false,
  error: null,
  updatingId: null,

  loadModels: async () => {
    set({ isLoading: true, error: null });
    try {
      const models = await modelService.list();
      set({ models, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取模型列表失败', isLoading: false });
    }
  },

  toggleModel: async (id, enabled) => {
    set({ updatingId: id, error: null });
    try {
      await modelService.toggle(id, enabled);
      set((state) => ({
        models: state.models.map((m) =>
          m.id === id ? { ...m, enabled } : m
        ),
        updatingId: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新模型状态失败', updatingId: null });
    }
  },

  deleteModel: async (id) => {
    set({ updatingId: id, error: null });
    try {
      await modelService.delete(id);
      set((state) => ({
        models: state.models.filter((m) => m.id !== id),
        updatingId: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除模型失败', updatingId: null });
    }
  },

  clearError: () => set({ error: null }),
}));
