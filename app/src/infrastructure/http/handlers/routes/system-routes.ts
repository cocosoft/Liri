/**
 * system-routes.ts — dispatchSystemRoutes
 *
 * 系统领域路由（2026-08-14 新增：休眠检测用户决策 API）
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { readBody, json } from '../handler-utils';
import { sleepMonitor } from '@modules/core';
import { APP_VERSION } from '@modules/constants/common';
import { resolveDataDir, resolvePyappHome } from '@modules/core/paths';
import {
  engageEstop,
  disengageEstop,
  isEstopEngaged,
  getEstopState,
} from '@modules/core/estop/estop.js';

/**
 * dispatchSystemRoutes — 系统领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchSystemRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
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

  // P3-4（2026-09-02）：全局急停（ESTOP）——状态查询 / 启用 / 解除
  if (method === 'GET' && url === '/v1/system/estop') {
    await handleGetEstop(res);
    return true;
  }
  if (method === 'POST' && url === '/v1/system/estop') {
    await handleEngageEstop(req, res, broadcastEvent);
    return true;
  }
  if (method === 'DELETE' && url === '/v1/system/estop') {
    await handleDisengageEstop(res, broadcastEvent);
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

/**
 * GET /v1/system/estop — 全局急停状态
 * 响应: { engaged: boolean, state: { reason?, engagedAt? } | null }
 */
async function handleGetEstop(res: http.ServerResponse): Promise<void> {
  json(res, 200, { engaged: isEstopEngaged(), state: getEstopState() });
}

/** ESTOP 状态变更 SSE 事件名（前端 useNotificationSSE 订阅） */
export const ESTOP_SSE_EVENT = 'system:estop_changed';

/**
 * POST /v1/system/estop — 启用全局急停（暂停新工作，不杀进行中的）
 * body: { reason?: string }
 */
async function handleEngageEstop(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as { reason?: unknown }) : {};
    const reason =
      typeof body?.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : undefined;
    engageEstop(reason);
    const state = getEstopState();
    broadcastEvent(ESTOP_SSE_EVENT, { engaged: true, state });
    json(res, 200, { engaged: true, state });
  } catch (err) {
    json(res, 400, {
      error: {
        message: `无效的请求体: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
  }
}

/**
 * DELETE /v1/system/estop — 解除全局急停
 */
async function handleDisengageEstop(
  res: http.ServerResponse,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<void> {
  disengageEstop();
  broadcastEvent(ESTOP_SSE_EVENT, { engaged: false, state: null });
  json(res, 200, { engaged: false, state: null });
}
