/**
 * 驾驶舱 HTTP 端点 — /v1/cockpit（P39-b-2，2026-11-02）
 *
 * GET  /v1/cockpit                  — stage 分组快照 + 指标 + 投递计数
 * GET  /v1/cockpit/:id/history      — 一件工作的完整历史（工作项 + 派工 + 执行）
 * POST /v1/cockpit/:id/takeover     — 一键接管：返回可跳转会话（无可用会话 ⇒ 409）
 *
 * 分层：handler 属 service 层，只经 `getTaskOpsPort()` 取 app 侧聚合（R00-001）。
 * 接管不新建会话（用户裁定 A）—— 没有会话就如实拒绝，不伪造。
 */
import type http from 'http';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
// 2026-11-03 P1：自主执行运行态由 entry 经 DI 端口提供（service 不得反向依赖 entry）
import { dependencyRegistry } from '@openliri/kernel/DependencyRegistry.js';

const logger = getLogger('http:cockpit');

function sendJSON(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** GET /v1/cockpit */
export async function handleGetCockpit(
  res: http.ServerResponse
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    sendJSON(res, 200, await taskOps.getCockpitSnapshot());
  } catch (e) {
    await handleError(e, { module: 'http:cockpit', action: 'snapshot' });
    if (!res.headersSent)
      sendJSON(res, 500, { error: { message: 'internal_error' } });
  }
}

/**
 * GET /v1/autonomy/status —— 自主执行运行态（2026-11-03 P1）
 *
 * 数据由 entry 侧 `getAlwaysOnStatus()` 通过 DI 端口提供（`autonomy:status`）；
 * 未注册（AlwaysOn 未接线 / 测试环境）⇒ `available:false`，前端据此显示"未启动"而不是空表。
 */
export async function handleGetAutonomyStatus(
  res: http.ServerResponse
): Promise<void> {
  try {
    // 端口键是跨层契约（写入端：`entrypoints/alwaysOnEntry.ts`），此处按字面量消费，
    // 与 `model:${taskType}` / `channel:<name>:status` 的既有约定一致。
    const provider =
      dependencyRegistry.inject<() => unknown>('autonomy:status');
    if (typeof provider !== 'function') {
      sendJSON(res, 200, {
        available: false,
        enabled: false,
        running: false,
        projects: [],
        generatedAt: Date.now(),
      });
      return;
    }
    const snapshot = provider() as Record<string, unknown>;
    sendJSON(res, 200, {
      available: true,
      ...snapshot,
      generatedAt: Date.now(),
    });
  } catch (e) {
    await handleError(e, { module: 'http:cockpit', action: 'autonomyStatus' });
    if (!res.headersSent)
      sendJSON(res, 500, { error: { message: 'internal_error' } });
  }
}

/** GET /v1/cockpit/:id/history */
export async function handleGetCockpitHistory(
  res: http.ServerResponse,
  workItemId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const history = await taskOps.getCockpitHistory(workItemId);
    if (!history) {
      sendJSON(res, 404, {
        error: { message: 'work item not found', type: 'not_found' },
      });
      return;
    }
    sendJSON(res, 200, history);
  } catch (e) {
    await handleError(e, { module: 'http:cockpit', action: 'history' });
    if (!res.headersSent)
      sendJSON(res, 500, { error: { message: 'internal_error' } });
  }
}

/**
 * POST /v1/cockpit/:id/takeover
 *
 * 返回 `{ sessionId, workspaceId? }`；调用方跳 `/projects/{workspaceId}/{sessionId}`。
 * - 工作项不存在 ⇒ 404
 * - 无候选会话 / 会话已不存在 ⇒ 409 `no_takeover_session`（不自动建会话）
 */
export async function handleTakeoverCockpitItem(
  res: http.ServerResponse,
  workItemId: string
): Promise<void> {
  try {
    const taskOps = await getCoreAPI().getTaskOpsPort();
    const candidate = await taskOps.getCockpitTakeoverCandidate(workItemId);
    if (!candidate.itemFound) {
      sendJSON(res, 404, {
        error: { message: 'work item not found', type: 'not_found' },
      });
      return;
    }

    let sessionExists = false;
    let workspaceId: string | undefined;
    if (candidate.sessionId) {
      const chatManager = getCoreAPI().getChatManager();
      const stored = await chatManager
        .getSessionGateway()
        .getSession(candidate.sessionId);
      if (stored) {
        sessionExists = true;
        const metadata = stored.metadata as Record<string, unknown> | undefined;
        const id = metadata?.['workspaceId'];
        if (typeof id === 'string' && id) workspaceId = id;
      }
    }

    if (!candidate.sessionId || !sessionExists) {
      logger.info('cockpit takeover rejected: no live session', {
        workItemId,
        sessionId: candidate.sessionId ?? '',
      });
      sendJSON(res, 409, {
        error: {
          message: 'no takeover session',
          type: 'no_takeover_session',
        },
      });
      return;
    }

    sendJSON(res, 200, {
      sessionId: candidate.sessionId,
      ...(workspaceId ? { workspaceId } : {}),
    });
  } catch (e) {
    await handleError(e, { module: 'http:cockpit', action: 'takeover' });
    if (!res.headersSent)
      sendJSON(res, 500, { error: { message: 'internal_error' } });
  }
}
