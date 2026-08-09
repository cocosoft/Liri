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
 * project-routes.ts — dispatchProjectRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleCreateProjectWorkItem,
  handleDecomposeProject,
  handleGetProjectBoard,
  handleGetProjectRules,
  handleGetTemplates,
  handleUpdateProjectRules,
} from '../workspaces-handlers';
import { handleListProjects as handleWsListProjects } from '../workspaces-handlers';
import { handleGetProject as handleWsGetProject } from '../workspaces-handlers';
import {
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handleMigrateFiles,
  handleMigrateProjects,
  handleUpdateProject,
} from '../project-handlers';
import {
  handleDeleteArtifact,
  handleDeleteProjectFile,
  handleEngineHook,
  handleGetProjectContext,
  handleGetProjectHistory,
  handleGetSummaries,
  handleListArtifacts,
  handleListProjectFiles,
  handleSaveArtifact,
  handleSaveProjectContext,
  handleUploadProjectFile,
} from '../project-artifact-handlers';

/**
 * dispatchProjectRoutes — project-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchProjectRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Projects ----
  // P1-1: 移除旧写路由（POST/PATCH/DELETE），仅保留只读（list/get）供数据迁移兼容；创建统一走 /v1/projects
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/projects$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/projects$/)![1];
    await handleWsListProjects(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/templates$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/templates$/)![1];
    await handleGetTemplates(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/board$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/board$/)!;
    await handleGetProjectBoard(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)!;
    await handleGetProjectRules(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)!;
    await handleUpdateProjectRules(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/items$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/items$/)!;
    await handleCreateProjectWorkItem(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/decompose$/)
  ) {
    const match = url.match(
      /^\/v1\/workspaces\/(.+)\/projects\/(.+)\/decompose$/
    )!;
    await handleDecomposeProject(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)!;
    await handleWsGetProject(handlerCtx, req, res, match[1], match[2]);
    return true;
  }

  // ---- Project Artifacts ----
  // P0b: Project CRUD（list/create 精确匹配，在子路由之前）
  if (method === 'GET' && url === '/v1/projects') {
    await handleListProjects(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/projects') {
    await handleCreateProject(req, res);
    return true;
  }

  // P0b-4: 迁移路由（必须在 /v1/projects/:id 之前）
  if (method === 'POST' && url === '/v1/projects/migrate') {
    await handleMigrateProjects(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/projects/migrate-files') {
    await handleMigrateFiles(req, res);
    return true;
  }

  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/context$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/context$/)!;
    await handleGetProjectContext(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/context$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/context$/)!;
    await handleSaveProjectContext(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/engine-hook$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/engine-hook$/)!;
    await handleEngineHook(req, res, match[1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/history$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/history$/)!;
    await handleGetProjectHistory(req, res, match[1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/summaries$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/summaries$/)!;
    await handleGetSummaries(req, res, match[1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/files$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/files$/)!;
    await handleListProjectFiles(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/files$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/files$/)!;
    await handleUploadProjectFile(req, res, match[1]);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/projects\/(.+)\/files\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/files\/(.+)$/)!;
    await handleDeleteProjectFile(
      req,
      res,
      match[1],
      decodeURIComponent(match[2])
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/artifacts$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/artifacts$/)!;
    await handleListArtifacts(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/artifacts$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/artifacts$/)!;
    await handleSaveArtifact(req, res, match[1]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/projects\/(.+)\/artifacts\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/projects\/(.+)\/artifacts\/(.+)$/)!;
    await handleDeleteArtifact(req, res, match[1], match[2]);
    return true;
  }

  // P0b: Project CRUD（单项目操作，在子路由之后避免冲突）
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)$/)!;
    await handleGetProject(req, res, match[1]);
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/projects\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)$/)!;
    await handleUpdateProject(req, res, match[1]);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/projects\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)$/)!;
    await handleDeleteProject(req, res, match[1]);
    return true;
  }
  return false;
}
