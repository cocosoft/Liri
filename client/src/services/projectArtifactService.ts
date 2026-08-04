/**
 * 项目构件前端服务
 *
 * 调用后端 /v1/projects/:projectId/artifacts API
 *        /v1/projects/:projectId/context API
 */

export interface ProjectArtifact {
  id: string;
  projectId: string;
  kind: "input" | "output";
  sessionId?: string;
  refId?: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface ProjectContext {
  type: "goal" | "scope" | "constraint" | "requirement" | "knowledge";
  content: string;
  domain?: string;
  line: number;
}

const API_BASE = "/v1/projects";

export async function fetchArtifacts(
  projectId: string,
  kind?: "input" | "output",
): Promise<ProjectArtifact[]> {
  const params = kind ? `?kind=${kind}` : "";
  const res = await fetch(`${API_BASE}/${projectId}/artifacts${params}`);
  if (!res.ok) throw new Error(`获取构件失败: ${res.status}`);
  return res.json();
}

export async function saveArtifact(
  artifact: Partial<ProjectArtifact> & {
    projectId: string;
    title: string;
    content: string;
  },
): Promise<ProjectArtifact> {
  const res = await fetch(`${API_BASE}/${artifact.projectId}/artifacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(artifact),
  });
  if (!res.ok) throw new Error(`保存构件失败: ${res.status}`);
  return res.json();
}

export async function deleteArtifact(
  projectId: string,
  artifactId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/${projectId}/artifacts/${artifactId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`删除构件失败: ${res.status}`);
}

/** 获取项目的结构化上下文（rules.md 解析结果） */
export async function fetchProjectContext(
  projectId: string,
): Promise<ProjectContext[]> {
  const res = await fetch(`${API_BASE}/${projectId}/context`);
  if (!res.ok) return [];
  return res.json();
}

/** 获取项目会话摘要/决策/阶段性小结 */
export interface ProjectSummary {
  sessionId: string;
  summary: string;
  messageCount: number;
  createdAt: string;
  decision?: string;
  phaseSummary?: boolean;
}

export async function fetchSummaries(
  projectId: string,
): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_BASE}/${projectId}/summaries`);
  if (!res.ok) return [];
  return res.json();
}

/** S4: sandbox 文件条目 */
export interface ProjectFileEntry {
  name: string;
  size: number;
  type: string;
}

/** S4: sandbox 文件列表响应 */
export interface ProjectFilesResult {
  files: ProjectFileEntry[];
  dirs: { name: string; type: "dir" }[];
  sandboxPath: string;
}

/** S4: 获取项目 sandbox 文件列表 */
export async function fetchProjectFiles(
  projectId: string,
): Promise<ProjectFilesResult | null> {
  const res = await fetch(`${API_BASE}/${projectId}/files`);
  if (!res.ok) return null;
  return res.json();
}

/** 讨论记录历史条目 */
export interface HistoryEntry {
  ts: string;
  sessionId: string;
  type: "message" | "decision" | "tool_call" | "pdca_phase" | "context_change";
  summary: string;
  detail?: string;
  messageId?: string;
  pdcaPhase?: string;
  internal?: boolean;
}

/** 按 sessionId 分组的历史记录 */
export interface HistoryGroup {
  sessionId: string;
  dates: string[];
  itemCount: number;
  summary: string;
  items: HistoryEntry[];
}

/** 获取项目讨论记录（按 session 分组） */
export async function fetchProjectHistory(
  projectId: string,
  since?: string,
): Promise<HistoryGroup[]> {
  const params = since ? `?since=${encodeURIComponent(since)}` : "";
  const res = await fetch(`${API_BASE}/${projectId}/history${params}`);
  if (!res.ok) return [];
  return res.json();
}

/**
 * 隐性引擎钩子：分析消息文本，自动写入 rules.md 和 artifacts
 * 建议在 AI 回复完成后调用（fire-and-forget）
 */
export async function triggerEngineHook(
  projectId: string,
  text: string,
): Promise<void> {
  try {
    await fetch(`${API_BASE}/${projectId}/engine-hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    /* 引擎钩子失败不影响主流程 */
  }
}

// ─── P0b: Project CRUD ───

export interface ProjectInfo {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: string;
  phase?: string;
  template?: string;
  tags?: string[];
  sandboxPath?: string;
  workItemIds?: string[];
  pdcaIds?: string[];
  createdAt: string;
  updatedAt: string;
}

/** P0b: 获取项目列表 */
export async function fetchProjects(
  workspaceId?: string,
): Promise<ProjectInfo[]> {
  const params = workspaceId
    ? `?workspaceId=${encodeURIComponent(workspaceId)}`
    : "";
  const res = await fetch(`${API_BASE}${params}`);
  if (!res.ok) return [];
  return res.json();
}

/** P0b: 创建项目（返回 projectId，前端用此作为 worktreeId） */
export async function createProject(params: {
  name: string;
  description?: string;
  workspaceId?: string;
  sandboxPath?: string;
  tags?: string[];
}): Promise<ProjectInfo> {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`创建项目失败: ${res.status}`);
  return res.json();
}

/** P0b: 获取项目详情 */
export async function fetchProject(
  projectId: string,
): Promise<ProjectInfo | null> {
  const res = await fetch(`${API_BASE}/${projectId}`);
  if (!res.ok) return null;
  return res.json();
}

/** P0b: 更新项目 */
export async function updateProject(
  projectId: string,
  updates: Partial<
    Pick<ProjectInfo, "name" | "description" | "status" | "tags">
  >,
): Promise<ProjectInfo | null> {
  const res = await fetch(`${API_BASE}/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) return null;
  return res.json();
}

/** P0b: 删除项目 */
export async function deleteProject(projectId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/${projectId}`, { method: "DELETE" });
  return res.ok;
}

// ─── P0b-4: 旧数据迁移 ───

const MIGRATION_DONE_KEY = "liri_project_migration_v8_done";

export interface MigrationResult {
  files: { copied: number; skipped: number };
  worktrees: { created: number; skipped: number };
}

/**
 * 执行一次性迁移：读取 localStorage 中的旧 worktree，批量创建 Project 实体
 * 迁移完成后设置标记，后续启动跳过
 */
export async function migrateLegacyData(): Promise<MigrationResult | null> {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return null;

  const worktrees: Array<{
    id: string;
    name: string;
    path?: string;
    description?: string;
  }> = [];

  try {
    const raw = localStorage.getItem("liri-root-store");
    if (raw) {
      const state = JSON.parse(raw);
      const wtMap = state.state?.worktrees;
      if (wtMap && typeof wtMap === "object") {
        for (const [id, wt] of Object.entries(wtMap) as [
          string,
          { name?: string; path?: string; description?: string },
        ][]) {
          if (!id || !wt.name) continue;
          worktrees.push({
            id,
            name: wt.name,
            path: wt.path,
            description: wt.description,
          });
        }
      }
    }
  } catch {
    /* localStorage 读取失败，跳过 */
  }

  if (worktrees.length === 0) {
    localStorage.setItem(MIGRATION_DONE_KEY, "1");
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/migrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktrees }),
    });
    if (res.ok) {
      localStorage.setItem(MIGRATION_DONE_KEY, "1");
      return res.json();
    }
  } catch {
    /* 迁移失败，下次重试 */
  }

  return null;
}
