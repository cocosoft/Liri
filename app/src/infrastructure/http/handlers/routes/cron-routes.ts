/**
 * cron-routes.ts — 定时任务（Cron）子派发（自 `cost-channel-routes.ts` 拆出，2026-10-20）
 *
 * ⚠️ 匹配顺序不可调换：`/v1/cron/status` 与 `/v1/cron/runs` 必须**先于** `/v1/cron/(.+)`，
 * 否则会被 `:id` 通配吞掉（拆分前注释同口径）。
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  handleCreateCron,
  handleCronRuns,
  handleCronStatus,
  handleDeleteCron,
  handleGetCron,
  handleListCron,
  handleRunCron,
  handleUpdateCron,
} from '../cron-handlers';

/** Cron 增删改查 + 立即执行 */
export async function dispatchCronRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url, broadcastEvent } = args;

  if (method === 'GET' && url === '/v1/cron') {
    await handleListCron(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/cron') {
    await handleCreateCron(req, res, (event, data) =>
      broadcastEvent(event, data)
    );
    return true;
  }
  // 精确路由必须在正则捕获之前，避免 /status 被 /:id 拦截
  if (method === 'GET' && url === '/v1/cron/status') {
    await handleCronStatus(req, res);
    return true;
  }
  if (method === 'GET' && url.startsWith('/v1/cron/runs')) {
    await handleCronRuns(req, res, url);
    return true;
  }

  const byId = url.match(/^\/v1\/cron\/(.+)$/);
  if (byId) {
    if (method === 'GET') {
      await handleGetCron(req, res, byId[1]);
      return true;
    }
    if (method === 'PUT') {
      await handleUpdateCron(req, res, byId[1], (event, data) =>
        broadcastEvent(event, data)
      );
      return true;
    }
    if (method === 'DELETE') {
      await handleDeleteCron(req, res, byId[1], (event, data) =>
        broadcastEvent(event, data)
      );
      return true;
    }
  }

  const run = url.match(/^\/v1\/cron\/(.+)\/run$/);
  if (method === 'POST' && run) {
    await handleRunCron(req, res, run[1], (event, data) =>
      broadcastEvent(event, data)
    );
    return true;
  }

  return false;
}
