/**
 * Model Switch Store — 独立 Zustand Store
 *
 * 当前模型状态、模型切换、任务分工策略管理。
 * 原状态从 appStore 迁出，现已为真实独立 Store。
 *
 * 跨 Store 依赖：switchModel() 通过 useModelStore 查找模型名。
 */

import { create } from "zustand";
import { modelSwitchService } from "../services/modelSwitchService";
import { handleClientError } from "@/utils/handleError";
import { useModelStore } from "./modelStore";
import type { CurrentModelInfo, TaskModelConfig } from "../types";

interface ModelSwitchState {
  currentModelId: string;
  currentModelName: string;
  currentProvider: string;
  routerTier: string;
  routingMode: "dynamic" | "static" | "off";
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
  currentModelName: "",
  currentProvider: "",
  routerTier: "",
  routingMode: "static" as const,
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
        currentModelId: info.modelUuid,
        currentModelName: info.modelId,
        currentProvider: info.provider,
        routerTier: info.routerTier ?? "",
        routingMode: info.routingMode ?? "static",
        costThisSession: info.costThisSession,
        availableTasks: info.availableTasks,
        isLoading: false,
      });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelSwitchStore", action: "loadCurrent" },
        "warn",
      );
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
      const tasks = await modelSwitchService.getTasks();
      const model = useModelStore
        .getState()
        .models.find((m) => m.id === modelId);
      set({
        currentModelId: modelId,
        currentModelName: model?.modelId || model?.name || modelId,
        tasks,
      });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelSwitchStore", action: "switchModel" },
        "warn",
      );
      set({ error: e instanceof Error ? e.message : "切换模型失败" });
    }
  },

  loadTasks: async () => {
    try {
      const tasks = await modelSwitchService.getTasks();
      set({ tasks });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelSwitchStore", action: "loadTasks" },
        "warn",
      );
      set({ error: e instanceof Error ? e.message : "获取任务策略失败" });
    }
  },

  saveTasks: async (tasks) => {
    set({ error: null });
    try {
      await modelSwitchService.saveTasks(tasks);
      set({ tasks });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:modelSwitchStore", action: "saveTasks" },
        "warn",
      );
      set({ error: e instanceof Error ? e.message : "保存任务策略失败" });
    }
  },
}));
