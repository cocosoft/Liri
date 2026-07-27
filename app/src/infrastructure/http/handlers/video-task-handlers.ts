/**
 * VideoTaskAPI
 * 视频异步任务 HTTP API
 *
 * Phase 1 — 图像与视频联动
 *
 * 端点：
 *   POST /v1/video/tasks       — 创建异步视频生成任务
 *   GET  /v1/video/tasks/:id    — 查询单个任务状态
 *   GET  /v1/video/tasks        — 查询任务列表（支持 ?status=active 过滤）
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { getVideoTaskPersistence } from '@modules/tools/VideoGenerateTool/VideoTaskPersistence';
import type { ToolUseContext } from '@modules/tools/types/Tool';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure\http\handlers\video-task-handlers',
  level: LogLevel.INFO,
});

/** 从 URL 路径中提取 taskId（/v1/video/tasks/{id}） */
function extractTaskId(url: string): string | null {
  const match = url.match(/^\/v1\/video\/tasks\/([^/?]+)/);
  return match ? match[1] : null;
}

/** 解析 JSON body */
async function parseBody(
  req: http.IncomingMessage
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/**
 * POST /v1/video/tasks
 * 创建异步视频生成任务
 *
 * Body: { mode, prompt, imageUrl?, imagePath?, duration?, aspectRatio?, modelId? }
 * → 202 { taskId, status: 'pending', createdAt }
 */
async function handleCreateTask(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseBody(req);
    const { prompt, imageUrl, imagePath, duration, aspectRatio, modelId } =
      body;

    // 图生视频：有图片时 prompt 可选；文生视频：必须输入 prompt
    if (!prompt && !imageUrl && !imagePath) {
      json(res, 400, {
        error:
          'prompt is required (or provide imageUrl/imagePath for image-to-video)',
      });
      return;
    }

    // 通过 VideoGenerateTool.execute() 异步模式创建任务
    const { createVideoGenerateTool } =
      await import('@modules/tools/VideoGenerateTool/VideoGenerateTool');

    const tool = createVideoGenerateTool();
    const result = await tool.execute(
      {
        prompt,
        imageUrl: imageUrl || undefined,
        imagePath: imagePath || undefined,
        duration: duration || 5,
        aspectRatio: aspectRatio || '16:9',
        model: modelId || undefined,
        async: true,
      },
      {} as unknown as ToolUseContext
    );

    // taskId 在 result.data 中
    const taskData = (result.data ?? {}) as Record<string, unknown>;
    const taskId = taskData.taskId as string;

    // 补充写入 mode / sourceImageUrl
    if (taskId) {
      const persistence = getVideoTaskPersistence();
      persistence.update(taskId, {
        mode: !!imageUrl || !!imagePath ? 'image-to-video' : 'text-to-video',
        sourceImageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
      });
    }

    json(res, 202, {
      taskId: taskId || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    await handleError(e, { module: 'api:videoTasks', action: 'createTask' });
    json(res, 500, { error: String(e) });
  }
}

/**
 * GET /v1/video/tasks/:id
 * 查询单个任务状态
 *
 * → 200 { taskId, status, progress, sourceImageUrl, resultVideoUrl, error, createdAt, ... }
 */
async function handleGetTask(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const taskId = extractTaskId(req.url || '');
    if (!taskId) {
      json(res, 400, { error: 'taskId is required in path' });
      return;
    }

    const persistence = getVideoTaskPersistence();
    const task = persistence.get(taskId);

    if (!task) {
      json(res, 404, { error: 'Task not found' });
      return;
    }

    json(res, 200, {
      taskId: task.id,
      status: task.status,
      mode: task.mode,
      progress: task.progress,
      sourceImageUrl: task.sourceImageUrl || null,
      resultVideoUrl: task.resultVideoUrl || null,
      prompt: task.prompt,
      error: task.error || null,
      model: task.model || null,
      createdAt: new Date(task.createdAt).toISOString(),
      completedAt: task.completedAt
        ? new Date(task.completedAt).toISOString()
        : null,
      queuedAt: task.queuedAt ? new Date(task.queuedAt).toISOString() : null,
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
    });
  } catch (e) {
    await handleError(e, { module: 'api:videoTasks', action: 'getTask' });
    json(res, 500, { error: String(e) });
  }
}

/**
 * GET /v1/video/tasks
 * 查询任务列表
 *
 * Query: ?status=active|all&limit=20&offset=0
 * status=active → pending + queued + running
 * status=all → 所有状态
 *
 * → 200 { tasks: [...], total, hasMore }
 */
async function handleListTasks(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const statusFilter = url.searchParams.get('status') || 'all';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const persistence = getVideoTaskPersistence();

    // 查询活跃任务前，先清理超过 30 分钟的过期任务
    if (statusFilter === 'active') {
      persistence.cleanupStaleTasks();
    }

    let tasks;
    if (statusFilter === 'active') {
      tasks = persistence.listByStatus(
        ['pending', 'queued', 'running'],
        limit + offset
      );
    } else {
      tasks = persistence.list(limit + offset);
    }

    const total = tasks.length;
    const paged = tasks.slice(offset, offset + limit);

    json(res, 200, {
      tasks: paged.map((t) => ({
        taskId: t.id,
        status: t.status,
        mode: t.mode,
        progress: t.progress,
        sourceImageUrl: t.sourceImageUrl || null,
        resultVideoUrl: t.resultVideoUrl || null,
        prompt: t.prompt,
        error: t.error || null,
        model: t.model || null,
        createdAt: new Date(t.createdAt).toISOString(),
        completedAt: t.completedAt
          ? new Date(t.completedAt).toISOString()
          : null,
      })),
      total,
      hasMore: offset + limit < total,
    });
  } catch (e) {
    await handleError(e, { module: 'api:videoTasks', action: 'listTasks' });
    json(res, 500, { error: String(e) });
  }
}

/**
 * Video Task API 路由分发
 */
export async function handleVideoTasks(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = (req.url || '/').split('?')[0];
  const method = (req.method || 'GET').toUpperCase();

  // OPTIONS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // GET /v1/video/tasks/:id
  const taskId = extractTaskId(url);
  if (taskId && method === 'GET') {
    return handleGetTask(ctx, req, res);
  }

  // POST /v1/video/tasks
  if (url === '/v1/video/tasks' && method === 'POST') {
    return handleCreateTask(ctx, req, res);
  }

  // GET /v1/video/tasks
  if (url === '/v1/video/tasks' && method === 'GET') {
    return handleListTasks(ctx, req, res);
  }

  json(res, 404, { error: 'Not found' });
}
