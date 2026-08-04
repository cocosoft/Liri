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
import { resolveDataDir } from '@modules/core';
import { ProjectArtifactStore } from '../../../project/ProjectArtifactStore';
import type {
  ProjectArtifact,
  ArtifactKind,
} from '../../../project/ProjectArtifactStore';
import { ProjectContextService } from '../../../project/ProjectContextService';
import { ImplicitEngineHook } from '../../../project/ImplicitEngineHook';
import { ProjectItemStore } from '../../../workspace/ProjectItemStore';
import type { ProjectContext } from '@modules/workspace/types';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { readBody, json } from './handler-utils';

const logger = new Logger({
  module: 'project:artifactHandlers',
  level: LogLevel.INFO,
});

/** P0-3: 存储路径收敛到 resolveDataDir()/projects/ */
const LIRI_PROJECTS_DIR = join(resolveDataDir(), 'projects');
const artifactStore = new ProjectArtifactStore(LIRI_PROJECTS_DIR);

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
    logger.info('构件已保存', { projectId, artifactId: artifact.id });
    json(res, 200, artifact);
  } catch (e) {
    logger.error('保存构件失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'saveArtifact',
    });
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

/** GET /v1/projects/:projectId/context — 返回 rules.md 或 items.db 的 ProjectContext */
export async function handleGetProjectContext(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const rulesPath = join(LIRI_PROJECTS_DIR, projectId, 'rules.md');
    if (existsSync(rulesPath)) {
      const entries = ProjectContextService.parseRulesFile(rulesPath);
      json(res, 200, entries);
      return;
    }

    // P2-4: rules.md 已迁移到 items.db，从 SQLite 读取
    const itemStore = new ProjectItemStore(projectId, resolveDataDir());
    if (itemStore.needsMigration()) {
      await itemStore.initialize();
      await itemStore.migrateFromLegacy();
    } else {
      await itemStore.initialize();
    }
    const items = await itemStore.list('context');
    const entries: ProjectContext[] = items.map((item, idx) => ({
      type: (item.type as ProjectContext['type']) ?? 'constraint',
      content: item.content,
      line: idx + 1,
    }));
    json(res, 200, entries);
  } catch (e) {
    logger.error('解析项目上下文失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'getContext',
    });
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
  } catch (e) {
    logger.error('写入项目上下文失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'saveContext',
    });
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
  } catch (e) {
    logger.error('引擎钩子执行失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'engineHook',
    });
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
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const since = url.searchParams.get('since') || undefined;
    const { createProjectHistoryStore } =
      await import('../../../project/ProjectHistoryStore');
    const store = createProjectHistoryStore(projectId);
    const groups = store.getGrouped(since);
    json(res, 200, groups);
  } catch (e) {
    logger.error('读取讨论记录失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'getHistory',
    });
    json(res, 500, { error: '读取讨论记录失败' });
  }
}

/** GET /v1/projects/:projectId/summaries — 读取项目会话摘要/决策/小结 */
export async function handleGetSummaries(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const summariesPath = join(
      resolveDataDir(),
      'projects',
      projectId,
      'summaries.json'
    );
    if (!existsSync(summariesPath)) {
      json(res, 200, []);
      return;
    }
    const raw = readFileSync(summariesPath, 'utf-8');
    const summaries = JSON.parse(raw);
    json(res, 200, summaries);
  } catch (e) {
    logger.error('读取摘要失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'getSummaries',
    });
    json(res, 500, { error: '读取摘要失败' });
  }
}

/** GET /v1/projects/:projectId/files — 列出项目 sandbox 文件夹中的文件（S4 chokidar 降级） */
export async function handleListProjectFiles(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const { createProjectStore } =
      await import('../../../workspace/ProjectStore.js');
    const { WorkItemStore } =
      await import('../../../workspace/WorkItemStore.js');
    const store = createProjectStore(
      resolveDataDir(),
      new WorkItemStore(resolveDataDir())
    );
    const project = store.get(projectId);
    if (!project || !project.sandboxPath) {
      json(res, 404, { error: '项目或文件夹不存在' });
      return;
    }
    if (!existsSync(project.sandboxPath)) {
      json(res, 200, []);
      return;
    }
    const { readdirSync: _readdir, statSync: _stat } = await import('fs');
    const entries = _readdir(project.sandboxPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((f) => {
        let size = 0;
        try {
          size = _stat(join(project.sandboxPath!, f.name)).size;
        } catch {
          /* 忽略 */
        }
        return {
          name: f.name,
          size,
          type: f.name.split('.').pop()?.toLowerCase() ?? 'other',
        };
      });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((d) => ({ name: d.name, type: 'dir' }));
    json(res, 200, { files, dirs, sandboxPath: project.sandboxPath });
  } catch (e) {
    logger.error('读取文件列表失败', { projectId, error: String(e) });
    await handleError(e, {
      module: 'project:artifactHandlers',
      action: 'listFiles',
    });
    json(res, 500, { error: '读取文件列表失败' });
  }
}
