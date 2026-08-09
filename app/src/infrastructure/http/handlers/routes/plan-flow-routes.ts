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
 * plan-flow-routes.ts — dispatchPlanFlowRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  handleAbortPlan,
  handleCreatePlan,
  handleExecutePlan,
  handleGetFlow,
  handleGetPlan,
  handleGetPlanDAG,
  handleListFlows,
  handleListPlans,
} from '../plan-flow-handlers';
import {
  handlePdcaAudit,
  handlePdcaConfirm,
  handlePdcaDecideStep,
  handlePdcaList,
  handlePdcaReviewStep,
  handlePdcaStart,
  handlePdcaStatus,
} from '../pdca-handlers';
import {
  handleKanbanCreate,
  handleKanbanDelete,
  handleKanbanList,
  handleKanbanMove,
  handleKanbanUpdate,
} from '../kanban-handlers';

/**
 * dispatchPlanFlowRoutes — plan-flow-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchPlanFlowRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Plans & Flows (编排) ----
  if (method === 'GET' && url === '/v1/plans') {
    await handleListPlans(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/plans') {
    await handleCreatePlan(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/plans\/([^/]+)\/dag$/)) {
    await handleGetPlanDAG(
      req,
      res,
      url.match(/^\/v1\/plans\/([^/]+)\/dag$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/plans\/([^/]+)$/)) {
    await handleGetPlan(req, res, url.match(/^\/v1\/plans\/([^/]+)$/)![1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/plans\/(.+)\/execute$/)) {
    await handleExecutePlan(
      req,
      res,
      url.match(/^\/v1\/plans\/(.+)\/execute$/)![1]
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/plans\/(.+)\/abort$/)) {
    await handleAbortPlan(
      req,
      res,
      url.match(/^\/v1\/plans\/(.+)\/abort$/)![1]
    );
    return true;
  }
  if (method === 'GET' && url === '/v1/flows') {
    await handleListFlows(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/flows\/([^/]+)$/)) {
    await handleGetFlow(req, res, url.match(/^\/v1\/flows\/([^/]+)$/)![1]);
    return true;
  }

  // ---- PDCA (长程任务编排) ----
  if (method === 'POST' && url === '/v1/pdca/start') {
    await handlePdcaStart(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/pdca\/([^/]+)$/)) {
    await handlePdcaStatus(req, res, url.match(/^\/v1\/pdca\/([^/]+)$/)![1]);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/pdca\/(.+)\/audit$/)) {
    await handlePdcaAudit(req, res, url.match(/^\/v1\/pdca\/(.+)\/audit$/)![1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/pdca\/(.+)\/confirm$/)) {
    await handlePdcaConfirm(
      req,
      res,
      url.match(/^\/v1\/pdca\/(.+)\/confirm$/)![1]
    );
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/review$/)
  ) {
    const m = url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/review$/)!;
    await handlePdcaReviewStep(req, res, m[1], m[2]);
    return true;
  }
  if (
    method === 'POST' &&
    url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/decide$/)
  ) {
    const m = url.match(/^\/v1\/pdca\/(.+)\/step\/(.+)\/decide$/)!;
    await handlePdcaDecideStep(req, res, m[1], m[2]);
    return true;
  }
  if (method === 'POST' && url === '/v1/pdca/list') {
    await handlePdcaList(req, res);
    return true;
  }

  // ---- Kanban ----
  if (method === 'GET' && url === '/v1/kanban') {
    await handleKanbanList(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/kanban') {
    await handleKanbanCreate(req, res);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/kanban\/(.+)$/)) {
    await handleKanbanUpdate(req, res, url.match(/^\/v1\/kanban\/(.+)$/)![1]);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/kanban\/(.+)$/)) {
    await handleKanbanDelete(req, res, url.match(/^\/v1\/kanban\/(.+)$/)![1]);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/kanban\/(.+)\/move$/)) {
    await handleKanbanMove(
      req,
      res,
      url.match(/^\/v1\/kanban\/(.+)\/move$/)![1]
    );
    return true;
  }
  return false;
}
