/**
 * 项目列表前端服务（`GET /v1/projects`）
 *
 * **事实源**：后端 `<data>/projects`（本机实测 20 条）。
 *
 * 为什么不复用 `workspaceService.listWorkspaces()`：`GET /v1/workspaces` 是旧链路，
 * 扫描的是 `<data>/workspaces` —— 该目录在当前数据布局下**不存在**，实测恒返回 `[]`。
 * 项目页若只依赖它 + localStorage 的 `worktrees`，就会出现两套事实：
 * 列表里是陈旧/重复项（3 个同名 default、1 个路径名），而后端真实项目（含 5 条带历史
 * 消息的项目会话所绑定的 `proj_*`）在 UI 里不可见（台账 F-17）。
 */

import { ENDPOINTS } from "./endpoints";

/** `GET /v1/projects` 的列表项（字段与后端 project-routes 的响应一致） */
export interface ProjectListItem {
  id: string;
  name: string;
  description?: string;
  /** 归属工作空间（旧链路概念，可能是 `default`） */
  workspaceId?: string;
  status?: string;
  phase?: string;
  /** 项目沙箱目录（工具默认 cwd 依赖它） */
  sandboxPath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const res = await fetch(ENDPOINTS.project.base);
  if (!res.ok) {
    throw new Error(`获取项目列表失败（HTTP ${res.status}）`);
  }
  return (await res.json()) as ProjectListItem[];
}
