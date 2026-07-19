/**
 * MediaHandlers — Phase 2 媒体 API
 *
 * 端点：
 *   GET /v1/media/templates    — 模板预设列表
 *
 * 注意：统一媒体列表 (/v1/media) 由前端分别调 /v1/images/list + /v1/videos/list 合并，
 *       无需后端单独端点，减少复杂度。
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { getMediaTemplates } from '@modules/tools/VideoGenerateTool/MediaTemplates';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure\http\handlers\media-template-handlers',
  level: LogLevel.INFO,
});

/** 发送 JSON 响应 */
function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/**
 * GET /v1/media/templates
 * 返回所有启用的模板预设（对标 Grok 模板轮播）
 */
async function handleMediaTemplates(
  _ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const tm = getMediaTemplates();
    const templates = tm.list();

    json(res, 200, {
      templates: templates.map((t) => ({
        id: t.templateId,
        name: t.name,
        type: t.type,
        category: t.category,
        thumbnailUrl: t.thumbnailUrl || null,
        promptTemplate: t.promptTemplate || null,
        requiresImage: t.requiresImage,
        sortOrder: t.sortOrder,
      })),
    });
  } catch (e) {
    await handleError(e, { module: 'api:media', action: 'templates' });
    json(res, 500, { error: String(e) });
  }
}

/**
 * Media API 路由分发
 */
export async function handleMedia(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = req.url || '/';
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url === '/v1/media/templates' && method === 'GET') {
    return handleMediaTemplates(ctx, req, res);
  }

  json(res, 404, { error: 'Not found' });
}
