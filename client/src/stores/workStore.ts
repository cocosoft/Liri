import { create } from "zustand";

/** 工作界面内容视图类型 */
export type ContentView = "welcome" | "project" | "plan_schema" | "plan_analysis" | "editor" | "diff" | "overview" | "team" | "cost" | "workflow_templates" | "council" | "intelligence" | "rules" | "agent";

/** 工作项生命周期状态 */
export type WorkItemStatus = "pending" | "running" | "paused" | "review" | "done" | "failed";

/** 工作项 */
export interface WorkItem {
  id: string;
  title: string;
  status: WorkItemStatus;
  description?: string;
  type?: string;
  workspaceId?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  tags?: string[];
  priority?: number;
}

interface WorkStore {
  /** Plan/Do 工作模式 */
  mode: "plan" | "do";

  /** 当前活跃的工作项 */
  activeWorkItem: WorkItem | null;

  /** 中间内容区视图 */
  contentView: ContentView;

  /** 后端配置的可见 Tab 列表（undefined 时显示全部 Tab） */
  workTabs: string[] | undefined;

  /** 动作 */
  setMode: (mode: "plan" | "do") => void;
  toggleMode: () => void;
  setActiveWorkItem: (item: WorkItem | null) => void;
  setContentView: (view: ContentView) => void;
  setWorkTabs: (tabs: string[] | undefined) => void;
}

/**
 * 工作界面 UI 状态管理
 * 管理 Plan/Do 模式切换、内容视图路由、当前工作项
 * Phase 1-B 骨架阶段：仅本地状态，不依赖后端
 */
export const useWorkStore = create<WorkStore>((set, get) => ({
  mode: "plan",
  activeWorkItem: null,
  contentView: "welcome",
  workTabs: undefined,

  setMode: (mode) => {
    set({ mode });
    // Plan 模式默认显示方案视图，Do 模式默认显示编辑器
    if (mode === "plan") {
      set({ contentView: "plan_schema" });
    } else {
      set({ contentView: "editor" });
    }
  },

  toggleMode: () => {
    const current = get().mode;
    const next = current === "plan" ? "do" : "plan";
    get().setMode(next);
  },

  setActiveWorkItem: (item) => set({ activeWorkItem: item }),

  setContentView: (view) => set({ contentView: view }),

  setWorkTabs: (tabs) => set({ workTabs: tabs }),
}));