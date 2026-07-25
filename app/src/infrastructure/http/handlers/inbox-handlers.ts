/**
 * Inbox HTTP 端点 — /v1/inbox
 *
 * GET  /v1/inbox           — 列出 Inbox 项
 * GET  /v1/inbox/:id        — 获取单个 Inbox 项
 * POST /v1/inbox/:id/reply  — 回复 Inbox 项
 * GET  /v1/inbox/count       — 获取待处理数量
 */

import type http from 'http';
import { sendError, readRequestBody, type HandlerCtx } from './handler-utils';
import { Logger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import {
  inboxManager,
  type InboxItemStatus,
  type InboxItemType,
} from '@modules/runtime/InboxManager.js';

const logger = new Logger({ module: 'http:inbox' });

function sendJSON(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** GET /v1/inbox — 列出 Inbox 项 */
export async function handleListInbox(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.list', {});

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') || undefined;
    const status = url.searchParams.get('status') as
      | InboxItemStatus
      | undefined;
    const type = url.searchParams.get('type') as InboxItemType | undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const result = await inboxManager.list({
      sessionId,
      status,
      type,
      limit,
      offset,
    });

    span.setAttribute('inbox.total', result.total);
    otel.endSpan(span, SpanStatusCode.OK);
    sendJSON(res, 200, result);
  } catch (e) {
    await handleError(e, { module: 'http:inbox', action: 'handleListInbox' });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    sendError(
      res,
      `Inbox list failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}

/** GET /v1/inbox/count — 获取待处理数量 */
export async function handleInboxCount(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.count', {});

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') || undefined;

    const count = await inboxManager.getPendingCount(sessionId);

    span.setAttribute('inbox.pending', count);
    otel.endSpan(span, SpanStatusCode.OK);
    sendJSON(res, 200, { count });
  } catch (e) {
    await handleError(e, { module: 'http:inbox', action: 'handleInboxCount' });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    sendError(
      res,
      `Inbox count failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}

/** GET /v1/inbox/:id — 获取单个 Inbox 项 */
export async function handleGetInbox(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.get', {});

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const segments = url.pathname.split('/');
    const id = segments[segments.length - 1];

    if (!id || id === 'inbox') {
      otel.endSpan(span, SpanStatusCode.ERROR, 'no_id');
      sendError(res, 'Missing inbox item id', 400);
      return;
    }

    const item = await inboxManager.get(id);
    if (!item) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'not_found');
      sendError(res, 'Inbox item not found', 404);
      return;
    }

    span.setAttribute('inbox.id', id);
    otel.endSpan(span, SpanStatusCode.OK);
    sendJSON(res, 200, item);
  } catch (e) {
    await handleError(e, { module: 'http:inbox', action: 'handleGetInbox' });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    sendError(
      res,
      `Inbox get failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}

/** POST /v1/inbox/:id/reply — 回复 Inbox 项 */
export async function handleReplyInbox(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.reply', {});

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const segments = url.pathname.split('/');
    // Path: /v1/inbox/:id/reply
    const replyIdx = segments.indexOf('reply');
    const id = replyIdx > 0 ? segments[replyIdx - 1] : '';

    if (!id) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'no_id');
      sendError(res, 'Missing inbox item id', 400);
      return;
    }

    const bodyStr = await readRequestBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const reply = body.reply as string | undefined;
    const selectedOption = body.selectedOption as string | undefined;

    if (!reply) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'no_reply');
      sendError(res, 'Missing reply text', 400);
      return;
    }

    const updated = await inboxManager.reply(id, reply, selectedOption);
    if (!updated) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'not_found');
      sendError(res, 'Inbox item not found or already replied', 404);
      return;
    }

    span.setAttribute('inbox.id', id);
    otel.endSpan(span, SpanStatusCode.OK);
    sendJSON(res, 200, updated);
  } catch (e) {
    await handleError(e, { module: 'http:inbox', action: 'handleReplyInbox' });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    sendError(
      res,
      `Inbox reply failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}
