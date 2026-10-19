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
  handleChannelMonitorForceReconnect,
  handleChannelMonitorStatus,
  handleChannelMessageTrace,
  handleChannelMessageTraces,
  handleChannelMonitorStream,
  handleChannelSchema,
  handleDeleteChannel,
  handleGetChannel,
  handleListChannels,
  handleToggleChannel,
  handleUpdateChannel,
  handleWechatCliStatus,
} from '../channel-handlers';
import { handleGatewayOutboundStream } from '../gateway-outbound-stream';
import {
  handleInstallChannelPlugin,
  handleListChannelPlugins,
  handleUninstallChannelPlugin,
} from '../channel-plugin-handlers';
import {
  handleEstimateTurnCost,
  handleGetDailyBudget,
  handleGetDailyBudgetSuspends,
  handleResetDailyBudget,
  handleClearDailyBudgetRelief,
  handleSetDailyBudgetKillSwitch,
  handleSetDailyBudgetRelief,
  handleUpdateDailyBudget,
} from '../daily-budget-handlers';

const logger = getLogger('http:cost-channel-routes');

/**
 * 日 Token 预算子路由派发（R16/D3 既有 4 端点 + **D-b 放行**）。
 *
 * **为什么抽出来**：主派发函数 `dispatchCostChannelRoutes` 已属复杂度重尾离群（≥100）；
 * `lint:complexity` 棘轮只允许减少，故新增端点必须落在子函数里（净效果反而是**降低**主函数复杂度）。
 *
 * 精确路径，调用点置于工作空间/渠道通配正则之前，避免被更宽的正则吞掉。
 */
async function dispatchDailyBudgetRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void
): Promise<boolean> {
  // G-04（2026-10-19）：**只读**成本折算估算器（同源取价链；前端禁止自算）。
  // 查询串（`?model=…&usd=…`）是正常调用形态 ⇒ 必须按前缀匹配，不能用 `===` 精确等值。
  if (
    method === 'GET' &&
    (url === '/v1/cost/estimate-turn' ||
      url.startsWith('/v1/cost/estimate-turn?'))
  ) {
    await handleEstimateTurnCost(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/cost/daily-budget') {
    await handleGetDailyBudget(res);
    return true;
  }
  // A2（2026-10-12）：**只读**挂起清单（预算挂起续跑可见性）—— 不受开关门控。
  if (method === 'GET' && url === '/v1/cost/daily-budget/suspend') {
    await handleGetDailyBudgetSuspends(res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/cost/daily-budget') {
    await handleUpdateDailyBudget(req, res, broadcastEvent);
    return true;
  }
  if (method === 'POST' && url === '/v1/cost/daily-budget/reset') {
    await handleResetDailyBudget(res, broadcastEvent);
    return true;
  }
  if (method === 'POST' && url === '/v1/cost/daily-budget/kill-switch') {
    await handleSetDailyBudgetKillSwitch(req, res, broadcastEvent);
    return true;
  }
  // D-b（2026-10-11）：放行（临时提额 / 单次豁免 / 当日解除）—— Spec §5-B
  if (method === 'POST' && url === '/v1/cost/daily-budget/relief') {
    await handleSetDailyBudgetRelief(req, res, broadcastEvent);
    return true;
  }
  // D-b 对称回路（2026-10-12）：**撤销放行**（清全部在途放行、恢复配置上限；
  // 保留今日用量 —— 与 `POST /reset` 的"用量归零"互不相同）
  if (method === 'DELETE' && url === '/v1/cost/daily-budget/relief') {
    await handleClearDailyBudgetRelief(res, broadcastEvent);
    return true;
  }
  return false;
}

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

  // ---- Daily Token Budget（R16/D3 四端点 + D-b 放行）----
  // 子派发抽为独立函数：本函数属复杂度重尾离群，**不得再增分支**（`lint:complexity` 棘轮只允许减少）。
  if (
    await dispatchDailyBudgetRoutes(req, res, method, url, (event, data) =>
      broadcastEvent(event, data)
    )
  ) {
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

  // ---- Gateway outbound stream（U-15：四原语投影统一出站订阅面）----
  if (method === 'GET' && url === '/v1/gateway/outbound/stream') {
    await handleGatewayOutboundStream(req, res);
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
  // 渠道实时监控（五态机快照 / SSE 事件流 / 强制重连兜底），先于 /v1/channels/(.+) 匹配
  if (method === 'GET' && url === '/v1/channels/monitor/status') {
    await handleChannelMonitorStatus(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/channels/monitor/stream') {
    await handleChannelMonitorStream(req, res);
    return true;
  }
  if (method === 'POST' && url === '/v1/channels/monitor/force-reconnect') {
    await handleChannelMonitorForceReconnect(req, res);
    return true;
  }
  // 方案 A：消息级全链路追踪（精确路径先于 /v1/channels/(.+) 通配匹配）
  if (method === 'GET' && url.startsWith('/v1/channels/messages/trace')) {
    const remainder = url.slice('/v1/channels/messages/trace'.length);
    if (remainder === '' || remainder.startsWith('?')) {
      await handleChannelMessageTraces(req, res);
    } else {
      await handleChannelMessageTrace(
        req,
        res,
        decodeURIComponent(remainder.replace(/^\//, '').split('?')[0])
      );
    }
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
