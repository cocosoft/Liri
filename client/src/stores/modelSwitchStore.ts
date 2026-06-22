/**
 * Model Switch Store — 薄委托层
 *
 * 保持向后兼容的导出接口（useModelSwitchStore），
 * 内部状态已合并到 appStore。
 */

import { useAppStore } from "./appStore";
import type { CurrentModelInfo, TaskModelConfig } from "../types";

interface ModelSwitchSlice {
  currentModelId: string;
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

function mapSlice(s: {
  currentModelId: string;
  currentProvider: string;
  routerTier: string;
  routingMode: "dynamic" | "static" | "off";
  costThisSession: number;
  availableTasks: CurrentModelInfo["availableTasks"];
  tasks: TaskModelConfig;
  modelSwitchLoading: boolean;
  modelSwitchError: string | null;
  loadCurrentModel: () => Promise<void>;
  switchModel: (modelId: string) => Promise<void>;
  loadModelTasks: () => Promise<void>;
  saveModelTasks: (tasks: TaskModelConfig) => Promise<void>;
}): ModelSwitchSlice {
  return {
    currentModelId: s.currentModelId,
    currentProvider: s.currentProvider,
    routerTier: s.routerTier,
    routingMode: s.routingMode,
    costThisSession: s.costThisSession,
    availableTasks: s.availableTasks,
    tasks: s.tasks,
    isLoading: s.modelSwitchLoading,
    error: s.modelSwitchError,
    loadCurrent: s.loadCurrentModel,
    switchModel: s.switchModel,
    loadTasks: s.loadModelTasks,
    saveTasks: s.saveModelTasks,
  };
}

export function useModelSwitchStore(): ModelSwitchSlice;
export function useModelSwitchStore<T>(selector: (slice: ModelSwitchSlice) => T): T;
export function useModelSwitchStore(selector?: any): any {
  const currentModelId = useAppStore((s) => s.currentModelId);
  const currentProvider = useAppStore((s) => s.currentProvider);
  const routerTier = useAppStore((s) => s.routerTier);
  const routingMode = useAppStore((s) => s.routingMode);
  const costThisSession = useAppStore((s) => s.costThisSession);
  const availableTasks = useAppStore((s) => s.availableTasks);
  const tasks = useAppStore((s) => s.tasks);
  const isLoading = useAppStore((s) => s.modelSwitchLoading);
  const error = useAppStore((s) => s.modelSwitchError);
  const loadCurrent = useAppStore((s) => s.loadCurrentModel);
  const switchModel = useAppStore((s) => s.switchModel);
  const loadTasks = useAppStore((s) => s.loadModelTasks);
  const saveTasks = useAppStore((s) => s.saveModelTasks);
  const slice = {
    currentModelId, currentProvider, routerTier, routingMode,
    costThisSession, availableTasks, tasks,
    isLoading, error,
    loadCurrent, switchModel, loadTasks, saveTasks,
  };
  return selector ? selector(slice) : slice;
}

useModelSwitchStore.getState = () => mapSlice(useAppStore.getState());
