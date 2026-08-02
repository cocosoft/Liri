/**
 * 项目构件 HTTP API 处理器
 *
 * GET    /v1/projects/:projectId/artifacts?kind=input|output  列出构件
 * POST   /v1/projects/:projectId/artifacts                    添加/更新构件
 * DELETE /v1/projects/:projectId/artifacts/:artifactId        删除构件
 */

import type http from 'http';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { resolvePyappHome } from '@modules/core';
import { ProjectArtifactStore } from '../../../project/ProjectArtifactStore';
import type {
  ProjectArtifact,
  ArtifactKind,
} from '../../../project/ProjectArtifactStore';
import { ProjectContextService } from '../../../project/ProjectContextService';
import { ImplicitEngineHook } from '../../../project/ImplicitEngineHook';

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

/** POST /v1/projects/:projectId/context — 写入 rules.md type 条目 */
export async function handleSaveProjectContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const body = await readBody(req);
    const { type, content, domain } = JSON.parse(body) as {
      type?: string;
      content?: string;
      domain?: string;
    };

    const validTypes = [
      'goal',
      'scope',
      'constraint',
      'requirement',
      'knowledge',
    ];
    if (!type || !validTypes.includes(type) || !content) {
      json(res, 400, {
        error:
          '缺少或无效的 type（需为 goal/scope/constraint/requirement/knowledge）或 content',
      });
      return;
    }

    const projectDir = join(LIRI_PROJECTS_DIR, projectId);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    const rulesPath = join(projectDir, 'rules.md');
    let existingLines: string[] = [];
    if (existsSync(rulesPath)) {
      existingLines = readFileSync(rulesPath, 'utf-8').split('\n');
    }

    // 构建设计新条目
    const marker = `### [${type}] ${content}`;
    const lines = [...existingLines];

    // 找到或创建对应 domain 的 ## 节
    if (domain) {
      let domainIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === `## ${domain}`) {
          domainIdx = i;
          break;
        }
      }
      if (domainIdx >= 0) {
        // 在 domain 节的末尾插入（下一个 ## 或文件末尾之前）
        let insertIdx = domainIdx + 1;
        while (
          insertIdx < lines.length &&
          !lines[insertIdx].trim().startsWith('## ')
        ) {
          insertIdx++;
        }
        lines.splice(insertIdx, 0, marker);
      } else {
        // 新建 domain 节
        if (lines.length > 0 && lines[lines.length - 1] !== '') {
          lines.push('');
        }
        lines.push(`## ${domain}`);
        lines.push(marker);
      }
    } else {
      // 无 domain，追加到文件末尾
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(marker);
    }

    writeFileSync(rulesPath, lines.join('\n') + '\n', 'utf-8');
    json(res, 200, { ok: true, marker });
  } catch {
    json(res, 500, { error: '写入项目上下文失败' });
  }
}

/** POST /v1/projects/:projectId/engine-hook — 隐性引擎：分析消息并自动写入 */
export async function handleEngineHook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const body = await readBody(req);
    const { text } = JSON.parse(body) as { text?: string };

    if (!text || text.length < 5) {
      json(res, 200, { processed: false, reason: 'text too short' });
      return;
    }

    const result = await ImplicitEngineHook.persist(
      projectId,
      text,
      LIRI_PROJECTS_DIR
    );
    json(res, 200, {
      processed: result.contexts > 0 || result.deliverables > 0,
      ...result,
    });
  } catch {
    json(res, 500, { error: '引擎钩子执行失败' });
  }
}

/** GET /v1/projects/:projectId/history — 返回分组后的讨论记录 */
export async function handleGetProjectHistory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const since = url.searchParams.get('since') || undefined;
    const { createProjectHistoryStore } = await import('../../../project/ProjectHistoryStore');
    const store = createProjectHistoryStore(projectId);
    const groups = store.getGrouped(since);
    json(res, 200, groups);
  } catch {
    json(res, 500, { error: '读取讨论记录失败' });
  }
}
