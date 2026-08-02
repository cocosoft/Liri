/**
 * 项目构件前端服务
 *
 * 调用后端 /v1/projects/:projectId/artifacts API
 *        /v1/projects/:projectId/context API
 */

export interface ProjectArtifact {
  id: string;
  projectId: string;
  kind: 'input' | 'output';
  sessionId?: string;
  refId?: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface ProjectContext {
  type: 'goal' | 'scope' | 'constraint' | 'requirement' | 'knowledge';
  content: string;
  domain?: string;
  line: number;
}

const API_BASE = '/v1/projects';

export async function fetchArtifacts(
  projectId: string,
  kind?: 'input' | 'output'
): Promise<ProjectArtifact[]> {
  const params = kind ? `?kind=${kind}` : '';
  const res = await fetch(`${API_BASE}/${projectId}/artifacts${params}`);
  if (!res.ok) throw new Error(`获取构件失败: ${res.status}`);
  return res.json();
}

export async function saveArtifact(
  artifact: Partial<ProjectArtifact> & { projectId: string; title: string; content: string }
): Promise<ProjectArtifact> {
  const res = await fetch(`${API_BASE}/${artifact.projectId}/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(artifact),
  });
  if (!res.ok) throw new Error(`保存构件失败: ${res.status}`);
  return res.json();
}

export async function deleteArtifact(
  projectId: string,
  artifactId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/${projectId}/artifacts/${artifactId}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(`删除构件失败: ${res.status}`);
}

/** 获取项目的结构化上下文（rules.md 解析结果） */
export async function fetchProjectContext(
  projectId: string
): Promise<ProjectContext[]> {
  const res = await fetch(`${API_BASE}/${projectId}/context`);
  if (!res.ok) return [];
  return res.json();
}

/** 讨论记录历史条目 */
export interface HistoryEntry {
  ts: string;
  sessionId: string;
  type: 'message' | 'decision' | 'tool_call' | 'pdca_phase' | 'context_change';
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
  since?: string
): Promise<HistoryGroup[]> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
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
  text: string
): Promise<void> {
  try {
    await fetch(`${API_BASE}/${projectId}/engine-hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    /* 引擎钩子失败不影响主流程 */
  }
}
