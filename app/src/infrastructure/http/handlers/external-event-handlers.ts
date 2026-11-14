/**
 * 外部事件入站端点（D1，2026-11-14）
 *
 * `POST /v1/events/external`
 * - 头：`X-Liri-Signature: sha256=<hex>`（HMAC-SHA256(secret, rawBody)）
 *       `X-Liri-Event-Id: <幂等键>`（必填）
 *       `X-Liri-Thread-Id: <串行域>`（可选；缺省 = eventId）
 * - 鉴权：**两层** —— 传输层共享密钥/Bearer（`LocalHTTPService` 既有两道门）
 *   + 本端点的 HMAC 签名（`LIRI_EXTERNAL_EVENT_SECRET`，未配置 ⇒ 503 fail-closed）。
 * - 默认关：流水线未启用 ⇒ 受理端口为空 ⇒ 503（`EXTERNAL_EVENTS_DISABLED`）。
 *
 * 状态码映射唯一来源 = `REJECT_STATUS`（service 层），本 handler 不重复判断。
 */
import type http from 'http';
import { getLogger } from '@openliri/infra/monitoring';
import {
  getExternalEventIntake,
  REJECT_STATUS,
} from '@openliri/service/runtime/externalEventIntake';
import { readBody } from './handler-utils';

const logger = getLogger('infra:http:external-events');

export const EXTERNAL_EVENT_PATH = '/v1/events/external';

/** 响应体（与 api-spec 对齐：成功只回回执，不回内部 id） */
function writeJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function handleExternalEventInbound(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const intake = getExternalEventIntake();
  if (!intake) {
    // 默认关：未启用流水线（或未配置密钥）时端点不承担任何语义
    writeJson(res, 503, {
      error: {
        code: 'EXTERNAL_EVENTS_DISABLED',
        message:
          'external events are disabled (enable autonomy.policy.sources.external)',
      },
    });
    return;
  }

  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0];
    return undefined;
  };

  try {
    const rawBody = await readBody(req);
    const result = await intake.handle({
      sourceId: 'external',
      rawBody,
      signature: header('x-liri-signature'),
      eventId: header('x-liri-event-id'),
      threadId: header('x-liri-thread-id'),
    });

    if (!result.ok) {
      const status = REJECT_STATUS[result.reason];
      logger.warn('外部事件被拒绝', {
        reason: result.reason,
        status,
        eventId: header('x-liri-event-id') ?? '',
      });
      writeJson(res, status, {
        error: { code: `EXTERNAL_EVENT_${result.reason}`.toUpperCase() },
      });
      return;
    }

    logger.info('外部事件已受理', {
      eventId: result.eventId,
      threadId: result.threadId ?? result.eventId,
    });
    writeJson(res, 202, { success: true, eventId: result.eventId });
  } catch (err) {
    logger.warn('外部事件受理异常', { error: String(err) });
    writeJson(res, 500, {
      error: { code: 'EXTERNAL_EVENT_INTERNAL_ERROR' },
    });
  }
}
