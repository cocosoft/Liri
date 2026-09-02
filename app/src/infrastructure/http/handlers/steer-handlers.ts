/**
 * Steering HTTP 端点 — POST /v1/sessions/:id/steer
 *
 * Phase 3: 在 Agent 运行中注入新消息，不中断当前工具执行。
 */
import type http from 'http';
import { sendError, readRequestBody, type HandlerCtx } from './handler-utils';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('http:steer');

/** Steering 安全过滤器 */
const STEERING_FILTER = {
  maxLength: 2000,
  blockedPatterns: [/system:\s*/i, /<\|im_start\|>/i],
  maxPerSecond: 1,
  maxPerMinute: 5,
};

const rateLog: Map<string, number[]> = new Map();

/**
 * 检查频率限制
 */
function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const timestamps = rateLog.get(sessionId) ?? [];
  // 清理旧记录
  const recent = timestamps.filter((t) => now - t < 60_000);
  rateLog.set(sessionId, recent);

  if (recent.length >= STEERING_FILTER.maxPerMinute) return false;

  const lastSecond = recent.filter((t) => now - t < 1000);
  if (lastSecond.length >= STEERING_FILTER.maxPerSecond) return false;

  recent.push(now);
  return true;
}

function sendJSON(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** POST /v1/sessions/:id/steer */
export async function handleSteerSession(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _ctx: HandlerCtx,
  sessionId: string
): Promise<void> {
  try {
    if (!checkRateLimit(sessionId)) {
      sendJSON(res, 429, {
        error: 'Rate limit exceeded',
        maxPerSecond: STEERING_FILTER.maxPerSecond,
        maxPerMinute: STEERING_FILTER.maxPerMinute,
      });
      return;
    }

    const bodyStr = await readRequestBody(req);
    const body = bodyStr ? JSON.parse(bodyStr) : {};
    const rawMessage = (body.message as string) ?? '';

    if (!rawMessage || rawMessage.trim().length === 0) {
      sendJSON(res, 400, { error: 'Missing message' });
      return;
    }

    if (rawMessage.length > STEERING_FILTER.maxLength) {
      sendJSON(res, 400, {
        error: `Message too long (max ${STEERING_FILTER.maxLength} chars)`,
      });
      return;
    }

    // 安全过滤
    for (const pattern of STEERING_FILTER.blockedPatterns) {
      if (pattern.test(rawMessage)) {
        sendJSON(res, 400, {
          error: 'Message contains blocked content',
          pattern: pattern.source,
        });
        return;
      }
    }

    // 注入 steering 消息到 TAORLoop
    // 2026-09-01 修复（T3.3 遗留）：createChatManager() 创建的是新实例（无运行中
    // TAORLoop），必须通过 getCoreAPI().getChatManager() 获取运行中的单例；
    // TAORLoop 按 sessionId 存于 _taorLoops Map（P0 修复 2026-08-14 按会话隔离）。
    try {
      const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl');
      const chatManager = getCoreAPI().getChatManager();
      const cm = chatManager as unknown as Record<string, unknown>;
      const taorLoops = cm['_taorLoops'] as
        | Map<string, { injectSteering(msg: string): void }>
        | undefined;
      const taorLoop = taorLoops?.get(sessionId);
      if (taorLoop?.injectSteering) {
        taorLoop.injectSteering(rawMessage);
        logger.info('Steering message injected', {
          sessionId,
          length: rawMessage.length,
        });
        sendJSON(res, 200, { queued: true, sessionId });
      } else {
        sendJSON(res, 503, {
          error: 'TAORLoop not available for this session',
        });
      }
    } catch (loopErr) {
      logger.warn('Failed to inject steering message', {
        sessionId,
        error: String(loopErr),
      });
      sendJSON(res, 503, {
        error: 'TAORLoop not available',
        detail: String(loopErr),
      });
    }
  } catch (e) {
    sendError(
      res,
      `Steer failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
}
