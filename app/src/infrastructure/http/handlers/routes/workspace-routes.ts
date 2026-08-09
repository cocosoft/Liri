// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * workspace-routes.ts — dispatchWorkspaceRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleAddFileChange,
  handleCreateChangeSet,
  handleCreateTask,
  handleCreateWorkItem,
  handleCreateWorkspaceSession,
  handleDeleteTask,
  handleDetectLiriDir,
  handleGetChangeSet,
  handleGetChangeSetSummary,
  handleGetTask,
  handleGetWorkspaceConfig,
  handleGetWorkspaceRules,
  handleInitLiriDir,
  handleListChangeSets,
  handleListTaskChildren,
  handleListWorkItems,
  handleListWorkspaceSessions,
  handleListWorkspaces,
  handleUpdateChangeSet,
  handleUpdateTask,
  handleUpdateWorkItem,
  handleUpdateWorkspaceConfig,
  handleUpdateWorkspaceRules,
} from '../workspaces-handlers';
import { handleListTasks } from '../task-handlers';

/**
 * dispatchWorkspaceRoutes — workspace-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchWorkspaceRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Workspaces ----
  if (method === 'GET' && url === '/v1/workspaces') {
    await handleListWorkspaces(handlerCtx, req, res);
    return true;
  }

  // ---- Workspace Sessions ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)![1];
    await handleListWorkspaceSessions(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/sessions$/)![1];
    await handleCreateWorkspaceSession(handlerCtx, req, res, workspaceId);
    return true;
  }

  // ---- Work Items ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/items$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/items$/)![1];
    await handleListWorkItems(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/items$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/items$/)![1];
    await handleCreateWorkItem(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)$/);
    const workspaceId = match![1];
    const itemId = match![2];
    await handleUpdateWorkItem(handlerCtx, req, res, workspaceId, itemId);
    return true;
  }

  // ---- Tasks API (Phase B) ----
  if (method === 'GET' && url.match(/^\/v1\/tasks\/(.+)\/children$/)) {
    const match = url.match(/^\/v1\/tasks\/(.+)\/children$/);
    await handleListTaskChildren(handlerCtx, req, res, match![1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/tasks\/(.+)$/)) {
    const match = url.match(/^\/v1\/tasks\/(.+)$/);
    await handleGetTask(handlerCtx, req, res, match![1]);
    return true;
  }
  if (method === 'GET' && url === '/v1/tasks') {
    await handleListTasks(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/tasks') {
    await handleCreateTask(handlerCtx, req, res);
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/tasks\/(.+)$/)) {
    const match = url.match(/^\/v1\/tasks\/(.+)$/);
    await handleUpdateTask(handlerCtx, req, res, match![1]);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/tasks\/(.+)$/)) {
    const match = url.match(/^\/v1\/tasks\/(.+)$/);
    await handleDeleteTask(handlerCtx, req, res, match![1]);
    return true;
  }

  // ---- .liri/ Config ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/liri\/detect$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/liri\/detect$/)![1];
    await handleDetectLiriDir(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/workspaces\/(.+)\/liri\/init$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/liri\/init$/)![1];
    await handleInitLiriDir(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/config$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/config$/)![1];
    await handleGetWorkspaceConfig(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/workspaces\/(.+)\/config$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/config$/)![1];
    await handleUpdateWorkspaceConfig(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/rules$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/rules$/)![1];
    await handleGetWorkspaceRules(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/workspaces\/(.+)\/rules$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/rules$/)![1];
    await handleUpdateWorkspaceRules(handlerCtx, req, res, workspaceId);
    return true;
  }

  // ---- .liri/ Changesets ----
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/
    )!;
    await handleListChangeSets(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/(.+)\/changesets$/
    )!;
    await handleCreateChangeSet(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/summary$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/summary$/
    )!;
    await handleGetChangeSetSummary(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)!;
    await handleGetChangeSet(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/files$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/changesets\/(.+)\/files$/
    )!;
    await handleAddFileChange(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PATCH' &&
    url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/changesets\/(.+)$/)!;
    await handleUpdateChangeSet(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  return false;
}
