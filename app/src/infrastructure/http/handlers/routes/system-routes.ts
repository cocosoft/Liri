/**
 * system-routes.ts — dispatchSystemRoutes
 *
 * 系统领域路由（2026-08-14 新增：休眠检测用户决策 API）
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { readBody, json } from '../handler-utils';
import { sleepMonitor } from '@modules/core/sleep/SleepMonitor';
import { APP_VERSION } from '@modules/constants/common';
import { resolveDataDir, resolvePyappHome } from '@modules/core/paths';

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

  // 应用信息（版本 / 数据目录 / 用户目录）
  if (method === 'GET' && url === '/v1/app/info') {
    await handleAppInfo(req, res);
    return true;
  }

  // 休眠检测：用户决策是否继续执行积压的定时任务
  if (method === 'POST' && url === '/v1/system/sleep/resolve') {
    await handleSleepResolve(req, res);
    return true;
  }

  return false;
}

/**
 * GET /v1/app/info — 应用信息（版本号来自 app/package.json，数出同源）
 */
async function handleAppInfo(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  json(res, 200, {
    version: APP_VERSION,
    dataDir: resolveDataDir(),
    pyappHome: resolvePyappHome(),
  });
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
