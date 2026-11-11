/**
 * 路由注册表
 * 将 HTTP 请求的 method + URL 匹配到对应的 handler 函数
 * 由 LocalHTTPService.handleRequest 调用
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { checkAdminRequest } from './auth-handlers';
import { requiresAdminApi } from '../adminWriteRoutes';
// P1-1（2026-11-11）：暴露部署下管理面**恒**要求有效 Bearer（不受灰度开关影响）
import { hasValidBearerSession, isExposedDeployment } from '../requestIdentity';
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
import { dispatchSystemRoutes } from './routes/system-routes';
import { dispatchTranslationRoutes } from './routes/translation-routes';
import { dispatchGoalRoutes } from './routes/goal-routes';
// P3-1（2026-09-29）：A2A 对外发现（ACP 对内 / A2A 对外）—— 默认关闭
import { dispatchA2ARoutes } from './routes/a2a-routes';
// 2026-10-08：AI-VFS 用户可配置挂载面（`ai-vfs-user-mountable.md §8.2`）
import { dispatchVfsMountRoutes } from './routes/vfs-mounts-routes';
// 多租户 P5（2026-10-21）：删除租户（破坏性管理操作，仅 DELETE）
import { dispatchTenantRoutes } from './routes/tenant-routes';

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

  // ---- 管理面鉴权（读 + 写）：登录态非 admin → 403；无效 token → 401；无 token → 本地回环基线放行 ----
  // 「哪些路径属管理面」下沉到 `adminWriteRoutes#requiresAdminApi`（W26-15，2026-10-26）：
  //   - 前缀改**段边界**匹配 ⇒ `/v1/skills` 不再误伤 `/v1/skillsets`；
  //   - 判定变纯函数 ⇒ 可单测覆盖（此前内联在调度链里，只能靠集成测试）。
  // M1（2026-08-06）：skill 管理写操作并入 admin 权限体系；T25-08 P2：能力授权；多租户 P5：租户删除。
  // P1-1（2026-11-11）：RBAC 快照（`GET /v1/permissions/rbac`）纳入读侧管理面。
  if (requiresAdminApi(method, url)) {
    // 暴露部署（非回环绑定 / headless）：管理面**恒**要求有效 Bearer。
    // 与 `requiresBearerSession` 的差异：后者受 `FEATURE_REQUIRE_BEARER` 灰度开关控制，
    // 而管理面不应因灰度回退重新对远端匿名开放 ⇒ 这里独立 fail-closed（桌面回环不受影响）。
    if (isExposedDeployment() && !(await hasValidBearerSession(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: '管理操作需要 admin 权限',
            type: 'authentication_error',
          },
        })
      );
      return true;
    }
    const result = checkAdminRequest(req);
    if (result !== 'ok') {
      res.writeHead(result === 'unauthorized' ? 401 : 403, {
        'Content-Type': 'application/json',
      });
      // `type` 与既有 4xx 词表对齐（OpenAI 风格）：401 ⇒ authentication_error、403 ⇒ permission_error。
      // 此前该分支**没有** `type`，按 `error.type` 分派的消费方会掉进 undefined 分支。
      res.end(
        JSON.stringify({
          error: {
            message: '管理操作需要 admin 权限',
            type:
              result === 'unauthorized'
                ? 'authentication_error'
                : 'permission_error',
          },
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
  if (await dispatchSystemRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  if (
    await dispatchTranslationRoutes(req, res, url, broadcastEvent, handlerCtx)
  )
    return true;
  // M-6 接线（2026-09-22）：长程任务目标入口（`/v1/goals`）
  if (await dispatchGoalRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  // P3-1（2026-09-29）：A2A 对外发现（`/.well-known/agent-card.json`，默认关闭 ⇒ 未启用时自然 404）
  if (await dispatchA2ARoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  // 2026-10-08：AI-VFS 用户可配置挂载面（`/v1/vfs/mounts`，GET/PUT）
  if (await dispatchVfsMountRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;
  // 多租户 P5（2026-10-21）：`DELETE /v1/tenants/:tenantId`（admin 已在上面统一拦截）
  if (await dispatchTenantRoutes(req, res, url, broadcastEvent, handlerCtx))
    return true;

  return false;
}
