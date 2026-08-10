/**
 * 路由注册表
 * 将 HTTP 请求的 method + URL 匹配到对应的 handler 函数
 * 由 LocalHTTPService.handleRequest 调用
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { checkAdminRequest } from './auth-handlers';
import { dispatchChatSessionRoutes } from './routes/chat-session-routes';
import { dispatchPlanFlowRoutes } from './routes/plan-flow-routes';
import { dispatchToolMediaRoutes } from './routes/tool-media-routes';
import { dispatchTaskAgentRoutes } from './routes/task-agent-routes';
import { dispatchMemoryFilesRoutes } from './routes/memory-files-routes';
import { dispatchWorkspaceRoutes } from './routes/workspace-routes';
import { dispatchProjectRoutes } from './routes/project-routes';
import { dispatchKnowledgeRoutes } from './routes/knowledge-routes';
import { dispatchCostChannelRoutes } from './routes/cost-channel-routes';
import { dispatchConfigSkillsRoutes } from './routes/config-skills-routes';
import { dispatchMonitorCommandRoutes } from './routes/monitor-command-routes';
import { dispatchMarketplaceMcpRoutes } from './routes/marketplace-mcp-routes';
import { dispatchAuthAccessRoutes } from './routes/auth-access-routes';
import { dispatchLlamaRoutes } from './routes/llama-routes';

/**
 * 路由调度函数
 * @param req - HTTP 请求
 * @param res - HTTP 响应
 * @param url - 解析后的 URL path
 * @param self - LocalHTTPService 实例（用于调用 this.handleXxx 方法）
 * @param broadcastEvent - 事件广播回调
 * @param handlerCtx - HandlerCtx 实例（用于动态 import 的 handler）
 * @returns true 表示已匹配路由并处理，false 表示未匹配
 */
export async function dispatchRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  // ---- 管理写 API 鉴权（M0d：登录态非 admin → 403；无效 token → 401；无 token → 本地回环基线放行）----
  // M1（2026-08-06）：skill 管理写操作（install/uninstall/delete/import/clone/update/toggle/create）并入 admin 权限体系
  if (
    (method === 'POST' || method === 'PUT' || method === 'DELETE') &&
    (url.startsWith('/v1/permissions/') ||
      url.startsWith('/v1/apikeys') ||
      url.startsWith('/v1/oauth/providers') ||
      url.startsWith('/v1/skills'))
  ) {
    const result = checkAdminRequest(req);
    if (result !== 'ok') {
      res.writeHead(result === 'unauthorized' ? 401 : 403, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: { message: '管理操作需要 admin 权限' },
        })
      );
      return true;
    }
  }

  if (
    await dispatchChatSessionRoutes(req, res, url, broadcastEvent, handlerCtx)
  )
    return true;
  if (await dispatchPlanFlowRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (await dispatchToolMediaRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (await dispatchTaskAgentRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (
    await dispatchMemoryFilesRoutes(req, res, url, broadcastEvent, handlerCtx)
  )
    return true;
  if (await dispatchWorkspaceRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (await dispatchProjectRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (await dispatchKnowledgeRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (
    await dispatchCostChannelRoutes(req, res, url, broadcastEvent, handlerCtx)
  )
    return true;
  if (
    await dispatchConfigSkillsRoutes(req, res, url, broadcastEvent, handlerCtx)
  )
    return true;
  if (
    await dispatchMonitorCommandRoutes(
      req,
      res,
      url,
      broadcastEvent,
      handlerCtx
    )
  )
    return true;
  if (
    await dispatchMarketplaceMcpRoutes(
      req,
      res,
      url,
      broadcastEvent,
      handlerCtx
    )
  )
    return true;
  if (await dispatchAuthAccessRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (await dispatchLlamaRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;

  return false;
}
