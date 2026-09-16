/**
 * Work Store — 独立 Zustand Store
 *
 * 管理工作区视图标签等 UI 状态。
 *
 * ⚠ **不再承载 Plan/Do 模式与"当前工作项"**（2026-09-14，Spec: `.trae/specs/plan-do-mode.md` §5.4）：
 * `mode` 的事实来源是**后端会话 metadata.workMode**（前端经 `Session.workMode` 投影）；
 * 工作项的事实来源是 `root-store.worktrees[*].workItems`。二者曾在本 store 各留一个
 * **恒空的副本**（`mode` / `activeWorkItem`），使发送链路"看起来支持、实际从未生效"。
 *
 * 视图状态（`contentView` / `workTabs`）**持久化到 localStorage**（2026-09-14，V-18 ③）：
 * 刷新后保留已打开的标签；`merge` 会对持久化数据做**自愈校验**（`sanitizeWorkTabs`），
 * 因为 `ContentView` 联合会随注册表收缩（旧数据可能指向已移除的视图）。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 工作区视图成员（**有序**，也是 `ContentView` 的唯一事实来源）。
 *
 * 每个成员都必须在 `components/workbench/workbenchViews.ts` 的 `WORKBENCH_VIEWS`
 * （类型为 `Record<ContentView, WorkbenchViewSpec>`）中给出组件，否则**编译失败**——
 * 该约束从类型层面杜绝 V-9 的根因（联合里声明了成员，却既无实现也无消费方）。
 *
 * 已移除的成员与原因：
 * - `plan_analysis` / `editor` / `diff`：`client/src` 内无对应组件；
 * - `team`：唯一候选 `AgentSwarmView` 需要 `{ isDark, agents, onAgentClick }` 必需属性，
 *   其消费者是 `AgentAdvancedPage` 的子标签页（`agents` 来自其内部状态），无独立可用组件
 *   （「团队（集群）视图」经 `/agent/advanced` 的 swarm 标签页可达）。
 */
export const CONTENT_VIEWS = [
  "welcome",
  "project",
  "overview",
  "plan_schema",
  "agent",
  "council",
  "intelligence",
  "rules",
  "cost",
] as const;

export type ContentView = (typeof CONTENT_VIEWS)[number];

/** `ContentView` 类型守卫（用于校验持久化数据等外部来源） */
export function isContentView(value: unknown): value is ContentView {
  return (
    typeof value === "string" &&
    (CONTENT_VIEWS as readonly string[]).includes(value)
  );
}

/** 清洗标签数组：丢弃非视图 id 与重复项（持久化数据自愈） */
export function sanitizeWorkTabs(value: unknown): ContentView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ContentView[] = [];
  for (const item of value) {
    if (isContentView(item) && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}

/** 工作项生命周期状态 */
export type WorkItemStatus =
  "pending" | "running" | "paused" | "review" | "done" | "failed";

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
  /** 当前激活的工作区视图（不变式：始终包含在 `workTabs` 中） */
  contentView: ContentView;
  /** 已打开的工作区视图标签（顺序即标签顺序；不变式：至少 1 个） */
  workTabs: ContentView[];

  /** 激活一个已打开视图（不改动 `workTabs`） */
  setContentView: (view: ContentView) => void;
  /** 打开视图：已打开则仅激活，否则追加到末尾并激活 */
  openWorkTab: (view: ContentView) => void;
  /** 关闭视图：关闭当前视图时激活相邻标签；最后一个标签不允许关闭 */
  closeWorkTab: (view: ContentView) => void;
}

export const useWorkStore = create<WorkStore>()(
  persist(
    (set, get) => ({
      contentView: CONTENT_VIEWS[0],
      workTabs: [CONTENT_VIEWS[0]],

      setContentView: (view) => set({ contentView: view }),

      openWorkTab: (view) => {
        const { workTabs } = get();
        if (workTabs.includes(view)) {
          set({ contentView: view });
          return;
        }
        set({ workTabs: [...workTabs, view], contentView: view });
      },

      closeWorkTab: (view) => {
        const { workTabs, contentView } = get();
        // 至少保留一个标签：不引入"空工作区"状态（关闭唯一标签为无操作）
        if (workTabs.length <= 1 || !workTabs.includes(view)) {
          return;
        }
        const index = workTabs.indexOf(view);
        const next = workTabs.filter((item) => item !== view);
        // 关闭的是当前视图 → 激活其右侧邻居（过滤后同下标即原右邻）；无右邻则取新的末尾
        const nextActive =
          contentView === view
            ? (next[index] ?? next[next.length - 1])
            : contentView;
        set({ workTabs: next, contentView: nextActive });
      },
    }),
    {
      name: "liri-work-store",
      /** 只持久化视图状态；`activeWorkItem` 是运行时对象、`mode` 不属于导航态 */
      partialize: (state) => ({
        contentView: state.contentView,
        workTabs: state.workTabs,
      }),
      /**
       * 恢复时自愈：`ContentView` 联合可能已收缩，旧数据里的 id 必须丢弃；
       * 且必须保证不变式（至少一个标签、激活项在标签集合内）。
       */
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as {
          contentView?: unknown;
          workTabs?: unknown;
        };
        const tabs = sanitizeWorkTabs(saved.workTabs);
        const workTabs = tabs.length > 0 ? tabs : current.workTabs;
        const savedActive = saved.contentView;
        const contentView =
          isContentView(savedActive) && workTabs.includes(savedActive)
            ? savedActive
            : workTabs[0];
        return { ...current, contentView, workTabs };
      },
    },
  ),
);
