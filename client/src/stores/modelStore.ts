/**
 * Model Store — 独立 Zustand Store
 *
 * 模型列表的加载、启用/禁用、删除。
 * 原状态从 appStore 迁出，现已为真实独立 Store。
 */

import { create } from "zustand";
import { modelService } from "../services/modelService";
import { handleClientError } from "@/utils/handleError";
import type { ModelInfo } from "../types";

export type { ModelInfo };

interface ModelState {
  models: ModelInfo[];
  isLoading: boolean;
  error: string | null;

  loadModels: () => Promise<void>;
  toggleModel: (id: string) => Promise<boolean>;
  deleteModel: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useModelStore = create<ModelState>((set) => ({
  models: [],
  isLoading: false,
  error: null,

  loadModels: async () => {
    set({ isLoading: true, error: null });
    try {
      const models = await modelService.list();
      set({ models, isLoading: false });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelStore", action: "loadModels" },
        "warn",
      );
      set({
        error: e instanceof Error ? e.message : "获取模型列表失败",
        isLoading: false,
      });
    }
  },

  toggleModel: async (id: string) => {
    try {
      const enabled = await modelService.toggle(id);
      set((state) => ({
        models: state.models.map((m) => (m.id === id ? { ...m, enabled } : m)),
      }));
      return enabled;
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelStore", action: "toggleModel" },
        "warn",
      );
      set({ error: e instanceof Error ? e.message : "切换模型状态失败" });
      throw e;
    }
  },

  deleteModel: async (id: string) => {
    try {
      await modelService.remove(id);
      set((state) => ({ models: state.models.filter((m) => m.id !== id) }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelStore", action: "deleteModel" },
        "warn",
      );
      set({ error: e instanceof Error ? e.message : "删除模型失败" });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
