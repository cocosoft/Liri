/**
 * goal-routes.ts — dispatchGoalRoutes
 *
 * 长程任务**目标（Goal）**入口（M-6 接线，2026-09-22）：
 * - `POST /v1/goals` 创建目标（body：`{ objective, sessionId?, tokenBudget?, id? }`）
 * - `GET  /v1/goals` 列出目标（`?sessionId=` 按会话；`?active=1` 仅未终结）
 *
 * 为什么需要：`TaskGoalStore`（M-6）落地后**没有创建入口** ⇒ 真实会话无法产生目标，
 * §15.11（批次收口落状态）与 §15.12（用量记账 / 触顶收尾）永远不会被触发。
 *
 * 契约（见 `.trae/docs/api-spec.md`）：
 * - `objective` 必填（trim 非空）⇒ 空则 **400**；
 * - `tokenBudget` 可选，必须为**正有限数** ⇒ 否则 **400**；
 * - `sessionId` 可选，若提供须符合会话 id 白名单格式 ⇒ 否则 **400**；
 * - `id` 可选，若已存在 ⇒ **409**（不静默覆盖既有目标）。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import {
  json,
  readBody,
  sendError,
  isValidSessionIdFormat,
} from '../handler-utils';
import { getTaskGoalStore } from '@modules/tasks';
import { isTerminalGoalStatus } from '@modules/tasks';
import { emitGoalCreated, emitGoalUpdated } from '@modules/tasks';

/** 解析并校验创建目标的请求体（返回 null 表示已写出错误响应） */
function parseCreateBody(
  raw: string,
  res: http.ServerResponse
): {
  objective: string;
  sessionId?: string;
  tokenBudget?: number;
  id?: string;
} | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    json(res, 400, { error: { message: '请求体不是合法 JSON' } });
    return null;
  }

  const objective =
    typeof body['objective'] === 'string' ? body['objective'].trim() : '';
  if (!objective) {
    json(res, 400, { error: { message: 'objective 必填且不能为空' } });
    return null;
  }

  const sessionId =
    typeof body['sessionId'] === 'string' ? body['sessionId'] : undefined;
  if (sessionId !== undefined && !isValidSessionIdFormat(sessionId)) {
    json(res, 400, { error: { message: 'sessionId 格式非法' } });
    return null;
  }

  const id = typeof body['id'] === 'string' ? body['id'] : undefined;

  let tokenBudget: number | undefined;
  if (body['tokenBudget'] !== undefined && body['tokenBudget'] !== null) {
    const raw = body['tokenBudget'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      json(res, 400, {
        error: { message: 'tokenBudget 必须为正有限数' },
      });
      return null;
    }
    tokenBudget = raw;
  }

  return { objective, sessionId, tokenBudget, id };
}

async function handleCreateGoal(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsed = parseCreateBody(await readBody(req), res);
  if (!parsed) return;

  const store = getTaskGoalStore();
  if (parsed.id) {
    const existing = await store.get(parsed.id);
    if (existing) {
      json(res, 409, {
        error: { message: `目标 ${parsed.id} 已存在（不覆盖既有目标）` },
      });
      return;
    }
  }

  const goal = await store.create({
    objective: parsed.objective,
    sessionId: parsed.sessionId,
    tokenBudget: parsed.tokenBudget,
    id: parsed.id,
  });
  // B2-2（2026-09-23）：目标生命周期事件族的第一条 —— 创建成功后落 `goal/created`。
  // 目标无归属会话（`sessionId` 缺省）⇒ **不产事件**（会话事件无处可落，不硬凑）。
  await emitGoalCreated({
    goalId: goal.id,
    objective: goal.objective,
    sessionId: goal.sessionId,
    tokenBudget: goal.tokenBudget,
  });
  json(res, 201, { goal });
}

/**
 * `GET /v1/goals?sessionId=<id>&active=1`
 *
 * - 给了 `sessionId` ⇒ 该会话的目标（`active=1` 时只回未终结）；
 * - 未给 `sessionId` ⇒ **仅允许 `active=1`**（避免无界全表扫描；全量列表不是本接口的用途）。
 *
 * **查询串必须从 `req.url` 取**：`LocalHTTPService` 传给 `dispatchRoute` 的 `url`
 * 已 `split('?')[0]` 去掉查询串（`LocalHTTPService.ts:380`）⇒ 依赖它会让
 * `?sessionId=` / `?active=1` 在生产**静默失效**。既有同款写法见
 * `agent-control-handlers.ts:99`（该处注释已明确"不依赖传入的 url"）。
 */
async function handleListGoals(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const params = new URL(req.url ?? '/', 'http://internal').searchParams;
  const sessionId = params.get('sessionId') ?? undefined;
  const activeOnly = params.get('active') === '1';

  if (sessionId !== undefined && !isValidSessionIdFormat(sessionId)) {
    json(res, 400, { error: { message: 'sessionId 格式非法' } });
    return;
  }
  if (sessionId === undefined && !activeOnly) {
    json(res, 400, {
      error: {
        message: '需提供 sessionId，或使用 active=1 仅查询未终结目标',
      },
    });
    return;
  }

  const store = getTaskGoalStore();
  const goals = activeOnly
    ? await store.listActive(sessionId)
    : await store.listBySession(sessionId as string);
  json(res, 200, { goals, count: goals.length });
}

/**
 * `PATCH /v1/goals/{id}`（B2-2 / X4，2026-09-23）
 *
 * 用途：给 `objective_updated` 模板（§5.3.2）与 `goal/updated` 事件（§4.1）提供**真实来源** ——
 * 此前只有 POST/GET ⇒ "更新目标"无入口，`updated` 事件永远不会有生产者。
 *
 * 契约（`.trae/docs/api-spec.md` §3.8.1）：
 * - body `{ objective?: string（trim 非空）, tokenBudget?: number（正有限数） }`，
 *   至少一项 ⇒ 否则 **400**；
 * - 目标不存在 ⇒ **404**；**已是终态 ⇒ 409**（终态不可改写，`project_rules.md §1.1` 同源口径）；
 * - 成功 ⇒ **200** + `{ goal }`；**只列真实变更项**落 `goal/updated`，并写
 *   `updated_reason = 'manual'`（下次 idle 续接据此改用 `objective_updated` 模板）；
 * - 无实际变更（值与现状相同）⇒ 200 但**不写库、不产事件**（不谎报"更新了"）。
 */
async function handlePatchGoal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  goalId: string
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
  } catch {
    json(res, 400, { error: { message: '请求体不是合法 JSON' } });
    return;
  }

  const hasObjective = body['objective'] !== undefined;
  const hasBudget = body['tokenBudget'] !== undefined;
  if (!hasObjective && !hasBudget) {
    json(res, 400, {
      error: { message: '至少需提供 objective 或 tokenBudget 之一' },
    });
    return;
  }

  let objective: string | undefined;
  if (hasObjective) {
    objective =
      typeof body['objective'] === 'string' ? body['objective'].trim() : '';
    if (!objective) {
      json(res, 400, { error: { message: 'objective 不能为空' } });
      return;
    }
  }
  let tokenBudget: number | undefined;
  if (hasBudget) {
    const raw = body['tokenBudget'];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      json(res, 400, { error: { message: 'tokenBudget 必须为正有限数' } });
      return;
    }
    tokenBudget = raw;
  }

  const store = getTaskGoalStore();
  const before = await store.get(goalId);
  if (!before) {
    json(res, 404, { error: { message: `目标 ${goalId} 不存在` } });
    return;
  }
  if (isTerminalGoalStatus(before.status)) {
    json(res, 409, {
      error: {
        message: `目标 ${goalId} 已是终态（${before.status}），不可改写`,
      },
    });
    return;
  }

  // **只列真实变更项**（值未变 ⇒ 不算变更，不写库、不产事件）
  const changes: { objective?: string; tokenBudget?: number } = {};
  if (objective !== undefined && objective !== before.objective) {
    changes.objective = objective;
  }
  if (tokenBudget !== undefined && tokenBudget !== before.tokenBudget) {
    changes.tokenBudget = tokenBudget;
  }
  if (Object.keys(changes).length === 0) {
    json(res, 200, { goal: before });
    return;
  }

  const updated = await store.updateFields(goalId, changes, 'manual');
  if (!updated) {
    // 条件更新未命中（并发下落终态）⇒ 与"已是终态"同口径回 409，不谎报成功
    json(res, 409, {
      error: { message: `目标 ${goalId} 已不可改写（终态）` },
    });
    return;
  }
  await emitGoalUpdated({
    sessionId: updated.sessionId,
    goalId: updated.id,
    changes,
    reason: 'manual',
  });
  json(res, 200, { goal: updated });
}

/**
 * dispatchGoalRoutes — 目标领域路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchGoalRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  const [path] = url.split('?');

  try {
    if (path === '/v1/goals') {
      if (method === 'POST') {
        await handleCreateGoal(req, res);
        return true;
      }
      if (method === 'GET') {
        await handleListGoals(req, res);
        return true;
      }
      return false;
    }
    // `/v1/goals/{id}`（B2-2 / X4）：仅 PATCH（改写目标陈述 / 预算）
    const match = /^\/v1\/goals\/([^/]+)$/.exec(path);
    if (match && method === 'PATCH') {
      await handlePatchGoal(req, res, decodeURIComponent(match[1]));
      return true;
    }
  } catch (err) {
    sendError(res, err);
    return true;
  }

  return false;
}
