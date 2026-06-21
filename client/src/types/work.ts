/** ═══════════════════════════════════════════════════
 * 工作模块类型体系
 * 三层结构:Project → WorkItem (子树) → Task (叶节点)
 * ═══════════════════════════════════════════════════ */

/** 项目优先级 */
export type ProjectPriority = "P0" | "P1" | "P2" | "P3";

/** 项目状态 */
export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";

/** 节点类型 */
export type ProjectNodeType = "project" | "phase" | "story" | "task";

/** 分解树中的节点 */
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

/** 项目定义 */
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

/** 工作项状态过滤 */
export type WorkItemFilter = "all" | "pending" | "in_progress" | "review" | "done" | "blocked";

/** 视图模式 */
export type ProjectViewMode = "board" | "dag" | "list";
