/**
 * P0b-1: 项目 CRUD HTTP API (/v1/projects)
 *
 * 选项 A 统一后，前端 worktreeId = 后端 projectId。
 * 本 handler 直接操作 ProjectStore，替代旧的 workspaces 子路由。
 */

import type http from 'http';
import { existsSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';
// C1（2026-09-30 D-116，`workspace` 域 P4）：项目存储改经服务层端口
// （原具名/相对导入**不在此处复写** —— 门禁不剥离注释，写了会让「对」复活，见台账 D-77）
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getLogger, getOTelTracing } from '@openliri/infra/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@openliri/infra/error';
// C1（2026-09-30 D-117，`project` 域静态面）：迁移服务改经服务层端口
// （原相对导入**不在此处复写** —— 门禁不剥离注释，写了会让「对」复活，见台账 D-77）
import { readBody, json } from './handler-utils';
import { LOCAL_SERVICE_HOST, globalEventBus } from '@openliri/kernel';
// 2026-11-03：按项目的「自主执行」开关（infra 侧配置读写；service 层不得依赖 app/tasks）
import {
  PROJECT_AUTONOMY_CONFIG_KEY,
  isProjectAutonomyEnabled,
  setProjectAutonomyEnabled,
} from '@openliri/infra/config';

const logger = getLogger('project:handlers');

/**
 * C1（D-116）：项目存储改经服务层端口取用。
 * ⚠️ 原本地**缓存单例**（`_projectStore` / `_workItemStore`）已移除 ——
 * `ProjectStore` 每次调用**读写文件**、无跨调用内存状态 ⇒ 实例生命周期变化**无行为影响**。
 */
async function getProjectStore() {
  return (await getCoreAPI().getWorkspaceOpsPort()).getProjectStore();
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
      `http://${req.headers.host || LOCAL_SERVICE_HOST}`
    );
    const workspaceId = url.searchParams.get('workspaceId') || 'default';
    const store = await getProjectStore();
    // 2026-11-03：附带按项目的「自主执行」开关（前端右键菜单据此显示暂停/恢复）
    // 端口 `list()` 的返回是 `unknown`（跨层最小投影）⇒ 这里只声明用到的 `id`
    const rows = store.list(workspaceId) as Array<{ id: string }>;
    const projects = rows.map((p) => ({
      ...p,
      autonomyEnabled: isProjectAutonomyEnabled(p.id),
    }));
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

    // D-7 修复：tags 类型校验（原实现透传——字符串 tags 会存入 project.tags，
    // 前端 tags.map() 崩溃。update 已有校验，create 补齐）
    if (tags !== undefined && !Array.isArray(tags)) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 400, { error: 'tags 必须是数组' });
      return;
    }

    // P0（2026-11-03，cwd 方案 §六.3）：sandboxPath **写入期校验**（API 边界 400，
    // 与 ProjectStore.create 的 fail-fast 同口径）——无效路径一旦落盘成元数据，
    // 工具链要到 spawn 期才以「cmd.exe 缺失」的误导性错误炸开。
    if (sandboxPath !== undefined) {
      if (typeof sandboxPath !== 'string' || !isAbsolute(sandboxPath)) {
        span.setStatus({ code: SpanStatusCode.OK });
        json(res, 400, { error: 'sandboxPath 必须是绝对路径' });
        return;
      }
      if (existsSync(sandboxPath) && !statSync(sandboxPath).isDirectory()) {
        span.setStatus({ code: SpanStatusCode.OK });
        json(res, 400, {
          error: `sandboxPath 已存在但不是目录: ${sandboxPath}`,
        });
        return;
      }
    }

    const store = await getProjectStore();
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
    const store = await getProjectStore();
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

// ─── PUT /v1/projects/:projectId/autonomy — 按项目暂停/恢复自主执行 ───
//
// 口径（2026-11-05 起）：缺省 = **关**（只有显式 `enabled: true` 才允许自主执行）；
// - 运行期生效：写完后进程内广播 `config:changed`，由 `alwaysOnEntry` 立即
//   `runtime.stop()` / `runtime.start()`（不重启应用、不重建会话）；
// - 项目必须存在（否则 404）—— 避免给不存在的 id 写脏配置。
export async function handleSetProjectAutonomy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  try {
    const body = await readBody(req);
    const raw = JSON.parse(body || '{}') as { enabled?: unknown };
    if (typeof raw.enabled !== 'boolean') {
      json(res, 400, { error: 'enabled 必须是布尔值' });
      return;
    }
    const store = await getProjectStore();
    if (!store.get(projectId)) {
      json(res, 404, { error: '项目不存在' });
      return;
    }
    const map = setProjectAutonomyEnabled(projectId, raw.enabled);
    globalEventBus.publish('config:changed', {
      key: PROJECT_AUTONOMY_CONFIG_KEY,
      value: map,
    });
    logger.info('项目自主执行开关已更新', {
      projectId,
      enabled: raw.enabled,
    });
    json(res, 200, {
      success: true,
      projectId,
      enabled: isProjectAutonomyEnabled(projectId),
    });
  } catch (e) {
    await handleError(e, {
      module: 'project:handlers',
      action: 'setProjectAutonomy',
    });
    json(res, 500, { error: '更新自主执行开关失败' });
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
    const store = await getProjectStore();
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

// ─── POST /v1/projects/:projectId/relocate — 重新定位项目目录 ───
//
// 口径：`dev_docs/20261103/工具cwd无效根因与修复方案-20261103.md §九`
// - **只改指向**：不复制 / 不移动 / 不删除任何文件；
// - 目标必须**已存在且是目录**（不自动建目录，避免"指针修好、产物不在"的假修复）；
// - 与会话联动：把 `metadata.workspacePath === 旧路径` 的同项目会话改到新路径；
// - 刻意**不**放宽 PATCH 的字段白名单（那里排除 sandboxPath 是 BUG-4 防注入）。

/** 路径等价比较（Windows 大小写不敏感） */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string =>
    process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
  return norm(a) === norm(b);
}

/** 会话跟随所需的最小 API 面（便于单测注入替身；生产用 `getCoreAPI()`） */
export interface RelocateSessionApi {
  listSessions: () => Promise<
    Array<{ id: string; metadata?: Record<string, unknown> }>
  >;
  updateSessionMeta: (
    sessionId: string,
    meta: { workspacePath?: string }
  ) => Promise<void>;
}

/**
 * 会话跟随：把该项目的、工作区仍指向**旧路径**的会话改写到新路径。
 *
 * 注意：`updateSessionMeta` 内部对**持久化失败**是 `handleError` 后吞掉（不抛），
 * 因此 `failed` 只统计"调用本身抛错"的硬失败；落盘错误以会话层日志为准。
 */
export async function followSessionsToRelocatedPath(
  projectId: string,
  from: string,
  to: string,
  api: RelocateSessionApi = getCoreAPI() as unknown as RelocateSessionApi
): Promise<{ updated: number; failed: number; warnings: string[] }> {
  const sessions = await api.listSessions();
  const targets = sessions.filter((s) => {
    const metadata = s.metadata as Record<string, unknown> | undefined;
    const workspacePath = metadata?.workspacePath;
    return (
      metadata?.projectId === projectId &&
      typeof workspacePath === 'string' &&
      isAbsolute(workspacePath) &&
      samePath(workspacePath, from)
    );
  });

  let updated = 0;
  const warnings: string[] = [];
  for (const session of targets) {
    try {
      await api.updateSessionMeta(session.id, { workspacePath: to });
      updated += 1;
    } catch (e) {
      warnings.push(`${session.id}: ${String(e)}`);
    }
  }
  return { updated, failed: warnings.length, warnings };
}

export async function handleRelocateProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('project:handlers:relocateProject');
  span.setAttribute('projectId', projectId);
  try {
    const body = await readBody(req);
    const raw = JSON.parse(body || '{}') as { sandboxPath?: unknown };
    const requested = raw.sandboxPath;

    // ── 1. 入参校验（写盘前，任一不过即 400）──
    if (typeof requested !== 'string' || !requested.trim()) {
      json(res, 400, { error: 'sandboxPath 不能为空' });
      return;
    }
    const next = resolve(requested.trim());
    if (!isAbsolute(requested.trim())) {
      json(res, 400, { error: 'sandboxPath 必须是绝对路径' });
      return;
    }

    const store = await getProjectStore();
    const existing = store.get(projectId);
    if (!existing) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 404, { error: '项目不存在' });
      return;
    }

    // ── 2. 多租户边界：目标必须落在该身份的工作区根内（本地身份不限制）──
    {
      const { getRequestPrincipal, isLocalPrincipal } =
        await import('@openliri/kernel/identity/requestScope');
      const principal = getRequestPrincipal();
      if (!isLocalPrincipal(principal)) {
        const { resolveScopedWorkspaceRoot, isPathWithin } =
          await import('@openliri/infra/environment');
        const root = resolveScopedWorkspaceRoot(principal);
        if (!isPathWithin(root, next)) {
          span.setStatus({ code: SpanStatusCode.OK });
          json(res, 403, {
            error: `目标目录必须位于当前身份的工作区根内: ${root}`,
          });
          return;
        }
      }
    }

    // ── 3. 旧路径是否仍可用（供界面区分"修复位置"与"更换位置"）──
    const previousPath = existing.sandboxPath ?? '';
    const oldPathValid =
      previousPath !== '' &&
      existsSync(previousPath) &&
      statSync(previousPath).isDirectory();

    // ── 4. 改指向（store 内部再校验一次：存在 / 是目录 / 幂等）──
    let result;
    try {
      result = store.relocate(projectId, next);
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!result) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 404, { error: '项目不存在' });
      return;
    }

    if (result.noop) {
      span.setStatus({ code: SpanStatusCode.OK });
      json(res, 200, {
        success: true,
        noop: true,
        sandboxPath: result.sandboxPath,
        previousPath: result.previousPath,
        oldPathValid,
        sessionsUpdated: 0,
        sessionsFailed: 0,
        warnings: [],
      });
      return;
    }

    // ── 5. 会话跟随（部分失败不回滚元数据，见 §9.6）──
    // 旧路径为空（项目此前没有 sandboxPath）时**没有可跟随的会话**：
    // 空串经 `resolve('')` 会等于 cwd，若不跳过可能误改到恰好指向 cwd 的会话。
    const follow =
      result.previousPath === ''
        ? { updated: 0, failed: 0, warnings: [] as string[] }
        : await followSessionsToRelocatedPath(
            projectId,
            result.previousPath,
            result.sandboxPath
          );

    logger.info('project_relocated', {
      projectId,
      from: result.previousPath,
      to: result.sandboxPath,
      oldPathValid,
      sessionsUpdated: follow.updated,
      sessionsFailed: follow.failed,
    });

    span.setStatus({ code: SpanStatusCode.OK });
    json(res, 200, {
      success: true,
      noop: false,
      sandboxPath: result.sandboxPath,
      previousPath: result.previousPath,
      oldPathValid,
      sessionsUpdated: follow.updated,
      sessionsFailed: follow.failed,
      warnings: follow.warnings,
    });
  } catch (e) {
    await handleError(e, {
      module: 'project:handlers',
      action: 'relocateProject',
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(e) });
    json(res, 500, { error: '重新定位失败' });
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
    const store = await getProjectStore();
    const deleted = store.delete(projectId);
    // 2026-11-03：删项目必须通知进程内订阅者（`alwaysOnEntry` 据此注销该项目的自主执行运行时）。
    // 此前只删实体 ⇒ 运行时继续每 5 分钟 tick 一个已删项目（工作项/报告仍产出）。
    if (deleted) globalEventBus.publish('project:deleted', { projectId });
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
    const fileResult = await (
      await getCoreAPI().getProjectOpsPort()
    ).migrateLegacyFiles();

    // 2. worktree → Project 实体
    let wtResult = { created: 0, skipped: 0 };
    if (worktrees && worktrees.length > 0) {
      wtResult = await (
        await getCoreAPI().getProjectOpsPort()
      ).migrateWorktrees(worktrees);
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
    const result = await (
      await getCoreAPI().getProjectOpsPort()
    ).migrateLegacyFiles();
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
