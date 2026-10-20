/**
 * buddy-routes.ts — 伙伴（Buddy）与后台任务状态（自 `cost-channel-routes.ts` 拆出，2026-10-20）
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  handleBuddyInteract,
  handleGetBackgroundStatus,
  handleGetBuddy,
  handleGetBuddyStats,
  handleGetDreamLogs,
} from '../buddy-handlers';

/** Buddy 只读端点 + 交互端点 + 后台任务状态 */
export async function dispatchBuddyRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url, handlerCtx } = args;

  if (method === 'GET' && url === '/v1/buddy/companion') {
    await handleGetBuddy(handlerCtx, req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/buddy/interact') {
    await handleBuddyInteract(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/buddy/stats') {
    await handleGetBuddyStats(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/buddy/dreams') {
    await handleGetDreamLogs(handlerCtx, req, res);
    return true;
  }
  // 后台任务运行状况（Dream 记忆整理 + Buddy 成长）
  if (method === 'GET' && url === '/v1/background/status') {
    await handleGetBackgroundStatus(handlerCtx, req, res);
    return true;
  }
  return false;
}
