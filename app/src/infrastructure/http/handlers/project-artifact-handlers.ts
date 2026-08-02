/**
 * 项目构件 HTTP API 处理器
 *
 * GET    /v1/projects/:projectId/artifacts?kind=input|output  列出构件
 * POST   /v1/projects/:projectId/artifacts                    添加/更新构件
 * DELETE /v1/projects/:projectId/artifacts/:artifactId        删除构件
 */

import type http from 'http';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { resolvePyappHome } from '@modules/core';
import { ProjectArtifactStore } from '../../../project/ProjectArtifactStore';
import type {
  ProjectArtifact,
  ArtifactKind,
} from '../../../project/ProjectArtifactStore';
import { ProjectContextService } from '../../../project/ProjectContextService';

/** 与 ProjectStore 保持一致的存储路径：~/.pyapp/projects/ */
const LIRI_PROJECTS_DIR = join(resolvePyappHome(), 'projects');
const artifactStore = new ProjectArtifactStore(LIRI_PROJECTS_DIR);

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** GET /v1/projects/:projectId/artifacts */
export async function handleListArtifacts(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  );
  const kind = url.searchParams.get('kind') as ArtifactKind | null;

  const artifacts = artifactStore.list(
    projectId,
    kind === 'input' || kind === 'output' ? kind : undefined
  );
  json(res, 200, artifacts);
}

/** POST /v1/projects/:projectId/artifacts */
export async function handleSaveArtifact(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const body = await readBody(req);
    const data = JSON.parse(body) as Partial<ProjectArtifact>;

    if (!data.title || !data.content) {
      json(res, 400, { error: '缺少 title 或 content' });
      return;
    }

    const artifact: ProjectArtifact = {
      id: data.id || randomUUID(),
      projectId,
      kind: data.kind || 'output',
      title: data.title,
      content: data.content,
      sessionId: data.sessionId,
      refId: data.refId,
      createdAt: data.createdAt || new Date().toISOString(),
    };

    artifactStore.save(artifact);
    json(res, 200, artifact);
  } catch {
    json(res, 500, { error: '保存构件失败' });
  }
}

/** DELETE /v1/projects/:projectId/artifacts/:artifactId */
export async function handleDeleteArtifact(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
  artifactId: string
): Promise<void> {
  const deleted = artifactStore.delete(projectId, artifactId);
  json(
    res,
    deleted ? 200 : 404,
    deleted ? { ok: true } : { error: '构件不存在' }
  );
}

/** GET /v1/projects/:projectId/context — 返回 rules.md 解析后的 ProjectContext */
export async function handleGetProjectContext(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const rulesPath = join(LIRI_PROJECTS_DIR, projectId, 'rules.md');
    const entries = ProjectContextService.parseRulesFile(rulesPath);
    json(res, 200, entries);
  } catch {
    json(res, 500, { error: '解析项目上下文失败' });
  }
}
