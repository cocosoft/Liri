/**
 * Work Store — 独立 Zustand Store
 *
 * 管理 Plan/Do 模式、工作项、内容视图等 UI 状态。
 * 与 workspaceStore 联动：模式切换时通知执行策略变更。
 */
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
  mode: "plan" | "do";
  activeWorkItem: WorkItem | null;
  contentView: ContentView;
  workTabs: string[] | undefined;

  setMode: (mode: "plan" | "do") => void;
  toggleMode: () => void;
  setActiveWorkItem: (item: WorkItem | null) => void;
  setContentView: (view: ContentView) => void;
  setWorkTabs: (tabs: string[] | undefined) => void;
}

export const useWorkStore = create<WorkStore>()((set, get) => ({
  mode: "plan",
  activeWorkItem: null,
  contentView: "welcome",
  workTabs: undefined,

  setMode: (mode) => {
    set({ mode });
    if (mode === "plan") {
      set({ contentView: "plan_schema" });
    } else {
      set({ contentView: "editor" });
    }
  },

  toggleMode: () => {
    const current = get().mode;
    get().setMode(current === "plan" ? "do" : "plan");
  },

  setActiveWorkItem: (item) => set({ activeWorkItem: item }),

  setContentView: (view) => set({ contentView: view }),

  setWorkTabs: (tabs) => set({ workTabs: tabs }),
}));
