import { create } from "zustand";
import { workspaceService } from "../services/workspaceService";
import type { WorkspaceListItem } from "../services/workspaceService";
import { useWorkStore } from "./workStore";
import type { WorkItem, WorkItemStatus } from "./workStore";

/** 执行阶段数据（与 chatStore.executionPhase 结构一致） */
interface ExecutionPhaseData {
  phase: "analyzing" | "designing" | "implementing" | "verifying" | "presenting" | null;
  progress: number;
  description: string;
}

interface WorkspaceStore {
  /** 当前工作空间 */
  currentWorkspace: { id: string; path: string; createdAt?: string; updatedAt?: string } | null;

  /** 工作空间列表（用于切换） */
  workspaces: WorkspaceListItem[];

  /** 工作项列表 */
  workItems: WorkItem[];

  /** 执行阶段（来自后端 ExecutionPhaseTracker 推送） */
  executionPhase: ExecutionPhaseData | null;

  /** 后端 API 是否就绪 */
  backendReady: boolean;

  /** 是否正在加载 */
  isLoading: boolean;

  /** 错误信息 */
  error: string | null;

  // ─── 动作 ───

  /** 获取工作空间列表 */
  listWorkspaces: () => Promise<void>;

  /** 打开工作空间 */
  openWorkspace: (workspaceId: string) => Promise<void>;

  /** 创建工作项 */
  createWorkItem: (title: string) => Promise<void>;

  /** 更新工作项状态 */
  updateWorkItemStatus: (itemId: string, status: WorkItemStatus) => Promise<void>;

  /** 暂停工作项 */
  pauseWorkItem: (itemId: string) => Promise<void>;

  /** 恢复工作项 */
  resumeWorkItem: (itemId: string) => Promise<void>;

  /** 提交审核 */
  submitForReview: (itemId: string) => Promise<void>;

  /** 完成工作项 */
  completeWorkItem: (itemId: string) => Promise<void>;

  /** 检查后端就绪状态 */
  checkBackendReady: () => Promise<void>;

  /** 从 workStore 同步 Plan/Do 模式到执行上下文 */
  syncModeFromWorkStore: () => void;

  /** 重置状态 */
  reset: () => void;
}

/**
 * 工作空间状态管理
 * 管理持久化数据：工作空间信息、工作项列表、执行阶段
 * 与 workStore 联动：Plan/Do 模式切换时通知执行策略变更
 */
export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  currentWorkspace: null,
  workspaces: [],
  workItems: [],
  executionPhase: null,
  backendReady: false,
  isLoading: false,
  error: null,

  /**
   * 获取工作空间列表
   */
  listWorkspaces: async () => {
    try {
      const list = await workspaceService.listWorkspaces();
      // 按更新时间降序排列
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      set({ workspaces: list });
    } catch (err) {
      console.warn("[workspaceStore] 获取工作空间列表失败", err);
      set({ workspaces: [] });
    }
  },

  /**
   * 打开工作空间：加载工作空间信息 + 工作项列表
   * Phase 1-C 骨架阶段：后端不可用时静默降级
   */
  openWorkspace: async (workspaceId: string) => {
    set({ isLoading: true, error: null });
    try {
      const ws = await workspaceService.getWorkspace(workspaceId);
      const items = await workspaceService.getWorkItems(workspaceId);

      set({
        currentWorkspace: ws || { id: workspaceId, path: ".", createdAt: "", updatedAt: "" },
        workItems: items,
        isLoading: false,
      });
    } catch (err) {
      set({
        currentWorkspace: { id: workspaceId, path: ".", createdAt: "", updatedAt: "" },
        workItems: [],
        isLoading: false,
        error: String(err),
      });
    }
  },

  /**
   * 创建工作项
   */
  createWorkItem: async (title: string) => {
    const ws = get().currentWorkspace;
    if (!ws) return;

    set({ isLoading: true, error: null });
    // 绑定当前会话 ID
    let sessionId: string | undefined;
    try {
      const { useSessionStore } = await import("./sessionStore");
      sessionId = useSessionStore.getState().currentSession?.id;
    } catch {
      // 静默降级
    }

    const item = await workspaceService.createWorkItem(ws.id, { title, sessionId });
    set((s) => ({
      workItems: [...s.workItems, item],
      isLoading: false,
    }));
  },

  /**
   * 更新工作项状态
   */
  updateWorkItemStatus: async (itemId: string, status: WorkItemStatus) => {
    const ws = get().currentWorkspace;
    if (!ws) return;

    const now = Date.now();
    const updates: Partial<WorkItem> = { status, updatedAt: now };

    if (status === "done" || status === "failed") {
      updates.completedAt = now;
    }

    // 乐观更新本地状态
    set((s) => ({
      workItems: s.workItems.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item,
      ),
    }));

    await workspaceService.updateWorkItem(ws.id, itemId, { status });
  },

  /**
   * 暂停工作项：running → paused
   */
  pauseWorkItem: async (itemId: string) => {
    await get().updateWorkItemStatus(itemId, "paused");
  },

  /**
   * 恢复工作项：paused → running
   */
  resumeWorkItem: async (itemId: string) => {
    await get().updateWorkItemStatus(itemId, "running");
  },

  /**
   * 提交审核：running → review
   */
  submitForReview: async (itemId: string) => {
    await get().updateWorkItemStatus(itemId, "review");
  },

  /**
   * 完成工作项：review → done
   */
  completeWorkItem: async (itemId: string) => {
    await get().updateWorkItemStatus(itemId, "done");
  },

  /**
   * 检查后端 Workspace API 是否就绪
   */
  checkBackendReady: async () => {
    const ready = await workspaceService.isBackendReady();
    set({ backendReady: ready });
  },

  /**
   * 从 workStore 同步 Plan/Do 模式
   * 当用户在 UI 切换 Plan/Do 时，通知 AI 变更执行策略
   */
  syncModeFromWorkStore: () => {
    const mode = useWorkStore.getState().mode;
    // TODO: Phase 1-C 后端对接时，通过 SSE/WebSocket 发送模式切换事件
    // 当前骨架阶段仅记录日志
    console.log(`[workspaceStore] Plan/Do 模式切换为: ${mode}`);
  },

  /** 重置状态 */
  reset: () => {
    set({
      currentWorkspace: null,
      workItems: [],
      executionPhase: null,
      isLoading: false,
      error: null,
    });
  },

  /**
   * 清除工作空间过滤（重置为"所有会话"）
   */
  clearWorkspaceFilter: () => {
    set({ currentWorkspace: null });
  },
}));