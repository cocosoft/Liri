/**
 * Notification HTTP 端点 — /v1/notifications
 *
 * GET  /v1/notifications              — 列表
 * POST /v1/notifications              — 创建通知
 * GET  /v1/notifications/unread-count  — 各分类未读数
 * GET  /v1/notifications/search        — 搜索
 * PATCH /v1/notifications/:id/read     — 标记已读
 * PATCH /v1/notifications/read-all     — 全部已读
 * PATCH /v1/notifications/:id/dismiss  — 归档
 * PATCH /v1/notifications/batch        — 批量操作
 * DELETE /v1/notifications/:id         — 删除
 * POST /v1/notifications/:id/action    — 执行操作
 */

import type http from 'http';
import { sendError, readRequestBody, type HandlerCtx } from './handler-utils';
import { handleError } from '@modules/error';
import { notificationPersistence } from '@modules/runtime/NotificationPersistence.js';
import type {
  NotificationCategory,
  NotificationStatus,
  NotificationPriority,
} from '@modules/runtime/NotificationPersistence.js';

function sendJSON(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseURL(req: http.IncomingMessage): URL {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `http://${host}`);
}

/** 从 URL 路径 /v1/notifications/:id[/suffix] 中提取通知 ID */
function extractNotificationId(req: http.IncomingMessage): string {
  const url = parseURL(req);
  const segments = url.pathname.split('/');
  // path: /v1/notifications/:id[/suffix]
  return segments[3] || '';
}

// ─── 列表 ───────────────────────────────────────────

/** GET /v1/notifications */
export async function handleListNotifications(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const url = parseURL(req);
    const category = url.searchParams.get(
      'category'
    ) as NotificationCategory | null;
    const status = url.searchParams.get('status') as NotificationStatus | null;
    const priority = url.searchParams.get(
      'priority'
    ) as NotificationPriority | null;
    const cursor = url.searchParams.get('cursor');
    const limit = url.searchParams.get('limit');

    const result = await notificationPersistence().list({
      category: category || undefined,
      status: status || undefined,
      priority: priority || undefined,
      cursor: cursor ? parseInt(cursor) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });

    sendJSON(res, 200, result);
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'list' });
    sendError(res, '获取通知列表失败', 500);
  }
}

// ─── 未读计数 ───────────────────────────────────────

/** GET /v1/notifications/unread-count */
export async function handleUnreadCount(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const count = await notificationPersistence().getUnreadCount();
    sendJSON(res, 200, count);
  } catch (e) {
    await handleError(e, {
      module: 'http:notification',
      action: 'unreadCount',
    });
    sendError(res, '获取未读数失败', 500);
  }
}

// ─── 搜索 ───────────────────────────────────────────

/** GET /v1/notifications/search */
export async function handleSearchNotifications(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const url = parseURL(req);
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) {
      sendJSON(res, 200, { items: [] });
      return;
    }

    const items = await notificationPersistence().search(q);
    sendJSON(res, 200, { items });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'search' });
    sendError(res, '搜索失败', 500);
  }
}

// ─── 标记已读 ───────────────────────────────────────

/** PATCH /v1/notifications/:id/read */
export async function handleMarkRead(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const id = extractNotificationId(req);
    if (!id) {
      sendError(res, '缺少 id', 400);
      return;
    }
    const changed = await notificationPersistence().markRead(id);
    sendJSON(res, 200, { success: changed });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'markRead' });
    sendError(res, '标记已读失败', 500);
  }
}

// ─── 全部已读 ──────────────────────────────────────

/** PATCH /v1/notifications/read-all */
export async function handleReadAll(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const url = parseURL(req);
    const category = url.searchParams.get(
      'category'
    ) as NotificationCategory | null;
    const limit = parseInt(url.searchParams.get('limit') || '500');
    const count = await notificationPersistence().markReadAll(
      category || undefined,
      'default',
      limit
    );
    sendJSON(res, 200, { updatedCount: count });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'readAll' });
    sendError(res, '全部已读失败', 500);
  }
}

// ─── 归档 ───────────────────────────────────────────

/** PATCH /v1/notifications/:id/dismiss */
export async function handleDismiss(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const id = extractNotificationId(req);
    if (!id) {
      sendError(res, '缺少 id', 400);
      return;
    }
    const changed = await notificationPersistence().dismiss(id);
    sendJSON(res, 200, { success: changed });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'dismiss' });
    sendError(res, '归档失败', 500);
  }
}

// ─── 批量操作 ──────────────────────────────────────

/** PATCH /v1/notifications/batch */
export async function handleBatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { ids, status } = JSON.parse(body);
    if (!Array.isArray(ids) || ids.length === 0) {
      sendError(res, '缺少 ids', 400);
      return;
    }
    if (status !== 'read' && status !== 'dismissed') {
      sendError(res, 'status 必须为 read 或 dismissed', 400);
      return;
    }
    const count = await notificationPersistence().batchUpdate(ids, status);
    sendJSON(res, 200, { updatedCount: count });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'batch' });
    sendError(res, '批量操作失败', 500);
  }
}

// ─── 删除 ───────────────────────────────────────────

/** DELETE /v1/notifications/:id */
export async function handleDeleteNotification(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const id = extractNotificationId(req);
    if (!id) {
      sendError(res, '缺少 id', 400);
      return;
    }
    const changed = await notificationPersistence().delete(id);
    sendJSON(res, 200, { success: changed });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'delete' });
    sendError(res, '删除失败', 500);
  }
}

// ─── 执行操作 ──────────────────────────────────────

/** POST /v1/notifications/:id/action */
export async function handleNotificationAction(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const id = extractNotificationId(req);
    if (!id) {
      sendError(res, '缺少 id', 400);
      return;
    }
    const body = await readRequestBody(req);
    const { action, action_token } = JSON.parse(body);

    if (!action) {
      sendError(res, '缺少 action', 400);
      return;
    }

    const result = await notificationPersistence().performAction(
      id,
      action,
      action_token
    );
    if (!result.success) {
      sendJSON(res, 409, {
        error: result.error,
        current_status: result.status,
      });
      return;
    }
    sendJSON(res, 200, { success: true, status: result.status });
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'action' });
    sendError(res, '操作失败', 500);
  }
}

// ─── 创建 ───────────────────────────────────────────

/** POST /v1/notifications — 创建通知 */
export async function handleCreateNotification(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const {
      category,
      priority,
      title,
      content,
      source,
      source_ref,
      link_to,
      expires_at,
    } = JSON.parse(body);

    if (!category || !title) {
      sendError(res, '缺少 category 或 title', 400);
      return;
    }

    const item = await notificationPersistence().create({
      category,
      priority: priority || 'normal',
      title,
      content: content || '',
      source: source || '',
      source_ref: source_ref || '',
      link_to: link_to || null,
      expires_at: expires_at || null,
    });

    sendJSON(res, 201, item);
  } catch (e) {
    await handleError(e, { module: 'http:notification', action: 'create' });
    sendError(res, '创建通知失败', 500);
  }
}
