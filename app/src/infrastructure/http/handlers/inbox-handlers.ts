/**
 * Inbox HTTP 端点 — /v1/inbox
 *
 * @deprecated 已迁移至通知中心（/v1/notifications/*）。审批/提问交互请使用 notification-handlers。
 * 此模块保留仅供向后兼容，请勿新增调用。
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
import { getApprovedCommandRegistry } from '@modules/permission/ApprovedCommandRegistry';

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

    // ── 幂等保护 #1: 状态检查 ──
    const current = await inboxManager.get(id);
    if (!current) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'not_found');
      sendError(res, 'Inbox item not found', 404);
      return;
    }
    if (current.status !== 'pending') {
      span.setAttribute('inbox.id', id);
      span.setAttribute('inbox.status', current.status);
      otel.endSpan(span, SpanStatusCode.OK);

      // 区分过期和其他已处理状态
      if (current.status === 'expired') {
        sendJSON(res, 200, {
          id,
          status: 'expired',
          message: '该审批已超时，无法处理',
        });
      } else {
        sendJSON(res, 200, {
          id,
          status: 'already_processed',
          previousReply: current.reply,
        });
      }
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

    // ── 幂等保护 #2: CAS 原子操作 ──
    const locked = await inboxManager.tryUpdateStatus(
      id,
      'pending',
      'processing'
    );
    if (!locked) {
      span.setAttribute('inbox.id', id);
      otel.endSpan(span, SpanStatusCode.OK);
      sendJSON(res, 200, { id, status: 'concurrent_conflict' });
      return;
    }

    // ── 执行回复 ──
    const updated = await inboxManager.reply(id, reply, selectedOption);
    if (!updated) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'update_failed');
      sendError(res, 'Failed to update inbox item', 500);
      return;
    }

    span.setAttribute('inbox.id', id);
    span.setAttribute('inbox.reply', reply);

    // ── PDCA 审批恢复：检测 source === 'pdca' 的审批回复 ──
    if (current.source === 'pdca' && current.metadata) {
      const taskId = current.metadata.taskId as string | undefined;
      const sessionId = current.sessionId;
      if (taskId && sessionId) {
        try {
          const { getOrCreateOrchestrator } =
            await import('@modules/tasks/LongRunningTaskOrchestrator.js');
          const orchestrator = getOrCreateOrchestrator(taskId);
          if (orchestrator) {
            if (reply === 'approve' || selectedOption === 'approve') {
              const result = await orchestrator.resumeAfterApproval(sessionId);
              logger.info('PDCA resumed after Inbox approval', {
                inboxId: id,
                taskId,
                phase: result.phase,
              });
              span.setAttribute('pdca.resumed', true);
              span.setAttribute('pdca.phase', result.phase);
            } else {
              logger.info('PDCA plan rejected via Inbox', {
                inboxId: id,
                taskId,
              });
              span.setAttribute('pdca.rejected', true);
            }
          }
        } catch (pdcaErr) {
          // PDCA 恢复失败不阻塞 Inbox 回复
          logger.warn('PDCA resume after Inbox approval failed', {
            inboxId: id,
            taskId,
            error: String(pdcaErr),
          });
        }
      }
    }

    // ── 工具审批放行：permission source + approve → 写入已批准命令放行缓存（P0-3）──
    // ChatManager 提交审批时在 metadata 记录 commandHash；批准后 BashTool 执行前
    // 命中缓存（session 隔离 + 60s TTL）跳过安全拦截层，AI 重发同一命令即可放行。
    if (
      current.type === 'approval' &&
      current.source === 'permission' &&
      (reply === 'approve' || selectedOption === 'approve')
    ) {
      const commandHash = current.metadata?.commandHash as string | undefined;
      // P0-3: 携带批准命令原文（提取命令名供命令名级放行）
      const command = current.metadata?.command as string | undefined;
      if (commandHash && current.sessionId) {
        getApprovedCommandRegistry().approve(
          current.sessionId,
          commandHash,
          command
        );
        logger.info('工具审批已批准，写入命令放行缓存', {
          sessionId: current.sessionId,
          commandHash,
          hasCommand: !!command,
        });
      }
    }

    // ── 渠道回传：异步执行，不阻塞 API 响应 ──
    if (updated.channelSessionId) {
      const { relayReplyToChannel } =
        await import('@modules/channels/bridge/inboxChannelReply.js');
      // fire-and-forget: 先返回 API 响应给 InboxPanel，后台异步回传渠道
      relayReplyToChannel(updated).catch((bridgeErr: unknown) => {
        logger.warn('Inbox reply relay to channel failed (async)', {
          inboxId: id,
          channelSessionId: updated.channelSessionId,
          error: String(bridgeErr),
        });
      });
    }

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

/** POST /v1/inbox/:id/undo — 撤销审批（冷却窗口内可操作） */
export async function handleUndoApproval(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  const COOL_OFF_MS = 30_000; // 30 秒冷却窗口

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const segments = url.pathname.split('/');
    const undoIdx = segments.indexOf('undo');
    const id = undoIdx > 0 ? segments[undoIdx - 1] : '';

    if (!id) {
      sendError(res, 'Missing inbox item id', 400);
      return;
    }

    const item = await inboxManager.get(id);
    if (!item) {
      sendError(res, 'Inbox item not found', 404);
      return;
    }

    if (item.status !== 'replied' || !item.repliedAt) {
      sendJSON(res, 200, { success: false, reason: 'not_replied' });
      return;
    }

    const elapsed = Date.now() - item.repliedAt;
    if (elapsed > COOL_OFF_MS) {
      sendJSON(res, 200, {
        success: false,
        reason: 'cool_off_expired',
        elapsed,
        limitMs: COOL_OFF_MS,
      });
      return;
    }

    // 如果 PDCA 审批已被触发恢复，尝试暂停
    if (item.source === 'pdca' && item.metadata?.taskId) {
      try {
        const { getOrCreateOrchestrator } =
          await import('@modules/tasks/LongRunningTaskOrchestrator.js');
        const orch = getOrCreateOrchestrator(item.metadata.taskId as string);
        if (orch) {
          await orch.abort();
          logger.info('PDCA orchestrator aborted due to approval undo', {
            inboxId: id,
            taskId: item.metadata.taskId,
          });
        }
      } catch {
        // 暂停失败不阻塞撤销
      }
    }

    await inboxManager.resetStatus(id, 'pending');
    logger.info('Approval undone', {
      inboxId: id,
      elapsed,
      remainingWindow: COOL_OFF_MS - elapsed,
    });

    sendJSON(res, 200, {
      success: true,
      remainingWindow: COOL_OFF_MS - elapsed,
    });
  } catch (e) {
    await handleError(e, {
      module: 'http:inbox',
      action: 'handleUndoApproval',
    });
    sendError(
      res,
      `Undo approval failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}
