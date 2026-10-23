/**
 * 子代理**控制面** HTTP 处理器（方案 O10a① + E2 用户入口）
 *
 * - `GET  /v1/agents/control`        查询暂停态 + 活跃代理（只读投影，不外泄 sessionId）
 * - `GET  /v1/agents/runs`           查询最近运行台账（磁盘，含 `descriptor_source`；T8）
 * - `POST /v1/agents/pause`          暂停 spawn（**阻断新增、在途不受影响**）
 * - `POST /v1/agents/resume`         恢复 spawn
 * - `POST /v1/agents/:id/stop`       停止指定代理（body 带 `sessionId` ⇒ Tier2 归属校验；
 *                                    无会话上下文的运维调用须**显式** `privileged: true`）
 *
 * O10a① 语义：**带** `sessionId` 时做"请求方会话 == 代理归属"校验（不一致 ⇒ 拒绝）；
 * **不带**时必须显式声明 `privileged: true`（2026-10-23 起不再"不传即特权"）。
 */

import type http from 'http';
// 2026-10-01 D-199（tools 域取用面收敛，`tools` 域**最后一条**）：原先**静态**导入 5 个符号
// （`AgentTool` 类型 · `getAgentRunStore` · `resolveAgentToolInstance` · `setSpawnPaused` ·
// `getSpawnPauseState`）⇒ `infrastructure -> app` 倒挂。现已**全部**改经 service 侧端口
// （`getCoreAPI().getToolsPort()`，端口于 D-199 步骤 1 就绪）。
// service 侧端口取用入口（同 D-93 先例）
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { REQUEST_URL_PARSE_BASE } from '@modules/core';
import type { HandlerCtx } from './handler-utils';

/**
 * 取 AgentTool 真身（R6，2026-09-22）。
 *
 * 修复前：`getToolManager().getTool('agent') instanceof AgentTool` —— 而 `getTool()` 返回的是
 * `ToolLazyWrapper`（`implements Tool`，**非 extends**）⇒ 恒 false ⇒ 本控制面全量 503，
 * `AgentTool.stopAgent`（含批次级取消 R1）的修复代码**一行都不会被执行**。
 * 现统一走 `resolveAgentToolInstance()`（解包 + 能力判定，见该模块注释；其内部自带 error 日志）。
 */
// （D-199：原 `getAgentTool()` helper 已删除 —— 其"解包 + 能力判定"职责并入端口：
// `isAgentToolAvailable()` / `getActiveAgents()` / `stopAgent()`。）

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** GET /v1/agents/control —— 暂停态 + 活跃代理（只读；投影不含 sessionId） */
export async function handleGetAgentControl(
  ctx: HandlerCtx,
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const tools = await getCoreAPI().getToolsPort();
    sendJson(res, 200, {
      spawn: tools.getSpawnPauseState(),
      agents: tools.getActiveAgents(),
    });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/** POST /v1/agents/pause —— 暂停新 spawn（在途继续跑） */
export async function handlePauseAgentSpawn(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = body ? (JSON.parse(body) as { reason?: string }) : {};
    const tools = await getCoreAPI().getToolsPort();
    const state = tools.setSpawnPaused(
      true,
      typeof data.reason === 'string' ? data.reason : undefined
    );
    sendJson(res, 200, {
      message: '子代理 spawn 已暂停（在途不受影响）',
      spawn: state,
    });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * GET /v1/agents/runs?limit=N —— 最近的子代理运行台账（只读；T8 运行态面板的数据源）。
 *
 * 与 `/v1/agents/control` 互补：后者是**内存活跃投影**（"此刻谁在跑"），
 * 本端点读**磁盘台账**（`agent_runs`，"刚跑完的那些结果如何、用的是 DB 角色还是内置"）。
 *
 * 字段裁剪（守 O10a②）：**不外泄 `sessionId` / `owner_pid` / `owner_started_at`**；
 * 返回 `descriptorSource`（O19 落盘）供前端展示"来源"列。
 */
export async function handleListAgentRuns(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    // 从 `req.url` 取参数（路由传入的 `url` 可能已去查询串，故不依赖它）
    const parsed = new URL(req.url ?? '/', REQUEST_URL_PARSE_BASE);
    const rawLimit = Number(parsed.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
      : 50;

    const tools = await getCoreAPI().getToolsPort();
    const rows = await tools.listAgentRuns(); // 按 started_at 升序
    const recent = rows.slice(-limit).reverse(); // 面板要"最近优先"

    sendJson(res, 200, {
      total: rows.length,
      runs: recent.map((row) => ({
        toolCallId: row.toolCallId,
        agentId: row.agentId,
        name: row.name,
        agentType: row.agentType,
        status: row.status,
        descriptorSource: row.descriptorSource ?? null,
        batchId: row.batchId ?? null,
        taskKey: row.taskKey ?? null,
        startedAt: row.startedAt ?? null,
        endedAt: row.endedAt ?? null,
        error: row.error ?? null,
        // 接线期③ ③-A（2026-09-24）：未完成 run 的失败归因（系统图快照 + 根因候选）
        attribution: row.attribution ?? null,
      })),
    });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/** POST /v1/agents/resume —— 恢复 spawn */
export async function handleResumeAgentSpawn(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const tools = await getCoreAPI().getToolsPort();
    const state = tools.setSpawnPaused(false);
    sendJson(res, 200, { message: '子代理 spawn 已恢复', spawn: state });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * `/stop` 的授权意图解析结果（**纯函数**，2026-10-23）。
 *
 * 背景（O14 显式化）：原实现 `privileged: sessionId === undefined` —— "不传会话"**自动**
 * 变成特权调用，无法区分"运维确有意"与"调用方漏传/拼错字段"。现要求二选一：
 * - 带 `sessionId` ⇒ 走 Tier2 归属校验（`privileged: false`）；
 * - 不带 `sessionId` ⇒ **必须显式** `privileged: true`，否则 400。
 *
 * 两者同时出现 ⇒ 拒绝（避免"带会话却偷偷提权"的歧义）。
 */
export type StopAgentAuthIntent =
  | { ok: true; requesterSessionId?: string; privileged: boolean }
  | { ok: false; reason: string; hint: string };

export function resolveStopAgentAuthIntent(body: unknown): StopAgentAuthIntent {
  const input =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rawSessionId = input['sessionId'];
  const hasSessionId =
    typeof rawSessionId === 'string' && rawSessionId.trim() !== '';
  const privileged = input['privileged'] === true;

  if (hasSessionId && privileged) {
    return {
      ok: false,
      reason: '不可同时提供 sessionId 与 privileged',
      hint: '带会话时走归属校验；无会话的运维调用才使用 {"privileged": true}',
    };
  }
  if (hasSessionId) {
    return {
      ok: true,
      requesterSessionId: (rawSessionId as string).trim(),
      privileged: false,
    };
  }
  if (privileged) {
    return { ok: true, privileged: true };
  }
  return {
    ok: false,
    reason: '缺少 sessionId，且未显式声明 privileged',
    hint: '会话内停止请传 {"sessionId":"<id>"}；无会话的运维调用请传 {"privileged": true}',
  };
}

/**
 * POST /v1/agents/:id/stop —— 停止指定代理。
 *
 * 授权意图见 {@link resolveStopAgentAuthIntent}：`sessionId` ⇒ Tier2 归属校验；
 * 显式 `privileged: true` ⇒ 运维级停止；二者皆无 ⇒ 400（不再隐式授予特权）。
 */
export async function handleStopAgent(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const tools = await getCoreAPI().getToolsPort();
    if (!tools.isAgentToolAvailable()) {
      sendJson(res, 503, { error: 'Agent 工具当前不可用（工具管理器未注册）' });
      return;
    }

    const rawBody = await ctx.readRequestBody(req);
    let parsedBody: unknown = {};
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
    }

    const intent = resolveStopAgentAuthIntent(parsedBody);
    if (!intent.ok) {
      sendJson(res, 400, { error: intent.reason, hint: intent.hint });
      return;
    }

    const stopped = tools.stopAgent(agentId, {
      requesterSessionId: intent.requesterSessionId,
      privileged: intent.privileged,
    });

    if (!stopped) {
      // 三种可能：不存在 / 已停止 / 请求方会话与归属不一致（后者见服务端 warn 日志）
      sendJson(res, 409, {
        stopped: false,
        error:
          '未停止：该代理不存在、已停止，或请求方会话与其归属不一致（详见服务端日志）',
      });
      return;
    }
    sendJson(res, 200, { stopped: true, agentId });
  } catch (err) {
    ctx.sendError(res, err);
  }
}
