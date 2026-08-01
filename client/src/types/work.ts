/** ═══════════════════════════════════════════════════
 * 工作模块类型体系
 *
 * Phase A: TaskNode 统一模型（与旧类型并存，逐步迁移）
 * 三层结构: ProjectV2 → TaskNode (树) → 执行跟踪
 * ═══════════════════════════════════════════════════ */

// ========== 旧类型（@deprecated，Phase D 移除） ==========

/** @deprecated 使用 TaskPriority 替代 */
export type ProjectPriority = "P0" | "P1" | "P2" | "P3";

/** @deprecated 使用 TaskStatus 替代 */
export type ProjectStatus =
  "planning" | "active" | "paused" | "completed" | "archived";

/** @deprecated 使用 TaskType 替代 */
export type ProjectNodeType = "project" | "phase" | "story" | "task";

/** @deprecated 使用 TaskNode 替代 */
export interface ProjectNode {
  id: string;
  projectId: string;
  type: ProjectNodeType;
  title: string;
  description: string;
  priority: ProjectPriority;
  status: ProjectStatus;
  progress: number;
  children: string[];
  dependsOn: string[];
  tags: string[];
  estimatedEffort: string;
  assignee: string;
  startedAt: number;
  completedAt: number;
  createdAt: number;
}

/** @deprecated 使用 ProjectV2 替代 */
export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  sourceRequirements: string;
  rootNodes: string[];
  nodes: Record<string, ProjectNode>;
  status: ProjectStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
}

/** @deprecated 使用 TaskStatus 替代 */
export type WorkItemFilter =
  "all" | "pending" | "in_progress" | "review" | "done" | "blocked";

/** @deprecated 使用 TaskStatus 替代 */
export type ProjectViewMode = "board" | "dag" | "list";

// ========== 统一任务模型（Phase A 新增） ==========

/**
 * 任务类型（合并 WorkItemType + ProjectNodeType）
 * - 规划层: project, phase, story
 * - 执行层: task, bug, feature, refactor, docs, decision
 */
export type TaskType =
  | "project"
  | "phase"
  | "story"
  | "task"
  | "bug"
  | "feature"
  | "refactor"
  | "docs"
  | "decision";

/**
 * 任务状态
 * 流水线: planning → pending → active → review → completed → archived
 * 旁路: paused, failed
 */
export type TaskStatus =
  | "planning"
  | "pending"
  | "active"
  | "paused"
  | "review"
  | "completed"
  | "archived"
  | "failed";

/** 任务优先级（0=最高/P0, 3=最低/P3） */
export type TaskPriority = 0 | 1 | 2 | 3;

/** 优先级展示映射 */
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
};

/**
 * 统一任务节点
 *
 * 同时承载"规划分解"（parentId, dependsOn）和"执行跟踪"（sessionId, changeSet）两种视角。
 * Phase D 后将替代 WorkItem 和 ProjectNode。
 */
export interface TaskNode {
  id: string;
  workspaceId: string;
  projectId?: string;

  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];

  // 树结构
  parentId?: string;
  dependsOn: string[];
  estimatedEffort?: string;

  // 执行跟踪
  assignee?: string;
  sessionId?: string;
  estimatedImpact?: string;
  riskWarnings?: string[];

  // 进度
  progress: number;

  // 时间戳（ISO 8601 字符串）
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 项目 V2（含 TaskNode 树）
 *
 * Phase D 后将替代 Project。
 */
export interface ProjectV2 {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  sourceRequirements?: string;
  rootTaskIds: string[];
  status: "planning" | "active" | "paused" | "completed" | "archived";
  progress: number;
  createdAt: string;
  updatedAt: string;
}

/** 项目状态过滤 */
export type TaskStatusFilter = "all" | TaskStatus;

/** 视图模式 */
export type TaskViewMode = "board" | "dag" | "list";

// ========== 规范 WorkItem 类型（与后端 app/src/workspace/types.ts 一致） ==========

/**
 * 工作项状态
 *
 * @deprecated 新代码使用 TaskStatus。旧代码仍可用。
 */
export type WorkItemStatus =
  "pending" | "running" | "paused" | "review" | "done" | "failed";

/**
 * 工作项类型
 *
 * @deprecated 新代码使用 TaskType。旧代码仍可用。
 */
export type WorkItemType =
  "task" | "bug" | "feature" | "refactor" | "docs" | "decision";

/**
 * 工作项（与后端 WorkItem 类型一致）
 *
 * @deprecated 新代码使用 TaskNode。Phase D 移除。
 */
export interface WorkItem {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  tags?: string[];
  priority?: number;
}
