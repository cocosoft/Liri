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
import { getLogger } from '@openliri/infra/monitoring';
import { getOTelTracing } from '@openliri/infra/monitoring/otel/OTelTracing';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@openliri/infra/error';
// C1（2026-09-30 D-104，`tasks` 域 P4）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import {
  inboxManager,
  type InboxItemStatus,
  type InboxItemType,
} from '@openliri/service/runtime/InboxManager';
// 审批解析的**唯一实现**（HTTP / IM 文本审批 / 企业审批流共用）
import {
  resolveInboxApproval,
  resolveInboxApprovalsBatch,
} from '@openliri/service/runtime/inboxApproval';
import { LOCAL_REQUEST_BASE_URL } from '@openliri/kernel';

const logger = getLogger('http:inbox');

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
    const url = new URL(req.url || '/', LOCAL_REQUEST_BASE_URL);
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
    const url = new URL(req.url || '/', LOCAL_REQUEST_BASE_URL);
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
    const url = new URL(req.url || '/', LOCAL_REQUEST_BASE_URL);
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
    const url = new URL(req.url || '/', LOCAL_REQUEST_BASE_URL);
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

    // ── 执行回复（审批解析的唯一实现在 `runtime/inboxApproval`，HTTP 只管传输层）──
    const outcome = await resolveInboxApproval(id, reply, selectedOption);
    if (outcome.kind === 'not_found') {
      otel.endSpan(span, SpanStatusCode.ERROR, 'not_found');
      sendError(res, 'Inbox item not found', 404);
      return;
    }
    // 2026-11-04（P0-1 排查）：以下三种「没生效」的结局**必须显式带 `applied:false`**。
    // 此前只回 HTTP 200 + status，前端只看 `res.ok` ⇒ 弹出「已批准」但后端什么都没做
    //（实测：196 张工作区申请全部过期，用户却以为批过了，目录始终没进 workspaceRoots）。
    // 保留 200 是为了不破坏既有客户端契约（渠道回传/旧前端），语义交由 `applied` 传达。
    if (outcome.kind === 'expired') {
      otel.endSpan(span, SpanStatusCode.OK);
      logger.warn('审批回复未生效：卡已过期', { inboxId: id, reply });
      sendJSON(res, 200, {
        id,
        status: 'expired',
        applied: false,
        message: '该审批已超时，无法处理',
      });
      return;
    }
    if (outcome.kind === 'already_processed') {
      otel.endSpan(span, SpanStatusCode.OK);
      logger.info('审批回复未生效：此前已处理', {
        inboxId: id,
        reply,
        previousReply: outcome.previousReply,
      });
      sendJSON(res, 200, {
        id,
        status: 'already_processed',
        applied: false,
        previousReply: outcome.previousReply,
      });
      return;
    }
    if (outcome.kind === 'concurrent_conflict') {
      otel.endSpan(span, SpanStatusCode.OK);
      logger.warn('审批回复未生效：并发冲突', { inboxId: id, reply });
      sendJSON(res, 200, { id, status: 'concurrent_conflict', applied: false });
      return;
    }
    if (outcome.kind === 'update_failed') {
      otel.endSpan(span, SpanStatusCode.ERROR, 'update_failed');
      sendError(res, 'Failed to update inbox item', 500);
      return;
    }

    const updated = outcome.item;
    span.setAttribute('inbox.id', id);
    span.setAttribute('inbox.reply', reply);

    // 2026-11-10（重复 relay 单据）：渠道回传的**唯一发送点**在
    // `InboxManager.reply()` 内部（覆盖 HTTP / IM 文本审批 / 企业审批流所有入口）。
    // 此前此处又 fire-and-forget 调了一次 ⇒ 一次审批会向渠道发 2 条回执
    // （`verify:p38` 实测 `/ok` 2 次 POST）。删除这一处，避免双轨。

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

/**
 * POST /v1/inbox/approve-all — **批量审批**（P1-1，2026-11-06）
 *
 * body: `{ sessionId, reply?, toolName? }`（`reply` 缺省 `approve`）
 *
 * 一次落地同一会话的全部待审批卡，并**只触发一次**续跑。
 * 真机动机：同一轮多个工具（如 3 个 `mkdir`）各弹一张卡，逐个点批的代价与
 * 中途被打断的风险都高；批量入口把 N 次会话互斥争抢收敛为 1 次。
 */
export async function handleApproveAllInbox(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx
): Promise<void> {
  const otel = getOTelTracing();
  const span = otel.startSpan('inbox.approveAll', {});

  try {
    const bodyStr = await readRequestBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const sessionId = body.sessionId as string | undefined;
    const reply = (body.reply as string | undefined) || 'approve';
    const toolName = body.toolName as string | undefined;
    if (!sessionId) {
      otel.endSpan(span, SpanStatusCode.ERROR, 'no_session');
      sendError(res, 'Missing sessionId', 400);
      return;
    }

    const outcome = await resolveInboxApprovalsBatch({
      sessionId,
      reply,
      toolName,
    });
    span.setAttribute('inbox.session', sessionId);
    span.setAttribute('inbox.resolved', outcome.resolved.length);
    span.setAttribute('inbox.skipped', outcome.skipped.length);
    otel.endSpan(span, SpanStatusCode.OK);
    sendJSON(res, 200, {
      applied: outcome.resolved.length > 0,
      sessionId: outcome.sessionId,
      resolved: outcome.resolved,
      skipped: outcome.skipped,
      resumed: outcome.resumed,
    });
  } catch (e) {
    await handleError(e, {
      module: 'http:inbox',
      action: 'handleApproveAllInbox',
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    sendError(
      res,
      `Inbox approve-all failed: ${e instanceof Error ? e.message : String(e)}`,
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
    const url = new URL(req.url || '/', LOCAL_REQUEST_BASE_URL);
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

    // PDCA 审批卡被撤销 ⇒ 已续跑的任务必须真的停下来。
    //
    // 2026-11-08（真机 `session_mw7g2qf77a0033a2f4` / `pdca_mw7g2qiv`）：原判据是
    // `source==='pdca' && metadata.taskId`，只覆盖**计划审批**卡；**步骤级审批**卡由 LRO 提交，
    // `source='permission'` + `metadata.pdcaTaskId` ⇒ 撤销时既不中止任务，又把卡重置为 pending：
    // 接口回 `success:true`，但批准的命令照常执行完、任务正常 completed，卡随后被终态清理置过期
    // ——用户看到"撤销成功"，实际什么都没撤（假成功）。且旧实现用 `getOrCreate*`，对**已终态**
    // 任务会新建空编排器并 `abort()`，写入 abort 检查点**覆盖已完成的记录**。
    //
    // 现口径（与 `resumePdcaIfApplicable` / `abortPdcaAfterExpiry` 同一套 id 解析）：
    // - 任务已终态/已不在内存 ⇒ 如实回 `success:false / task_finished`，卡保持 replied（保留痕迹）；
    // - 任务活跃 ⇒ 中止；卡**不**重置为 pending（任务已中止，再批准只会得到 409 死卡）。
    const pdcaTaskId =
      item.source === 'pdca'
        ? typeof item.metadata?.taskId === 'string'
          ? item.metadata.taskId
          : undefined
        : typeof item.metadata?.pdcaTaskId === 'string'
          ? item.metadata.pdcaTaskId
          : undefined;
    if (pdcaTaskId) {
      const port = await getCoreAPI().getTaskOpsPort();
      const orch = await port.getPdcaOrchestrator(pdcaTaskId);
      const phase = (orch?.getStatus() as { phase?: string } | undefined)
        ?.phase;
      // 终态集走**端口**（`getPdcaStatusSets`）—— infrastructure 属 service 层，
      // 不能直接 import tasks（app 层）；集合同源 `tasks/phases.ts`。
      const { terminal } = await port.getPdcaStatusSets();
      if (!orch || (phase !== undefined && terminal.has(phase))) {
        sendJSON(res, 200, {
          success: false,
          reason: 'task_finished',
          taskId: pdcaTaskId,
          phase: phase ?? null,
        });
        return;
      }
      await orch.abort();
      logger.info('PDCA orchestrator aborted due to approval undo', {
        inboxId: id,
        taskId: pdcaTaskId,
        phase,
      });
      sendJSON(res, 200, {
        success: true,
        remainingWindow: COOL_OFF_MS - elapsed,
        taskAborted: true,
        taskId: pdcaTaskId,
      });
      return;
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

/**
 * 审批落定后的副作用（放行缓存 / 白名单持久化 / 自动续跑）已移至
 * `runtime/inboxApproval.ts` —— 与 IM 文本审批、企业审批流共用**同一实现**。
 */
