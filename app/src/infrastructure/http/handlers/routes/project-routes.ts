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
import { json } from '../handler-utils';
import {
  handleGetProjectBoard,
  handleGetProjectRules,
  handleGetTemplates,
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
 * D-2 修复：projectId 路径穿越防护（统一在分发层校验所有 :projectId 捕获值）。
 * projectId 直接参与 `join(projectsDir, projectId)`，含路径分隔符/`..` 可穿越目录
 * （如 `DELETE /v1/projects/..` 会 rmSync 整个 data 目录）。此前仅 artifact-handlers
 * 内部 3 处校验，主 CRUD/history/summaries/engine-hook/files 全部无防护。
 */
function isSafeProjectId(projectId: string): boolean {
  return (
    !!projectId &&
    !projectId.includes('/') &&
    !projectId.includes('\\') &&
    !projectId.includes('..')
  );
}

/** 非法 projectId 统一 400 响应（已处理，返回 true 终止分发） */
function rejectBadProjectId(res: http.ServerResponse): true {
  json(res, 400, { error: '非法 projectId' });
  return true;
}

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
    // D-2 补充：旧链路只读路由的 projectId 也参与 join，统一校验
    if (!isSafeProjectId(match[2])) return rejectBadProjectId(res);
    await handleGetProjectBoard(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)!;
    if (!isSafeProjectId(match[2])) return rejectBadProjectId(res);
    await handleGetProjectRules(handlerCtx, req, res, match[1], match[2]);
    return true;
  }
  if (
    method === 'PUT' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/rules$/)
  ) {
    // D-3 修复：旧写路由操作旧 store（<ws>/.liri/projects/），与新链路
    // （data/projects/）数据分裂。前端无调用方（workspaceService.updateProjectRules
    // 0 引用），直接 410 阻断写入旧 store，防止同 projectId 双目录数据分叉。
    json(res, 410, {
      error:
        '该写路由已废弃：请使用 /v1/projects/:id/context 或 /v1/projects/:id/artifacts',
    });
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/items$/)
  ) {
    // D-3 修复：同上，旧写路由 410（前端 createProjectWorkItem 0 调用者）
    json(res, 410, {
      error: '该写路由已废弃：请使用 /v1/projects/:id 系列新链路',
    });
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)\/decompose$/)
  ) {
    // D-3 修复：同上，旧写路由 410（前端 projectDecomposer 0 调用者）
    json(res, 410, {
      error: '该写路由已废弃：请使用 /v1/projects/:id 系列新链路',
    });
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/workspaces\/(.+)\/projects\/(.+)$/)!;
    if (!isSafeProjectId(match[2])) return rejectBadProjectId(res);
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
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleGetProjectContext(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/context$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/context$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleSaveProjectContext(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/engine-hook$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/engine-hook$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleEngineHook(req, res, match[1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/history$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/history$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleGetProjectHistory(req, res, match[1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/summaries$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/summaries$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleGetSummaries(req, res, match[1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)\/files$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/files$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleListProjectFiles(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/files$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/files$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleUploadProjectFile(req, res, match[1]);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/projects\/(.+)\/files\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/files\/(.+)$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
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
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleListArtifacts(req, res, match[1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/projects\/(.+)\/artifacts$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)\/artifacts$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleSaveArtifact(req, res, match[1]);
    return true;
  }
  if (
    method === 'DELETE' &&
    url.match(/^\/v1\/projects\/(.+)\/artifacts\/(.+)$/)
  ) {
    const match = url.match(/^\/v1\/projects\/(.+)\/artifacts\/(.+)$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleDeleteArtifact(req, res, match[1], match[2]);
    return true;
  }

  // P0b: Project CRUD（单项目操作，在子路由之后避免冲突）
  if (method === 'GET' && url.match(/^\/v1\/projects\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleGetProject(req, res, match[1]);
    return true;
  }
  if (method === 'PATCH' && url.match(/^\/v1\/projects\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleUpdateProject(req, res, match[1]);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/projects\/(.+)$/)) {
    const match = url.match(/^\/v1\/projects\/(.+)$/)!;
    if (!isSafeProjectId(match[1])) return rejectBadProjectId(res);
    await handleDeleteProject(req, res, match[1]);
    return true;
  }
  return false;
}
