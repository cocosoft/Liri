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
 * cost-channel-routes.ts — 领域路由**组合根**
 *
 * 由 `route-table.ts` 拆分而来（FSZ-002 阶段二：注册式路由收敛，领域分发模块）。
 *
 * **2026-10-20 再拆分**：本函数圈复杂度实测 **99**（`lint:complexity` 阈值 100 的临界），
 * 再并入任何分支都会触顶 ⇒ 按领域拆成子派发（每个子派发各自可测、各自复杂度 < 40）：
 *   - `cost-usage-routes`（工作空间成本 + 统一用量成本 + 遗留 301）
 *   - `daily-budget-routes`（R16/D3 + D-b 放行）
 *   - `workspace-item-routes`（条目检索 / 评审）
 *   - `buddy-routes`（伙伴 + 后台状态）
 *   - `cron-routes`（定时任务）
 *   - `channel-surface-routes`（通道面 + 插件 + WeChat CLI）
 *
 * **契约**：调用顺序即匹配顺序，与拆分前**逐字一致**；本文件只做顺序编排，不含业务分支。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  dispatchCostUsageRoutes,
  dispatchLegacyCostRedirects,
} from './cost-usage-routes';
import { dispatchDailyBudgetRoutes } from './daily-budget-routes';
import { dispatchWorkspaceItemRoutes } from './workspace-item-routes';
import { dispatchBuddyRoutes } from './buddy-routes';
import { dispatchCronRoutes } from './cron-routes';
import { dispatchChannelSurfaceRoutes } from './channel-surface-routes';
import { handleGatewayOutboundStream } from '../gateway-outbound-stream';

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
  const args: RouteDispatchArgs = {
    req,
    res,
    method: req.method || 'GET',
    url,
    handlerCtx,
    broadcastEvent,
  };

  // 顺序即语义（与拆分前一致）：
  // 成本/用量 → 日预算 → 遗留 301 → 工作空间条目 → Buddy → Cron
  // → Gateway 出站流 → 通道面
  if (await dispatchCostUsageRoutes(args)) return true;
  if (await dispatchDailyBudgetRoutes(args)) return true;
  if (await dispatchLegacyCostRedirects(args)) return true;
  if (await dispatchWorkspaceItemRoutes(args)) return true;
  if (await dispatchBuddyRoutes(args)) return true;
  if (await dispatchCronRoutes(args)) return true;

  // ---- Gateway outbound stream（U-15：四原语投影统一出站订阅面）----
  if (args.method === 'GET' && url === '/v1/gateway/outbound/stream') {
    await handleGatewayOutboundStream(req, res);
    return true;
  }

  if (await dispatchChannelSurfaceRoutes(args)) return true;
  return false;
}
