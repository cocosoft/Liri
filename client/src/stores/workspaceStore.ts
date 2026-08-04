/**
 * Workspace Store — rootStore 的薄封装（零重复状态）
 *
 * 所有状态真实存储在 useRootStore.workspaceSlice 中。
 * useWorkspaceStore 是一个 Zustand store 镜像，通过 subscribe 自动同步 rootStore 变更。
 * 组件使用方式和 API 完全不变。
 */

import { create } from "zustand";
import type { WorkspaceListItem } from "../services/workspaceService";
import { useWorkStore } from "./workStore";
import type { WorkItem, WorkItemStatus } from "./workStore";
import { useRootStore } from "./root-store";
import { createLogger } from "@/utils/logger";

const logger = createLogger("workspaceStore");

/** 执行阶段数据 */
interface ExecutionPhaseData {
  phase:
    | "analyzing"
    | "designing"
    | "implementing"
    | "verifying"
    | "presenting"
    | null;
  progress: number;
  description: string;
}

interface WorkspaceStore {
  currentWorkspace: {
    id: string;
    path: string;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  workspaces: WorkspaceListItem[];
  workItems: WorkItem[];
  executionPhase: ExecutionPhaseData | null;
  backendReady: boolean;
  isLoading: boolean;
  error: string | null;

  listWorkspaces: () => Promise<void>;
  openWorkspace: (workspaceId: string) => Promise<void>;
  createWorkItem: (title: string) => Promise<void>;
  updateWorkItemStatus: (
    itemId: string,
    status: WorkItemStatus,
  ) => Promise<void>;
  pauseWorkItem: (itemId: string) => Promise<void>;
  resumeWorkItem: (itemId: string) => Promise<void>;
  submitForReview: (itemId: string) => Promise<void>;
  completeWorkItem: (itemId: string) => Promise<void>;
  checkBackendReady: () => Promise<void>;
  syncModeFromWorkStore: () => void;
  reset: () => void;
}

/**
 * 从 rootStore 派生当前 workspaceStore 镜像状态
 */
function deriveState(root: ReturnType<typeof useRootStore.getState>): {
  currentWorkspace: {
    id: string;
    path: string;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  workspaces: WorkspaceListItem[];
  workItems: WorkItem[];
  executionPhase: ExecutionPhaseData | null;
  backendReady: boolean;
  isLoading: boolean;
  error: string | null;
} {
  const wtId = root.currentWorkspaceId;
  const wt = wtId ? root.worktrees[wtId] : undefined;

  // 映射 RootWorkItem → old WorkItem
  const workItems: WorkItem[] = (wt?.workItems ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    description: item.description,
    workspaceId: item.workspaceId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  return {
    currentWorkspace: wt ? { id: wt.id, path: wt.path } : null,
    workspaces: root.workspaceList ?? [],
    workItems,
    executionPhase: wt?.executionPhase ?? null,
    backendReady: root.backendReady,
    isLoading: root.isLoading,
    error: root.error,
  };
}

/**
 * workspaceStore — rootStore 的 Zustand 镜像
 */
export const useWorkspaceStore = create<WorkspaceStore>()(() => ({
  ...deriveState(useRootStore.getState()),

  listWorkspaces: () => useRootStore.getState().listWorkspaces(),
  openWorkspace: (id) => useRootStore.getState().openWorkspace(id),
  createWorkItem: (title) => useRootStore.getState().createWorkItem(title),
  updateWorkItemStatus: (itemId, status) =>
    useRootStore.getState().updateWorkItemStatus(itemId, status),
  pauseWorkItem: (itemId) =>
    useRootStore.getState().updateWorkItemStatus(itemId, "paused"),
  resumeWorkItem: (itemId) =>
    useRootStore.getState().updateWorkItemStatus(itemId, "running"),
  submitForReview: (itemId) =>
    useRootStore.getState().updateWorkItemStatus(itemId, "review"),
  completeWorkItem: (itemId) =>
    useRootStore.getState().updateWorkItemStatus(itemId, "done"),
  checkBackendReady: () => useRootStore.getState().checkBackendReady(),

  syncModeFromWorkStore: () => {
    const mode = useWorkStore.getState().mode;
    logger.info(`Plan/Do 模式切换为: ${mode}`);
  },

  reset: () => useRootStore.getState().resetWorkspace(),

  clearWorkspaceFilter: () => {
    // 兼容旧 API：重置当前 workspace
    useRootStore.setState((s) => ({ ...s, currentWorkspaceId: null }));
  },
}));

// ─── 核心：rootStore → workspaceStore 单向镜像 ──────────
// rootStore 是唯一事实来源，workspaceStore 只是它的投影。

useRootStore.subscribe((root) => {
  useWorkspaceStore.setState(deriveState(root));
});
