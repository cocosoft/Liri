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
 * cost-channel-routes.ts — dispatchCostChannelRoutes
 *
 * 由 route-table.ts 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 * 保持与拆分前完全一致的匹配顺序与 handler 调用。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { getLogger } from '@modules/monitoring';
import {
  handleCostReconcile,
  handleCostReport,
  handleGlobalCostRange,
  handleGlobalCostRecords,
  handleGlobalCostSummary,
  handleWorkspaceBudgetStatus,
  handleWorkspaceCostReport,
} from '../cost-handlers';
import {
  handleSearchWorkItems,
  handleWorkItemReview,
} from '../workitem-search-handlers';
import {
  handleBuddyInteract,
  handleGetBackgroundStatus,
  handleGetBuddy,
  handleGetBuddyStats,
  handleGetDreamLogs,
} from '../buddy-handlers';
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
import {
  handleApplyChannelConfig,
  handleChannelHealth,
  handleChannelMetrics,
  handleChannelSchema,
  handleDeleteChannel,
  handleGetChannel,
  handleListChannels,
  handleToggleChannel,
  handleUpdateChannel,
  handleWechatCliStatus,
} from '../channel-handlers';
import {
  handleInstallChannelPlugin,
  handleListChannelPlugins,
  handleUninstallChannelPlugin,
} from '../channel-plugin-handlers';

const logger = getLogger('http:cost-channel-routes');

/**
 * dispatchCostChannelRoutes — cost-channel-routes 领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchCostChannelRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  // ---- Cost Awareness ----
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/cost\/report$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/cost\/report$/)![1];
    await handleWorkspaceCostReport(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/workspaces\/(.+)\/cost\/budget$/)) {
    const workspaceId = url.match(/^\/v1\/workspaces\/(.+)\/cost\/budget$/)![1];
    await handleWorkspaceBudgetStatus(handlerCtx, req, res, workspaceId);
    return true;
  }

  // ---- Unified Usage Cost Routes (v3 统一前缀 /v1/usage/cost/*) ----
  if (method === 'GET' && url === '/v1/usage/cost/summary') {
    await handleGlobalCostSummary(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/records') {
    await handleGlobalCostRecords(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/range') {
    await handleGlobalCostRange(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/report') {
    await handleCostReport(handlerCtx, req, res);
    return true;
  }
  // [v1.2] 对账 API
  if (method === 'GET' && url === '/v1/usage/cost/reconcile') {
    await handleCostReconcile(handlerCtx, req, res);
    return true;
  }

  // ---- Legacy Cost Routes (301 → /v1/usage/cost/*) ----
  if (method === 'GET' && url === '/api/cost/summary') {
    logger.warning(
      '已废弃路径访问 /api/cost/summary → 301 /v1/usage/cost/summary'
    );
    res.writeHead(301, { Location: '/v1/usage/cost/summary' });
    res.end();
    return true;
  }
  if (method === 'GET' && url === '/api/cost/records') {
    logger.warning(
      '已废弃路径访问 /api/cost/records → 301 /v1/usage/cost/records'
    );
    res.writeHead(301, { Location: '/v1/usage/cost/records' });
    res.end();
    return true;
  }
  if (method === 'GET' && url === '/api/cost/range') {
    logger.warning('已废弃路径访问 /api/cost/range → 301 /v1/usage/cost/range');
    res.writeHead(301, { Location: '/v1/usage/cost/range' });
    res.end();
    return true;
  }
  if (method === 'GET' && url === '/api/cost/report') {
    logger.warning(
      '已废弃路径访问 /api/cost/report → 301 /v1/usage/cost/report'
    );
    res.writeHead(301, { Location: '/v1/usage/cost/report' });
    res.end();
    return true;
  }

  // ---- Work Item Search ----
  if (
    method === 'POST' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/search$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/search$/
    )![1];
    await handleSearchWorkItems(handlerCtx, req, res, workspaceId);
    return true;
  }
  if (
    method === 'GET' &&
    url.match(/^\/v1\/workspaces\/(.+)\/items\/review$/)
  ) {
    const workspaceId = url.match(
      /^\/v1\/workspaces\/(.+)\/items\/review$/
    )![1];
    await handleWorkItemReview(handlerCtx, req, res, workspaceId);
    return true;
  }

  // ---- Buddy ----
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

  // ---- 后台任务运行状况（Dream 记忆整理 + Buddy 成长） ----
  if (method === 'GET' && url === '/v1/background/status') {
    await handleGetBackgroundStatus(handlerCtx, req, res);
    return true;
  }

  // ---- Cron (delegated to handlers/cron-handlers.ts) ----
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
  if (method === 'GET' && url.match(/^\/v1\/cron\/(.+)$/)) {
    await handleGetCron(req, res, url.match(/^\/v1\/cron\/(.+)$/)![1]);
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/cron\/(.+)$/)) {
    await handleUpdateCron(
      req,
      res,
      url.match(/^\/v1\/cron\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/cron\/(.+)$/)) {
    await handleDeleteCron(
      req,
      res,
      url.match(/^\/v1\/cron\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/cron\/(.+)\/run$/)) {
    await handleRunCron(
      req,
      res,
      url.match(/^\/v1\/cron\/(.+)\/run$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }

  // ---- Channels ----
  if (method === 'GET' && url === '/v1/channels') {
    await handleListChannels(req, res);
    return true;
  }
  // P0-1（4.1）：字段渲染元数据端点，先于 /v1/channels/(.+) 匹配
  if (method === 'GET' && url === '/v1/channels/schema') {
    await handleChannelSchema(req, res);
    return true;
  }
  // P2-6（4.12）：健康聚合接口必须先于 /v1/channels/(.+) 匹配，否则被 handleGetChannel 吞掉
  if (method === 'GET' && url === '/v1/channels/health') {
    await handleChannelHealth(req, res);
    return true;
  }
  // 渠道可观测性指标（channels.* 系列），同样先于 /v1/channels/(.+) 匹配
  if (method === 'GET' && url === '/v1/channels/metrics') {
    await handleChannelMetrics(req, res);
    return true;
  }
  if (method === 'GET' && url.match(/^\/v1\/channels\/(.+)$/)) {
    await handleGetChannel(req, res, url.match(/^\/v1\/channels\/(.+)$/)![1]);
    return true;
  }
  if (method === 'POST' && url.match(/^\/v1\/channels\/(.+)\/toggle$/)) {
    await handleToggleChannel(
      req,
      res,
      url.match(/^\/v1\/channels\/(.+)\/toggle$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/channels\/(.+)$/)) {
    await handleDeleteChannel(
      req,
      res,
      url.match(/^\/v1\/channels\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'PUT' && url.match(/^\/v1\/channels\/(.+)$/)) {
    await handleUpdateChannel(
      req,
      res,
      url.match(/^\/v1\/channels\/(.+)$/)![1],
      (event, data) => broadcastEvent(event, data)
    );
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/config/apply') {
    await handleApplyChannelConfig(req, res);
    return true;
  }

  // ---- Channel Plugins ----
  if (method === 'GET' && url === '/v1/channels/plugins') {
    await handleListChannelPlugins(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/plugins/install') {
    await handleInstallChannelPlugin(req, res);
    return true;
  }
  if (method === 'DELETE' && url.match(/^\/v1\/channels\/plugins\/(.+)$/)) {
    await handleUninstallChannelPlugin(
      req,
      res,
      url.match(/^\/v1\/channels\/plugins\/(.+)$/)![1]
    );
    return true;
  }

  // ---- WeChat CLI Status ----
  if (method === 'GET' && url === '/v1/wechat/cli-status') {
    await handleWechatCliStatus(handlerCtx, req, res);
    return true;
  }
  return false;
}
