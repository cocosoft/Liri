import { create } from "zustand";
import { modelService } from "../services/modelService";
import type { ModelInfo } from "../types";

interface ModelStore {
  models: ModelInfo[];
  isLoading: boolean;
  error: string | null;

  loadModels: () => Promise<void>;
  toggleModel: (id: string) => Promise<boolean>;
  deleteModel: (id: string) => Promise<void>;
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
      set({
        error: e instanceof Error ? e.message : "获取模型列表失败",
        isLoading: false,
      });
    }
  },

  toggleModel: async (id: string) => {
    try {
      const enabled = await modelService.toggle(id);
      // 乐观更新本地状态
      set((state) => ({
        models: state.models.map((m) =>
          m.id === id ? { ...m, enabled } : m
        ),
      }));
      return enabled;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "切换模型状态失败" });
      throw e;
    }
  },

  deleteModel: async (id: string) => {
    try {
      await modelService.remove(id);
      set((state) => ({
        models: state.models.filter((m) => m.id !== id),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "删除模型失败" });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
