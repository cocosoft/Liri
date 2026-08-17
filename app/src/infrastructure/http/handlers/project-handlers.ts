/**
 * P0b-1: 项目 CRUD HTTP API (/v1/projects)
 *
 * 选项 A 统一后，前端 worktreeId = 后端 projectId。
 * 本 handler 直接操作 ProjectStore，替代旧的 workspaces 子路由。
 */

import type http from 'http';
import { resolveDataDir } from '@modules/core';
import { createProjectStore } from '../../../workspace/ProjectStore.js';
import { WorkItemStore } from '../../../workspace/WorkItemStore.js';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import {
  migrateLegacyFiles,
  migrateWorktrees,
} from '../../../project/MigrationService';
import { readBody, json } from './handler-utils';

const logger = getLogger('project:handlers');

let _workItemStore: WorkItemStore | null = null;
let _projectStore: ReturnType<typeof createProjectStore> | null = null;
function getProjectStore() {
  if (!_projectStore || !_workItemStore) {
    const dataDir = resolveDataDir();
    _workItemStore = new WorkItemStore(dataDir);
    _projectStore = createProjectStore(dataDir, _workItemStore);
  }
  return _projectStore;
}

// ─── GET /v1/projects — 列出所有项目 ───
export async function handleListProjects(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:listProjects');
  try {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const workspaceId = url.searchParams.get('workspaceId') || 'default';
    const store = getProjectStore();
    const projects = store.list(workspaceId);
    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 200, projects);
  } catch (e) {
    await handleError(e, {
      module: 'project:handlers',
      action: 'listProjects',
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '获取项目列表失败' });
  } finally {
    span.end();
  }
}

// ─── POST /v1/projects — 创建项目 ───
export async function handleCreateProject(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:createProject');
  try {
    const body = await readBody(req);
    const { name, description, workspaceId, tags, sandboxPath, template } =
      JSON.parse(body);

    if (!name) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 400, { error: '缺少 name' });
      return;
    }

    const store = getProjectStore();
    const project = store.create({
      workspaceId: workspaceId || 'default',
      name,
      description: description || '',
      tags,
      sandboxPath,
      template,
    });

    logger.info('项目已创建', { projectId: project.id, name });
    span.setAttribute('projectId', project.id);
    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 201, project);
  } catch (e) {
    logger.error('创建项目失败', { error: String(e) });
    await handleError(e, {
      module: 'project:handlers',
      action: 'createProject',
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '创建项目失败' });
  } finally {
    span.end();
  }
}

// ─── GET /v1/projects/:projectId — 获取项目详情 ───
export async function handleGetProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:getProject');
  span.setAttribute('projectId', projectId);
  try {
    const store = getProjectStore();
    const project = store.get(projectId);
    if (!project) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 404, { error: '项目不存在' });
      return;
    }
    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 200, project);
  } catch (e) {
    await handleError(e, { module: 'project:handlers', action: 'getProject' });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '获取项目失败' });
  } finally {
    span.end();
  }
}

// ─── PATCH /v1/projects/:projectId — 更新项目 ───
export async function handleUpdateProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:updateProject');
  span.setAttribute('projectId', projectId);
  try {
    const body = await readBody(req);
    const raw = JSON.parse(body) as Record<string, unknown>;
    // BUG-4 修复：字段白名单——原实现直接透传请求体，`{...project, ...updates}`
    // 可注入 id/workspaceId/sandboxPath/workItemIds/pdcaIds/createdAt 等（改写到新目录、
    // 幽灵项目、篡改归属）。仅允许可编辑字段，且 tags 必须是字符串数组。
    const updates: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'status',
      'tags',
      'template',
    ] as const) {
      if (raw[key] !== undefined) updates[key] = raw[key];
    }
    if (updates.tags !== undefined && !Array.isArray(updates.tags)) {
      json(res, 400, { error: 'tags 必须是数组' });
      return;
    }
    const store = getProjectStore();
    const project = store.update(
      projectId,
      updates as Parameters<typeof store.update>[1]
    );
    if (!project) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 404, { error: '项目不存在' });
      return;
    }
    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 200, project);
  } catch (e) {
    await handleError(e, {
      module: 'project:handlers',
      action: 'updateProject',
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '更新项目失败' });
  } finally {
    span.end();
  }
}

// ─── DELETE /v1/projects/:projectId — 删除项目 ───
export async function handleDeleteProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:deleteProject');
  span.setAttribute('projectId', projectId);
  try {
    const store = getProjectStore();
    const deleted = store.delete(projectId);
    span.setStatus({ code: SpanStatusCode.OK });
    json(
      res,
      deleted ? 200 : 404,
      deleted ? { ok: true } : { error: '项目不存在' }
    );
  } catch (e) {
    await handleError(e, {
      module: 'project:handlers',
      action: 'deleteProject',
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '删除项目失败' });
  } finally {
    span.end();
  }
}

// ─── P0b-4: POST /v1/projects/migrate — 批量迁移 worktree + 旧文件 ───
export async function handleMigrateProjects(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:migrate');
  try {
    const body = await readBody(req);
    const { worktrees } = JSON.parse(body) as {
      worktrees?: Array<{
        id: string;
        name: string;
        path?: string;
        description?: string;
      }>;
    };

    // 1. 文件级迁移（旧路径 → 新路径，幂等）
    const fileResult = migrateLegacyFiles();

    // 2. worktree → Project 实体
    let wtResult = { created: 0, skipped: 0 };
    if (worktrees && worktrees.length > 0) {
      wtResult = migrateWorktrees(worktrees);
    }

    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 200, {
      files: fileResult,
      worktrees: wtResult,
    });
  } catch (e) {
    logger.error('迁移失败', { error: String(e) });
    await handleError(e, { module: 'project:handlers', action: 'migrate' });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '迁移失败' });
  } finally {
    span.end();
  }
}

/** P0b-4a: 仅执行文件迁移（启动时调用，无请求体） */
export async function handleMigrateFiles(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:migrateFiles');
  try {
    const result = migrateLegacyFiles();
    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 200, result);
  } catch (e) {
    await handleError(e, {
      module: 'project:handlers',
      action: 'migrateFiles',
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '文件迁移失败' });
  } finally {
    span.end();
  }
}
