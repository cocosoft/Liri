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

/** `POST /v1/projects/:id/relocate` 响应（§九口径） */
export interface RelocateProjectResult {
  success: boolean;
  /** 目标与当前相同（幂等，未改任何东西） */
  noop: boolean;
  sandboxPath: string;
  /** 改之前的路径（界面可据此提示"从 A 换到 B"） */
  previousPath: string;
  /** 旧路径当前是否仍可用 ⇒ 界面文案区分「修复位置」/「更换位置」 */
  oldPathValid: boolean;
  sessionsUpdated: number;
  sessionsFailed: number;
  warnings: string[];
}

/**
 * 项目「重新定位」：**只改指向，不复制/不移动文件**（§九）。
 *
 * 后端要求目标**已存在且是目录**；失败时 `error` 里给的是可操作中文原因。
 */
export async function relocateProject(
  projectId: string,
  sandboxPath: string
): Promise<RelocateProjectResult> {
  const res = await fetch(
    `${ENDPOINTS.project.base}/${encodeURIComponent(projectId)}/relocate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxPath }),
    }
  );
  const data = (await res.json().catch(() => null)) as
    | (Partial<RelocateProjectResult> & { error?: string })
    | null;
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `重新定位失败（HTTP ${res.status}）`);
  }
  return data as RelocateProjectResult;
}
