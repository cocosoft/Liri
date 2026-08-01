/**
 * TaskService — 统一任务 API 封装
 *
 * Phase C: 封装后端 /v1/tasks 端点，为 projectStore 迁移提供 HTTP 数据源。
 * 遵循 workspaceService.ts 的 http 调用模式。
 */

import { http } from "./httpClient";
import type { TaskNode, TaskStatus } from "../types/work";
import { createLogger } from "@/utils/logger";

const logger = createLogger("services:taskService");

// ─── 请求/响应类型 ───

interface TaskListResponse {
  data: { tasks: TaskNode[]; total: number };
}

interface TaskDetailResponse {
  data: TaskNode;
}

interface TaskDeleteResponse {
  data: { deleted: boolean };
}

interface TaskChildrenResponse {
  data: { tasks: TaskNode[]; total: number };
}

export interface CreateTaskParams {
  workspaceId: string;
  projectId?: string;
  title: string;
  description?: string;
  type?: TaskNode["type"];
  status?: TaskStatus;
  priority?: TaskNode["priority"];
  tags?: string[];
  parentId?: string;
  dependsOn?: string[];
  estimatedEffort?: string;
  assignee?: string;
  sessionId?: string;
  progress?: number;
}

export interface UpdateTaskParams {
  title?: string;
  description?: string;
  type?: TaskNode["type"];
  status?: TaskStatus;
  priority?: TaskNode["priority"];
  progress?: number;
  tags?: string[];
  parentId?: string;
  dependsOn?: string[];
  estimatedEffort?: string;
  assignee?: string;
  sessionId?: string;
}

export const taskService = {
  /**
   * 列出任务
   * GET /v1/tasks?workspaceId=xxx&projectId=xxx&status=xxx
   */
  async list(params: {
    workspaceId?: string;
    projectId?: string;
    status?: TaskStatus;
  }): Promise<TaskNode[]> {
    const query = new URLSearchParams();
    if (params.workspaceId) query.set("workspaceId", params.workspaceId);
    if (params.projectId) query.set("projectId", params.projectId);
    if (params.status) query.set("status", params.status);

    const res = await http.get<TaskListResponse>(
      `/v1/tasks?${query.toString()}`,
    );
    if (!res.ok) {
      logger.warn("获取任务列表失败", { error: res.error });
      return [];
    }
    return (res.data as TaskListResponse)?.data?.tasks || [];
  },

  /**
   * 获取单个任务
   * GET /v1/tasks/:taskId
   */
  async get(taskId: string): Promise<TaskNode | null> {
    const res = await http.get<TaskDetailResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
    );
    if (!res.ok) return null;
    return (res.data as TaskDetailResponse)?.data || null;
  },

  /**
   * 创建任务
   * POST /v1/tasks
   */
  async create(params: CreateTaskParams): Promise<TaskNode | null> {
    const res = await http.post<TaskDetailResponse>("/v1/tasks", params);
    if (!res.ok) {
      logger.warn("创建任务失败", { error: res.error });
      return null;
    }
    return (res.data as TaskDetailResponse)?.data || null;
  },

  /**
   * 更新任务
   * PATCH /v1/tasks/:taskId
   */
  async update(
    taskId: string,
    updates: UpdateTaskParams,
  ): Promise<TaskNode | null> {
    const res = await http.patch<TaskDetailResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      updates,
    );
    if (!res.ok) return null;
    return (res.data as TaskDetailResponse)?.data || null;
  },

  /**
   * 删除任务
   * DELETE /v1/tasks/:taskId
   */
  async delete(taskId: string): Promise<boolean> {
    const res = await http.delete<TaskDeleteResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
    );
    return res.ok;
  },

  /**
   * 获取子任务
   * GET /v1/tasks/:taskId/children
   */
  async getChildren(taskId: string): Promise<TaskNode[]> {
    const res = await http.get<TaskChildrenResponse>(
      `/v1/tasks/${encodeURIComponent(taskId)}/children`,
    );
    if (!res.ok) return [];
    return (res.data as TaskChildrenResponse)?.data?.tasks || [];
  },

  /**
   * 批量创建任务树（从 decompose 结果导入）
   */
  async importNodes(
    workspaceId: string,
    projectId: string,
    nodes: TaskNode[],
  ): Promise<number> {
    let count = 0;
    for (const node of nodes) {
      const created = await this.create({
        workspaceId,
        projectId,
        title: node.title,
        description: node.description,
        type: node.type,
        priority: node.priority,
        tags: node.tags,
        parentId: node.parentId,
        dependsOn: node.dependsOn,
        estimatedEffort: node.estimatedEffort,
        assignee: node.assignee,
      });
      if (created) count++;
    }
    return count;
  },
};
