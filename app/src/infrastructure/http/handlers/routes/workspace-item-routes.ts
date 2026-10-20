/**
 * workspace-item-routes.ts — 工作空间条目检索 / 评审（自 `cost-channel-routes.ts` 拆出，2026-10-20）
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  handleSearchWorkItems,
  handleWorkItemReview,
} from '../workitem-search-handlers';

/** 工作空间条目：POST /items/search、GET /items/review */
export async function dispatchWorkspaceItemRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url, handlerCtx } = args;

  const search = url.match(/^\/v1\/workspaces\/(.+)\/items\/search$/);
  if (method === 'POST' && search) {
    await handleSearchWorkItems(handlerCtx, req, res, search[1]);
    return true;
  }

  const review = url.match(/^\/v1\/workspaces\/(.+)\/items\/review$/);
  if (method === 'GET' && review) {
    await handleWorkItemReview(handlerCtx, req, res, review[1]);
    return true;
  }

  return false;
}
