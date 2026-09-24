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

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { Message } from '@modules/chat/types/message';
import { MessageRole } from '@modules/chat/types/message';
import { dedupeMessagesToolCallBlocks } from '@modules/chat';
import type { LiriEventType } from '@modules/chat/types/events';
import { deriveSessionStats, getYieldRegistry } from '@modules/session';
import {
  tryParseJson,
  sendBadRequest,
  sendNotFound,
  normalizeTimestamp,
} from './session-handlers-utils';

const logger = getLogger('infra:http:session-handlers');

/**
 * 阶段一（2026-09-04）：项目会话判定收敛 helper。
 * 事实面收敛到 `metadata.projectId`；moduleType==='project' 或 legacy
 * `workspaceId` 前缀 `project-` 兜底（兼容期双读；后续存量 backfill 后仅剩 projectId）。
 */
function legacyProjectModuleType(
  md: Record<string, unknown> | undefined
): string | undefined {
  if (md?.moduleType) return md.moduleType as string;
  const ws = md?.workspaceId;
  if (typeof ws === 'string' && /^project-/.test(ws)) return 'project';
  return undefined;
}

/** 会话关联的 projectId（metadata.projectId 优先，legacy workspaceId `project-` 前缀兜底） */
function effectiveProjectId(
  md: Record<string, unknown> | undefined
): string | undefined {
  const pid = md?.projectId;
  if (typeof pid === 'string' && pid) return pid;
  const ws = md?.workspaceId;
  if (typeof ws === 'string') {
    const m = /^project-(.+)$/.exec(ws);
    if (m) return m[1];
  }
  return undefined;
}

// ========== Session Handlers ==========

/**
 * 全文搜索历史消息（FTS5 倒排索引）
 * GET /v1/sessions/messages/search?q=关键词&limit=N
 * 2026-09-18：全局搜索"搜不到历史消息"根因——前端只过滤会话标题，
 * 从未调用后端消息全文搜索；此 handler 暴露 FTS 能力。
 */
export async function handleSearchMessagesFTS(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const q = (url.searchParams.get('q') ?? '').trim();
    // N-66（2026-09-20）：**可选**作用域参数 —— 侧栏搜索传当前 moduleType；全局搜索不传
    const moduleType = (url.searchParams.get('moduleType') ?? '').trim();
    const limit = Math.min(
      Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10,
      50
    );
    if (!q) {
      sendBadRequest(res, '缺少搜索关键词 q');
      return;
    }
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    // N-66：把"作用域"下推为**该模块的会话 id 集合**，交由 FTS 引擎在**截断前**过滤
    // ⇒ 消除"本作用域确有命中、却被全局前 N 条挤出"与"后端有命中、UI 显示无结果"的静默不一致。
    // 未传 `moduleType` 时保持全局语义（行为与修复前完全一致）。
    let allowedSessionIds: Set<string> | undefined;
    if (moduleType) {
      const all = await coreAPI.listSessions();
      allowedSessionIds = new Set(
        all
          .filter((s) => {
            const md = s.metadata as Record<string, unknown> | undefined;
            // 与前端 `resolveSessionModuleType` 同口径：metadata.moduleType 优先、
            // legacy `project-` 前缀兜底，其余（无 moduleType 的普通会话）视为 chat
            return (legacyProjectModuleType(md) ?? 'chat') === moduleType;
          })
          .map((s) => s.id)
      );
    }
    const results = await coreAPI.searchMessagesFTS(
      q,
      limit,
      allowedSessionIds
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

export async function handleListSessions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const lite = url.searchParams.get('lite') === 'true';
    const moduleType = url.searchParams.get('moduleType');
    const projectId = url.searchParams.get('projectId');

    let sessions: unknown;
    if (lite) {
      sessions = await coreAPI.listLiteSessions();
    } else {
      let full = await coreAPI.listSessions();
      if (moduleType || projectId) {
        full = full.filter((s) => {
          const md = s.metadata as Record<string, unknown> | undefined;
          // 阶段一（2026-09-04）：moduleType/projectId 判定收敛——
          // metadata.projectId 优先；moduleType==='project' 或 legacy
          // workspaceId 前缀 `project-` 兜底（兼容期双读，见 v3 方案 §四 4.2.3）
          if (
            moduleType &&
            (md?.moduleType || legacyProjectModuleType(md)) !== moduleType
          )
            return false;
          if (projectId && effectiveProjectId(md) !== projectId) return false;
          return true;
        });
      }
      sessions = full;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理创建会话请求
 */
export async function handleCreateSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const {
      title,
      model,
      workspaceId,
      workspace_path,
      moduleType,
      projectId,
      temporary,
    } = data;
    // L4-fix: title 类型校验 —— 原实现直接 `title as string | undefined` 硬断言，
    // 传入非 string（对象/数组/数字）会被静默写入，导致前端展示异常。
    if (title !== undefined && typeof title !== 'string') {
      sendBadRequest(res, 'title must be a string');
      return;
    }
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    // 将 model、workspaceId、moduleType、projectId 存入 session metadata
    const metadata: Record<string, unknown> = {};
    if (model) metadata.model = model as string;
    if (workspaceId) metadata.workspaceId = workspaceId as string;
    if (workspace_path) metadata.workspacePath = workspace_path as string;
    if (moduleType) metadata.moduleType = moduleType as string;
    if (projectId) metadata.projectId = projectId as string;
    // A1 临时对话：temporary=true 写入 metadata 持久化标记（CS02，禁止字符串匹配）
    if (temporary === true) metadata.temporary = true;

    const session = await coreAPI.createSession({
      title: title as string | undefined,
      metadata,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
    ctx.broadcastEvent('session:created', { id: session?.id });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取会话详情请求
 */
export async function handleGetSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    const session = await coreAPI.getSession(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Session not found', type: 'not_found' },
        })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * N-45（2026-09-20）：**会话级** yield 状态的读时派生（不新建表 —— 让出标记本已持久化）。
 *
 * 背景：yield 收尾时 `turn/end` 已写入 `finishReason:'yielded'`（`ChatManager`）；
 * 真正缺的是"当前结算状态" —— 它是**进程内**的（`YieldRegistry`），重启即丢。
 *
 * 返回：`'waiting'` = 仍在等子代理结算（registry 有登记，权威且零成本）；
 *      `'unresolved'` = 已让出但等待登记不存在（进程重启 / 结算丢失）；`undefined` = 无 yield 语义。
 *
 * **为何做成"会话级"而非标在某条消息上（两轮 UI 实测的结论）**：真实让出轮次的派生消息只有
 * `[user, tool]`（该轮 `contentLength: 0`，助手只有 thinking + tool_call ⇒ 不产出助手条目），
 * 而前端 store（`chat-message-set-messages.ts:95-114`）会把**无 assistant 可回填的 tool 消息整体丢弃**
 * ⇒ 任何"挂在消息上"的状态都随消息一起消失（详见台账 N-48）。故状态与会话绑定、由会话级 UI 消费。
 *
 * **检测口径**：`waiting` 取内存 registry；`unresolved` 取**事件尾窗口内最后一条 `turn/end`
 * 的 finishReason**（结构化事实，避免对工具结果做字符串匹配 —— tool 消息 metadata 实测无工具名）。
 * 成本控制：仅当 registry 未 waiting 且会话非 streaming 时才读事件尾。
 */
export async function deriveYieldState(
  sessionId: string
): Promise<'waiting' | 'unresolved' | undefined> {
  if (getYieldRegistry().isWaiting(sessionId)) return 'waiting';
  if (getCoreAPI().chatManager?.isSessionStreaming(sessionId)) return undefined;
  return (await lastTurnYielded(sessionId)) ? 'unresolved' : undefined;
}

/**
 * 末轮是否以 `sessions_yield` 让出 —— 取事件尾窗口内**最后一条 `turn/end`** 的 finishReason。
 *
 * 窗口取 `recent + limit=200`（尾优先）：让出后若没有续跑轮，该 `turn/end` 必在窗口内；
 * 窗口内取不到 `turn/end` 时判为"未让出"（**fail-safe**：宁可不提示，也不误报"未恢复"）。
 */
async function lastTurnYielded(sessionId: string): Promise<boolean> {
  try {
    const { events } = await getCoreAPI().getSessionEvents(sessionId, {
      types: ['turn/end'],
      limit: 200,
      recent: true,
    });
    const lastTurnEnd = events[events.length - 1];
    const reason = (lastTurnEnd?.data as { finishReason?: string } | undefined)
      ?.finishReason;
    return reason === 'yielded';
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'deriveYieldState:lastTurnEnd',
    });
    return false;
  }
}

/**
 * 处理获取会话消息列表请求
 */
export async function handleGetSessionMessages(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // P1-21：启动后首个请求（前端最常见动作）若命中本 handler，确保会话已加载
    await coreAPI.ensureSessionsLoaded();
    // TB-14（2026-09-24）：会话已被外部进程软删除 ⇒ 统一 404。否则下面的内存分支会
    // 返回**陈旧投影消息**（实测：删除后仍返回被删会话的消息），与详情接口 404 自相矛盾。
    if (!(await coreAPI.getSession(sessionId))) {
      sendNotFound(res, 'Session not found');
      return;
    }
    // KB-LONG-SESSION（2026-08-29）：分页参数——limit 传 >0 时取末尾 limit 条，
    // before 为 lastEventSeq 游标（加载更早历史）。不传 limit 返回全量（行为不变）。
    const url = new URL(req.url ?? '', 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const beforeParam = url.searchParams.get('before');
    const result = await coreAPI.getSessionMessages(sessionId, {
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
      before: beforeParam ? parseInt(beforeParam, 10) : undefined,
    });
    // Fix1（2026-09-05）：读路径统一按 toolCallId 去重（与前端/写路径同策略）——
    // 历史双写或 SSE 重复发送导致的同 call 重复块不再外溢到接口（实测 189 块 → 186 唯一）。
    let payload: unknown = result;
    if (Array.isArray(result)) {
      payload = dedupeMessagesToolCallBlocks(result);
    } else if (
      result &&
      typeof result === 'object' &&
      Array.isArray((result as { messages?: unknown[] }).messages)
    ) {
      payload = {
        ...result,
        messages: dedupeMessagesToolCallBlocks(
          (result as { messages: Array<Record<string, unknown>> }).messages
        ),
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // N-55 分段计时（2026-09-20）：响应序列化（映射/派生在 CoreAPI 内，这里测 stringify + 写入）
    // 日志级别为 DEBUG（2026-09-20 由 INFO 降级）：常规会话读每次产生 2 行计时噪音，
    // 需要观测时把日志级别调到 DEBUG 即可。
    const serStart = Date.now();
    const body = JSON.stringify(payload);
    logger.debug('[perf] getSessionMessages.serialize', {
      sessionId,
      serializeMs: Date.now() - serStart,
      bytes: body.length,
    });
    res.end(body);
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理添加会话消息请求（写前持久化：前端发送前先落盘用户消息，断网时失败由前端 outbox 补发）
 * body: { id, role, content, timestamp, session_id, replyToId, metadata }
 * 幂等：按消息 id 查重，已存在则直接返回 idempotent: true
 */
export async function handleAddSessionMessage(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }

    if (!data.id || typeof data.id !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'message id is required',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }
    if (typeof data.content !== 'string' || data.content.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'message content is required',
            type: 'invalid_request_error',
          },
        })
      );
      return;
    }

    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    // TB-14（2026-09-24）：会话已被外部进程软删除 ⇒ 404（否则写盘会 mkdir 重建目录＝
    // 幽灵复活；亦避免对"注定被丢弃的写入"回 success:true 误导调用方）
    if (!(await coreAPI.getSession(sessionId))) {
      sendNotFound(res, 'Session not found');
      return;
    }

    const chatManager = coreAPI.getChatManager();
    // 幂等：按消息 id 查重（内存优先；miss 时读盘兜底，覆盖后端重启后 outbox 补发场景）
    const inMemory = chatManager
      .getSessionMessages(sessionId)
      .find((m) => m.id === data.id);
    if (inMemory) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: true, idempotent: true, messageId: data.id })
      );
      return;
    }
    const fromDisk = await coreAPI.getSessionMessages(sessionId);
    const existing = fromDisk.messages.find((m) => m.id === data.id);
    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ success: true, idempotent: true, messageId: data.id })
      );
      return;
    }

    // P2-23：时间戳单位归一化（秒级 ×1000 转毫秒，防 1970 年错乱）
    const createdAt = new Date(
      (normalizeTimestamp(data.timestamp) as number | undefined) ?? Date.now()
    );
    const message: Message = {
      id: data.id,
      role:
        data.role === 'assistant' ? MessageRole.ASSISTANT : MessageRole.USER,
      content: data.content,
      createdAt,
      updatedAt: createdAt,
      sessionId,
      metadata: {
        ...(data.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {}),
        // 2026-08-30：replyToId 有值才写入（undefined 键在 D1 无损 JSON 校验下会拒绝事件）
        ...(data.replyToId ? { replyToId: data.replyToId } : {}),
        persistedBy: 'frontend-write-ahead',
      },
    };
    chatManager.addMessage(sessionId, message);
    logger.info('写前落盘用户消息', {
      sessionId,
      messageId: data.id,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ success: true, idempotent: false, messageId: data.id })
    );
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理更新消息 blocks 请求
 */
export async function handleUpdateMessageBlocks(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
  messageId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    // P2-23：blocks 必须为数组，非数组时按空处理（原实现字符串等类型直接透传）
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];

    const coreAPI = getCoreAPI();
    await coreAPI.updateMessageBlocks(sessionId, messageId, blocks);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理删除会话请求
 */
export async function handleDeleteSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.deleteSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:deleted', { id: sessionId });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理清除所有会话请求
 */
export async function handleClearAllSessions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.clearAllSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:cleared', {});
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 批删入参里的会话 id 白名单（与路由层 `isValidSessionIdFormat` 同口径的宽松版）：
 * 仅允许字母/数字/下划线/连字符，长度 1-128 —— 拦截 `../`、绝对路径、空串等穿越载荷。
 */
const BATCH_DELETE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** 单次批删的 id 数量上限（防单请求放大为无界删除循环） */
const BATCH_DELETE_MAX_IDS = 5000;

/**
 * 处理按显式 id 列表批删会话请求（A′，2026-09-23）
 * POST /v1/sessions/batch-delete，body: { ids: string[] }
 *
 * 背景：前端"清空历史"原为逐条 `DELETE /v1/sessions/:id`，会话多时（实测 724 条）撞浏览器
 * 同源 6 连接上限 ⇒ 表现为"点了清不掉"。方案 A（`DELETE /v1/sessions?moduleType=chat`）真机
 * 实测失败：后端过滤键是 `metadata.moduleType`，而存量会话普遍缺失该字段（734 条仅删掉 2 条），
 * 前端却是自行推导模块类型 ⇒ **两侧口径不一致**。A′ 改为**前端显式传 id 列表**：作用域完全由
 * 前端判定，后端不做任何模块推断，从根上消除口径差异（1 个请求消灭 N 个请求的连接风暴）。
 *
 * 校验（任一不满足 ⇒ 400，且**不调用任何 delete**）：ids 为非空数组、元素全为字符串、
 * 每个元素匹配 `BATCH_DELETE_ID_RE`、长度 ≤ `BATCH_DELETE_MAX_IDS`。
 *
 * 响应：200 `{ success, deleted, failed }`（全部成功或部分成功）；400 参数非法；
 *      500 `{ error: { message: 'batch delete failed' } }`（全部失败）。
 */
export async function handleBatchDeleteSessions(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const ids = data.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      sendBadRequest(res, 'ids must be a non-empty array of strings');
      return;
    }
    if (ids.length > BATCH_DELETE_MAX_IDS) {
      sendBadRequest(
        res,
        `ids must not exceed ${BATCH_DELETE_MAX_IDS} entries`
      );
      return;
    }
    if (
      !ids.every((id) => typeof id === 'string' && BATCH_DELETE_ID_RE.test(id))
    ) {
      sendBadRequest(res, 'invalid session id in ids');
      return;
    }

    const coreAPI = getCoreAPI();
    let deleted = 0;
    let failed = 0;
    // 逐个删除，**每个 id 单独 try/catch**：单个失败不中断其余（前端已按 id 判定作用域，
    // 这里只如实计数，不因一条异常放弃整批）。
    for (const id of ids as string[]) {
      try {
        await coreAPI.deleteSession(id);
        deleted += 1;
      } catch (e) {
        failed += 1;
        await handleError(e, { module: 'infra:http', action: 'batch-delete' });
      }
    }

    if (deleted === 0) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'batch delete failed' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, deleted, failed }));
    ctx.broadcastEvent('session:cleared', {});
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取当前会话请求
 */
export async function handleGetCurrentSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    const session = await coreAPI.getCurrentSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // P1-4：无当前会话时返回 null 而非 JSON.stringify(undefined) 的空产物
    res.end(JSON.stringify(session ?? null));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理切换会话请求
 */
export async function handleSwitchSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // P1-21：切换前确保会话已加载（避免命中未加载路径）
    await coreAPI.ensureSessionsLoaded();
    await coreAPI.switchSession(sessionId);
    const session = await coreAPI.getSession(sessionId);
    if (!session) {
      logger.warn('会话切换后 getSession 返回 undefined', { sessionId });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Session not found', type: 'not_found' },
        })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(session));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        // P2-3：透传 AppError.statusCode（会话不存在 → 404），与 message-handlers 模式一致
        const statusCode =
          err instanceof Error &&
          (err as unknown as { statusCode?: number }).statusCode
            ? (err as unknown as { statusCode?: number }).statusCode!
            : 500;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              message:
                err instanceof Error ? err.message : 'Internal server error',
              type: statusCode === 404 ? 'not_found' : undefined,
            },
          })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理重命名会话请求
 */
export async function handleRenameSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const { title } = data;
    const coreAPI = getCoreAPI();
    await coreAPI.renameSession(sessionId, title as string);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:renamed', {
      id: sessionId,
      title: title as string,
    });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理生成会话标题请求
 */
export async function handleGenerateTitle(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const { userMessage, assistantResponse } = data;
    const coreAPI = getCoreAPI();
    // P1-21：启动后首个请求若命中本 handler，确保会话已加载
    await coreAPI.ensureSessionsLoaded();
    const title = await coreAPI.generateSessionTitle(
      sessionId,
      userMessage as string,
      assistantResponse as string
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, title }));
    if (title) {
      // E-3（2026-08-23）：AI 生成标题 → source='ai' → titleStage='final'
      await coreAPI.renameSession(sessionId, title, 'ai');
      ctx.broadcastEvent('session:renamed', { id: sessionId, title });
    }
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理更新会话元数据请求
 * PATCH /v1/sessions/:id/meta
 */
export async function handleUpdateSessionMeta(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = tryParseJson(body);
    if (!data) {
      sendBadRequest(res, 'invalid JSON body');
      return;
    }
    const coreAPI = getCoreAPI();

    // M1-T1.3（2026-08-31）：pinned 严格 boolean 校验（防字符串 "false" 误置真）
    if (data.pinned !== undefined && typeof data.pinned !== 'boolean') {
      sendBadRequest(res, 'pinned must be a boolean');
      return;
    }

    await coreAPI.updateSessionMeta(sessionId, {
      model: data.model as string | undefined,
      workspaceId: data.workspace_id as string | undefined,
      providerId: data.provider_id as string | undefined,
      tasksOverride: data.tasks_override as Record<string, string> | undefined,
      pinned: data.pinned as boolean | undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    ctx.broadcastEvent('session:meta_updated', { id: sessionId, ...data });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理触发会话压缩请求
 * POST /v1/sessions/:id/compact
 */
export async function handleCompactSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // P2-5 修复：调用 CoreAPIImpl 正式方法（委托 ChatManager.compactSession）。
    // 原实现反射取 coreAPI.sessionGateway（CoreAPIImpl 无此属性）恒 undefined → 恒 501。
    const result = await coreAPI.compactSession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, result }));
    ctx.broadcastEvent('session:compacted', { id: sessionId });
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理触发会话修剪请求
 * POST /v1/sessions/prune（全量修剪，P2-22 修复：原 :id 路由与全量实现语义不符）
 */
export async function handlePruneSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    // 修剪修复：调用 CoreAPIImpl 正式方法（委托 ChatManager → SessionGateway.pruneNow）。
    // 原实现反射取 coreAPI.sessionGateway（CoreAPIImpl 无此属性）恒 undefined → 恒 501。
    const result = await coreAPI.pruneSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, result }));
    ctx.broadcastEvent('session:pruned', {});
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * 处理获取会话记忆请求
 * GET /v1/sessions/:id/memory
 */
export async function handleGetSessionMemory(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    // TB-14（2026-09-24）：会话已被外部进程软删除 ⇒ 404（与详情接口同口径，
    // 否则会返回 200 空记忆，掩盖"会话已不存在"）
    if (!(await coreAPI.getSession(sessionId))) {
      sendNotFound(res, 'Session not found');
      return;
    }
    const { getSessionMemoryManager } =
      await import('../../../session/bootstrap/SessionSystemBootstrap');
    const mm = getSessionMemoryManager();
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const query = url.searchParams.get('q') || undefined;
    const topK = parseInt(url.searchParams.get('topK') || '5', 10);

    let items;
    if (query) {
      items = await mm.searchMemory(sessionId, query, topK);
    } else {
      const memory = mm.loadMemory(sessionId);
      items = memory.items;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items, sessionId }));
  } catch (err) {
    await handleError(err, { module: 'infra:http', action: 'handler_error' });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch (err) {
        handleError(err, {
          module: 'infrastructure:http:handlers:session-handlers',
          action: 'responseAlreadyEnded',
        });
      } /* res可能已结束, 忽略 */
    }
  }
}

/**
 * M1 事件溯源：处理获取会话事件流请求
 * GET /v1/sessions/:id/events?fromSeq=X&toSeq=Y&types=a,b&limit=N
 *
 * 查询参数：
 *   - fromSeq: 起始 seq（包含），默认 1
 *   - toSeq: 结束 seq（包含），默认 Infinity
 *   - types: 逗号分隔的事件类型白名单
 *   - limit: 最大返回数，默认 1000，上限 10000
 *   - recent: 1/true 时且未传 fromSeq → 尾部优先（最后 limit 条），日志/轨迹面板显示最近事件
 *
 * 响应：
 *   200: { events: LiriEvent[], tailSeq: number, hasMore: boolean }
 *   400: 参数错误
 *   500: 服务器错误
 *
 * 首次访问时若 events.jsonl 不存在但 messages.jsonl 存在，自动触发迁移。
 */
export async function handleGetSessionEvents(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    // 解析查询参数
    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const fromSeqParam = url.searchParams.get('fromSeq');
    const toSeqParam = url.searchParams.get('toSeq');
    // P1-1（2026-09-22）：向前补页 —— 取 `seq < beforeSeq` 的紧邻一页
    const beforeSeqParam = url.searchParams.get('beforeSeq');
    const typesParam = url.searchParams.get('types');
    const limitParam = url.searchParams.get('limit');
    const recentParam = url.searchParams.get('recent');

    const fromSeq = fromSeqParam ? Number(fromSeqParam) : undefined;
    const toSeq = toSeqParam ? Number(toSeqParam) : undefined;
    const beforeSeq = beforeSeqParam ? Number(beforeSeqParam) : undefined;
    const types = typesParam
      ? (typesParam.split(',').filter(Boolean) as LiriEventType[])
      : undefined;
    const limit = limitParam ? Math.min(Number(limitParam), 10000) : 1000;
    const recent = recentParam === '1' || recentParam === 'true';

    // 参数校验
    if (fromSeq !== undefined && (!Number.isFinite(fromSeq) || fromSeq < 1)) {
      sendBadRequest(res, 'fromSeq must be a positive number');
      return;
    }
    if (toSeq !== undefined && (!Number.isFinite(toSeq) || toSeq < 1)) {
      sendBadRequest(res, 'toSeq must be a positive number');
      return;
    }
    if (
      beforeSeq !== undefined &&
      (!Number.isFinite(beforeSeq) || beforeSeq < 1)
    ) {
      sendBadRequest(res, 'beforeSeq must be a positive number');
      return;
    }
    if (limit < 1) {
      sendBadRequest(res, 'limit must be a positive number');
      return;
    }

    // 获取事件流（coreAPI 内部触发首次迁移）
    const result = await coreAPI.getSessionEvents(sessionId, {
      fromSeq,
      toSeq,
      beforeSeq,
      types,
      limit,
      recent,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http:session-handlers',
      action: 'getSessionEvents',
      context: { sessionId },
    });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {
        /* res可能已结束, 忽略 */
      }
    }
  }
}

/**
 * GET /v1/sessions/:id/stats — D7（2026-08-24）事件投影统计
 *
 * 基于事件流派生会话结构统计（消息/工具/轮次/压缩），与回放数出同源。
 * 与 /v1/usage（token 成本）维度不同，不重叠。
 *
 * 响应：
 *   200: EventSessionStats
 *   500: 服务器错误
 */
export async function handleGetSessionStats(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();
    // TB-14（2026-09-24）：会话已被外部进程软删除 ⇒ 404（事件已随目录移走，
    // 否则会返回 200 全零统计，掩盖"会话已不存在"）
    if (!(await coreAPI.getSession(sessionId))) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // 读全量事件（无分页参数；首次访问自动触发迁移）
    const { events } = await coreAPI.getSessionEvents(sessionId, {
      limit: 100000,
    });

    const stats = deriveSessionStats(events);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (err) {
    await handleError(err, {
      module: 'infra:http:session-handlers',
      action: 'getSessionStats',
      context: { sessionId },
    });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {
        /* res可能已结束, 忽略 */
      }
    }
  }
}

/**
 * POST /v1/sessions/:id/fork — D3（2026-08-24）事件级 fork
 *
 * body: { boundary?: number, childTitle?: string }
 *  - boundary 缺省 = 源会话 tailSeq（fork 全量历史）；须为 [1..tailSeq] 内整数
 *  - boundary 落在 open turn（未闭合 turn/start）内 → 400
 *
 * 响应：
 *   200: { session, boundary, copied }（血缘在 session.metadata.parentSessionId/seedLength）
 *   400: { error }（boundary 无效 / open turn）
 *   404: { error }（源会话不存在）
 *   500: 服务器错误
 */
export async function handleForkSession(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const data = body ? tryParseJson(body) : null;
    const boundary =
      data && typeof data.boundary === 'number' ? data.boundary : undefined;
    const childTitle =
      data && typeof data.childTitle === 'string' ? data.childTitle : undefined;

    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    const result = await coreAPI.forkSession(sessionId, {
      boundary,
      childTitle,
    });

    if (!result.success) {
      const notFound = result.error?.includes('source session not found');
      res.writeHead(notFound ? 404 : 400, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({ error: { message: result.error ?? 'fork failed' } })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        session: result.session,
        boundary: result.boundary,
        copied: result.copied,
      })
    );
  } catch (err) {
    await handleError(err, {
      module: 'infra:http:session-handlers',
      action: 'forkSession',
      context: { sessionId },
    });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {
        /* res可能已结束, 忽略 */
      }
    }
  }
}

/**
 * GET /v1/sessions/:id/events/export?format=jsonl|json&fromSeq&toSeq — P7（2026-08-25）事件导出
 *
 * 复用 coreAPI.getSessionEvents 分页拉取全部事件（避免一次拉爆内存），
 * 序列化为 jsonl（每行一条）或 json（{ events, count }）。
 *
 * 响应：
 *   200: 导出文本（Content-Type: application/x-ndjson 或 application/json）
 *   400/500: 错误
 */
export async function handleExportSessionEvents(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const coreAPI = getCoreAPI();
    await coreAPI.ensureSessionsLoaded();

    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const format = (url.searchParams.get('format') ?? 'jsonl') as
      | 'jsonl'
      | 'json';
    const fromSeqParam = url.searchParams.get('fromSeq');
    const toSeqParam = url.searchParams.get('toSeq');

    if (format !== 'jsonl' && format !== 'json') {
      sendBadRequest(res, 'format must be jsonl or json');
      return;
    }
    const fromSeq = fromSeqParam ? Number(fromSeqParam) : undefined;
    const toSeq = toSeqParam ? Number(toSeqParam) : undefined;
    if (
      (fromSeq !== undefined && (!Number.isFinite(fromSeq) || fromSeq < 1)) ||
      (toSeq !== undefined && (!Number.isFinite(toSeq) || toSeq < 1))
    ) {
      sendBadRequest(res, 'fromSeq/toSeq must be positive numbers');
      return;
    }

    // 分页拉取全部（limit 上限 10000）
    const PAGE = 10000;
    const all: unknown[] = [];
    let cursor = fromSeq;
    for (;;) {
      const page = await coreAPI.getSessionEvents(sessionId, {
        fromSeq: cursor,
        toSeq,
        limit: PAGE,
      });
      all.push(...page.events);
      if (!page.hasMore || page.events.length === 0) break;
      cursor = (page.events[page.events.length - 1] as { seq: number }).seq + 1;
      // 防御：连续分页不前进则终止（toSeq 已包含时）
      if (toSeq !== undefined && cursor > toSeq) break;
    }

    if (format === 'jsonl') {
      const body = all
        .map((e) => JSON.stringify(e))
        .join('\n')
        .concat(all.length > 0 ? '\n' : '');
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="events-${sessionId}.jsonl"`,
      });
      res.end(body);
    } else {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="events-${sessionId}.json"`,
      });
      res.end(JSON.stringify({ events: all, count: all.length }));
    }
  } catch (err) {
    await handleError(err, {
      module: 'infra:http:session-handlers',
      action: 'exportSessionEvents',
      context: { sessionId },
    });
    if (!res.headersSent) {
      try {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Internal server error' } })
        );
      } catch {
        /* res可能已结束, 忽略 */
      }
    }
  }
}
