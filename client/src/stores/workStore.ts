/**
 * Work Store — 工作项类型与状态的唯一定义处
 *
 * ⚠ **不承载 Plan/Do 模式与"当前工作项"**（2026-09-14，Spec: `.trae/specs/plan-do-mode.md` §5.4）：
 * `mode` 的事实来源是**后端会话 metadata.workMode**（前端经 `Session.workMode` 投影）；
 * 工作项的事实来源是 `root-store.worktrees[*].workItems`。
 *
 * 2026-10-22「收边界」：原 zustand store 的**视图标签状态**（`contentView` / `workTabs` /
 * `useWorkStore`）已随 `/work` 标签壳退役而删除 —— 那套标签与 `/workbench` 目录指向同一批
 * 页面组件，属两套工作面重复。此处只保留其它模块仍在引用的**类型**（工作项状态 / 工作项）。
 */
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
