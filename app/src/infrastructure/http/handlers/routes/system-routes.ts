/**
 * system-routes.ts — dispatchSystemRoutes
 *
 * 系统领域路由（2026-08-14 新增：休眠检测用户决策 API）
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { readBody, json } from '../handler-utils';
import { sleepMonitor } from '@modules/core/sleep/SleepMonitor';

/**
 * dispatchSystemRoutes — 系统领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchSystemRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  // 休眠检测：用户决策是否继续执行积压的定时任务
  if (method === 'POST' && url === '/v1/system/sleep/resolve') {
    await handleSleepResolve(req, res);
    return true;
  }

  return false;
}

/**
 * POST /v1/system/sleep/resolve — 用户对休眠恢复的决策
 * body: { runMissed: boolean } — true 补跑积压任务；false 跳过积压任务
 */
async function handleSleepResolve(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as { runMissed?: boolean }) : {};
    const runMissed = body?.runMissed === true;
    sleepMonitor.resolve(runMissed);
    json(res, 200, { ok: true, runMissed });
  } catch (err) {
    json(res, 400, {
      error: {
        message: `无效的请求体: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
}
