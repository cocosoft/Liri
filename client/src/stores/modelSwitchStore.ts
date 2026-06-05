/**
 * 模型切换 Store
 * 管理当前模型状态、切换、任务分工
 */

import { create } from "zustand";
import { modelSwitchService } from "../services/modelSwitchService";
import type { CurrentModelInfo, TaskModelConfig } from "../types";

interface ModelSwitchState {
  currentModelId: string;
  currentProvider: string;
  costThisSession: number;
  availableTasks: CurrentModelInfo["availableTasks"];
  tasks: TaskModelConfig;
  isLoading: boolean;
  error: string | null;

  loadCurrent: () => Promise<void>;
  switchModel: (modelId: string) => Promise<void>;
  loadTasks: () => Promise<void>;
  saveTasks: (tasks: TaskModelConfig) => Promise<void>;
}

export const useModelSwitchStore = create<ModelSwitchState>((set) => ({
  currentModelId: "",
  currentProvider: "deepseek",
  costThisSession: 0,
  availableTasks: [],
  tasks: {},
  isLoading: false,
  error: null,

  loadCurrent: async () => {
    set({ isLoading: true, error: null });
    try {
      const info = await modelSwitchService.getCurrent();
      set({
        currentModelId: info.modelId,
        currentProvider: info.provider,
        costThisSession: info.costThisSession,
        availableTasks: info.availableTasks,
        isLoading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "获取当前模型失败",
        isLoading: false,
      });
    }
  },

  switchModel: async (modelId) => {
    set({ error: null });
    try {
      await modelSwitchService.switch(modelId);
      set({ currentModelId: modelId });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "切换模型失败" });
    }
  },

  loadTasks: async () => {
    try {
      const tasks = await modelSwitchService.getTasks();
      set({ tasks });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "获取任务策略失败" });
    }
  },

  saveTasks: async (tasks) => {
    set({ error: null });
    try {
      await modelSwitchService.saveTasks(tasks);
      set({ tasks });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "保存任务策略失败" });
    }
  },
}));
