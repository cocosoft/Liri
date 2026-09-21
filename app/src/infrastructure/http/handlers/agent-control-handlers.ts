/**
 * 子代理**控制面** HTTP 处理器（方案 O10a① + E2 用户入口）
 *
 * - `GET  /v1/agents/control`        查询暂停态 + 活跃代理（只读投影，不外泄 sessionId）
 * - `GET  /v1/agents/runs`           查询最近运行台账（磁盘，含 `descriptor_source`；T8）
 * - `POST /v1/agents/pause`          暂停 spawn（**阻断新增、在途不受影响**）
 * - `POST /v1/agents/resume`         恢复 spawn
 * - `POST /v1/agents/:id/stop`       停止指定代理（body 可带 `sessionId` ⇒ 启用 Tier2 归属校验）
 *
 * O10a① 语义：**带** `sessionId` 时做"请求方会话 == 代理归属"校验（不一致 ⇒ 拒绝）；
 * **不带**时按进程内特权调用处理（与 CLI/Coordinator 的既有行为一致）。
 */

import type http from 'http';
import { getLogger } from '@modules/monitoring';
import { getToolManager, getAgentRunStore } from '@modules/tools';
import type { HandlerCtx } from './handler-utils';
import { AgentTool } from '../../../tools/AgentTool/AgentTool';
import {
  setSpawnPaused,
  getSpawnPauseState,
} from '../../../tools/AgentTool/spawnPause';

const logger = getLogger('http:agentControl');

/** 复用既有约定（`commands/tools/ai/agent.ts:91`）：从工具管理器取 AgentTool 实例 */
function getAgentTool(): AgentTool | null {
  try {
    const tool = getToolManager().getTool('Agent');
    return tool instanceof AgentTool ? tool : null;
  } catch (err) {
    // @ignore-catch — 工具管理器未就绪时视为不可用（调用方按 503 处理）
    logger.warn('获取 AgentTool 实例失败', { error: String(err) });
    return null;
  }
}

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
    const agentTool = getAgentTool();
    sendJson(res, 200, {
      spawn: getSpawnPauseState(),
      agents: agentTool?.getActiveAgents() ?? [],
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
    const state = setSpawnPaused(
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
    const parsed = new URL(req.url ?? '/', 'http://internal');
    const rawLimit = Number(parsed.searchParams.get('limit') ?? '50');
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
      : 50;

    const rows = await getAgentRunStore().listRuns(); // 按 started_at 升序
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
    const state = setSpawnPaused(false);
    sendJson(res, 200, { message: '子代理 spawn 已恢复', spawn: state });
  } catch (err) {
    ctx.sendError(res, err);
  }
}

/**
 * POST /v1/agents/:id/stop —— 停止指定代理。
 *
 * `sessionId` 可选：带上即启用 O10a① 的 Tier2 归属校验（不一致 ⇒ 拒绝停止）。
 */
export async function handleStopAgent(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string
): Promise<void> {
  try {
    const agentTool = getAgentTool();
    if (!agentTool) {
      sendJson(res, 503, { error: 'Agent 工具当前不可用（工具管理器未注册）' });
      return;
    }

    const body = await ctx.readRequestBody(req);
    const data = body ? (JSON.parse(body) as { sessionId?: string }) : {};
    const sessionId =
      typeof data.sessionId === 'string' ? data.sessionId : undefined;
    const stopped = agentTool.stopAgent(agentId, {
      requesterSessionId: sessionId,
      // O14：未带会话标识的调用 ⇒ **显式**声明特权（该端点已在鉴权路由内，属运维级控制面），
      // 而不是依赖"不传即特权"的隐式默认；带上 sessionId 则走 fail-closed 归属校验。
      privileged: sessionId === undefined,
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
