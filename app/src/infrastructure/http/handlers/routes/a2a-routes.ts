/**
 * a2a-routes.ts — dispatchA2ARoutes
 *
 * **A2A 对外暴露**（P3-1 / F2 / G2，2026-09-29）：
 * - `GET  /.well-known/agent.json` —— Agent Card 发现（T1–T3）
 * - `POST /v1/a2a/tasks`          —— **委派**（T4）：创建任务并把消息交给委派后端
 * - `GET  /v1/a2a/tasks/{id}`     —— 任务状态/产物回查（T4）
 *
 * 边界（2026-09-29 用户裁定）：**ACP 对内、A2A 对外** ⇒ 本模块是**唯一对外**的 Agent 面
 * （ACP 保持默认 loopback 不变）。完整取证与任务清单见 `.trae/specs/a2a-external-exposure.md`。
 *
 * ## 契约（见 `.trae/docs/api-spec.md`）
 * - **未启用 ⇒ 不处理任何 A2A 路径**（`A2A_ENABLED !== 'true'`）⇒ 由上层自然回落 **404**，
 *   **不泄露存在性**（spec G4：默认关闭 / fail-closed）；
 * - 发现端点：`GET` ⇒ `200` + Card（带 `ETag`）；`If-None-Match` 命中 ⇒ **304**；非 GET ⇒ **405**；
 * - 委派：`POST /v1/a2a/tasks`，body `{ message: string（必填）, agentId?: string }`；
 *   **有界等待**（`A2A_DELEGATE_MAX_WAIT_MS`，默认 15000ms）⇒ 在阈值内完成返回 **200 + 终态任务**，
 *   超阈值返回 **202 + `working` 任务**（**不做 HTTP 长挂**，spec G3）；
 * - **未注入委派后端 ⇒ 501**（如实"未接线"，**不伪造**成功）；
 * - `GET /v1/a2a/tasks/{id}` ⇒ `200` + 任务 / **404**（未知 id，含进程重启后 —— 见 `taskStore` 头注释）；
 * - 卡片**不内嵌密钥**（`agentCard.ts:26` 纪律）；`capabilities.streaming`/`pushNotifications` **如实为 `false`**（G2）。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { json, readBody } from '../handler-utils';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
// 复用既有请求鉴权语义（`x-api-key` / `Bearer`）——GR01：不新造第二套头部解析
import { verifyRequestAuth } from '../../LocalHTTPServiceHelpers';
import {
  A2A_PROTOCOL_VERSION,
  a2aTaskStore,
  buildAgentCard,
  computeAgentCardEtag,
  getAgentRegistry,
  type A2AArtifact,
  type A2AMessage,
} from '@modules/agent';

const logger = getLogger('http:a2a');

/** A2A 规范的 Agent Card 发现路径 */
const WELL_KNOWN_AGENT_JSON = '/.well-known/agent.json';
/** 委派端点（本仓自定路径，非 A2A JSON-RPC 绑定；见 api-spec §3.8.2） */
const TASKS_PATH = '/v1/a2a/tasks';

/**
 * 环境变量：是否对外暴露 A2A（**默认关闭**，spec G4）。
 * 命名沿用 ACP 侧 `ACP_REMOTE_HOST` 同族风格（§1.4 前缀表未含 A2A ⇒ 已在 spec 登记）。 */
const ENV_A2A_ENABLED = 'A2A_ENABLED';
/** 环境变量：A2A **专用访问密钥**（2026-09-29 用户裁定「专用密钥 + fail-closed」）。
 *  **未配置 ⇒ 一律 401**（对外面**不回退**到"本地信任基线"）；与 `A2A_ENABLED` 构成**双闸**。 */
const ENV_A2A_API_KEY = 'A2A_API_KEY';
/** 环境变量：卡片中写出的对外基址（可选）；缺省按**请求 Host** 推导 ⇒ **不硬编码** */
const ENV_A2A_PUBLIC_URL = 'A2A_PUBLIC_URL';
/** 环境变量：委派的**有界等待**上限（毫秒；超时即返回 `working`，spec G3） */
const ENV_A2A_DELEGATE_MAX_WAIT_MS = 'A2A_DELEGATE_MAX_WAIT_MS';
const DEFAULT_DELEGATE_MAX_WAIT_MS = 15_000;

/**
 * 委派后端（**端口**，GR01：不新造框架）。
 *
 * 由装配方注入（`setA2ADelegator`）。**未注入 ⇒ 委派端点返回 501**（如实"未接线"）。
 * 后端形态（走 `CoreAPI` 对话轮 / 走某个 Agent）属**装配决策**，本模块不替它选 ——
 * 见 spec §6「T4 后端待接」。
 */
export type A2ADelegator = (
  message: string,
  agentId?: string
) => Promise<string>;

let delegator: A2ADelegator | null = null;

/** 注入/清除委派后端（装配期调用；`null` = 清除） */
export function setA2ADelegator(fn: A2ADelegator | null): void {
  delegator = fn;
}

/** 是否已注入委派后端（供装配自检与测试） */
export function hasA2ADelegator(): boolean {
  return delegator !== null;
}

/** 是否已启用 A2A 对外（导出供测试与文档核对） */
export function isA2AEnabled(): boolean {
  return configManager.env(ENV_A2A_ENABLED) === 'true';
}

/**
 * 请求是否通过 A2A 鉴权（**fail-closed**）。
 *
 * - `A2A_API_KEY` **未配置/空白 ⇒ 一律拒绝** —— **刻意不**沿用既有 API 的"未配密钥即放行（本地信任基线）"
 *   回退：那是**本机** API 的取向，而 A2A 是**对外**面（见 spec「鉴权强度」）。
 * - 配置了 ⇒ 复用 [`verifyRequestAuth`](../../LocalHTTPServiceHelpers.ts) 的同一头部语义（`x-api-key` / `Bearer`）。
 */
export function isA2AAuthorized(req: http.IncomingMessage): boolean {
  const expected = configManager.env(ENV_A2A_API_KEY)?.trim();
  if (!expected) return false;
  return verifyRequestAuth(req, expected);
}

/** 有界等待上限：非法/缺省 ⇒ {@link DEFAULT_DELEGATE_MAX_WAIT_MS} */
function resolveMaxWaitMs(): number {
  const raw = configManager.env(ENV_A2A_DELEGATE_MAX_WAIT_MS);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DELEGATE_MAX_WAIT_MS;
}

/** 对外基址：优先显式配置，否则按请求 Host 推导（**不硬编码**） */
function resolveBaseUrl(req: http.IncomingMessage): string {
  const explicit = configManager.env(ENV_A2A_PUBLIC_URL)?.trim();
  if (explicit) return explicit;
  const host = req.headers.host ?? '127.0.0.1';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = typeof forwardedProto === 'string' ? forwardedProto : 'http';
  return `${proto}://${host}`;
}

/** 是否为 A2A 管辖路径（未启用时用于"完全不管"的判定） */
function isA2APath(url: string): boolean {
  return (
    url === WELL_KNOWN_AGENT_JSON ||
    url === TASKS_PATH ||
    url.startsWith(`${TASKS_PATH}/`)
  );
}

/** 把委派文本包成 A2A 的 artifact + message（§2.2 / §2.4） */
function toDeliverables(text: string): {
  artifacts: A2AArtifact[];
  message: A2AMessage;
} {
  const parts = [{ text }];
  return {
    artifacts: [{ artifactId: 'reply', name: 'agent-reply', parts }],
    message: { messageId: 'reply', role: 'agent', parts },
  };
}

/**
 * A2A 路由派发（与其余 17 个域同一签名，见 `route-table.ts`）。
 *
 * @returns `true` = 已处理（已写出响应）；`false` = 未匹配（含**未启用**情形，交由上层 404）
 */
export async function dispatchA2ARoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  if (!isA2APath(url)) return false;

  // G4：未启用 ⇒ 交回上层（自然 404），**不写任何响应** ⇒ 不泄露该端点存在
  if (!isA2AEnabled()) return false;

  // 鉴权（2026-09-29 裁定：专用密钥 + fail-closed）——启用但未带合法密钥 ⇒ 401
  if (!isA2AAuthorized(req)) {
    json(res, 401, {
      error: { message: 'A2A 未授权：需 x-api-key 或 Bearer（A2A_API_KEY）' },
    });
    return true;
  }

  if (url === WELL_KNOWN_AGENT_JSON) {
    return handleAgentCard(req, res);
  }
  if (url === TASKS_PATH) {
    return handleCreateTask(req, res);
  }
  return handleGetTask(req, res, url.slice(TASKS_PATH.length + 1));
}

/** `GET /.well-known/agent.json` —— Agent Card（T1–T3） */
async function handleAgentCard(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') {
    json(res, 405, { error: { message: '仅支持 GET' } });
    return true;
  }

  const definitions = getAgentRegistry().listAll();
  const card = buildAgentCard(definitions, {
    baseUrl: resolveBaseUrl(req),
    version: A2A_PROTOCOL_VERSION,
  });
  const etag = computeAgentCardEtag(card);

  const ifNoneMatch = req.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  res.setHeader('ETag', etag);
  json(res, 200, card);
  logger.info('A2A Agent Card 已发布', {
    agents: definitions.length,
    url: card.url,
    protocolVersion: card.protocolVersion,
  });
  return true;
}

/**
 * `POST /v1/a2a/tasks` —— 创建任务并委派（T4）。
 *
 * 有界等待（G3）：阈值内完成 ⇒ `200` + 终态任务；超阈值 ⇒ `202` + `working` 任务，
 * 并由同一 Promise 在完成后收尾（**无轮询循环、不跨重启** —— 与 `taskStore` 头注释一致）。
 */
async function handleCreateTask(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'POST') {
    json(res, 405, { error: { message: '仅支持 POST' } });
    return true;
  }
  // 如实：后端未接线 ⇒ 501（**不**创建任务、不伪造成功）
  if (!delegator) {
    json(res, 501, {
      error: {
        message: 'A2A 委派后端未接线（需装配期注入 A2ADelegator）',
      },
    });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
  } catch {
    json(res, 400, { error: { message: '请求体不是合法 JSON' } });
    return true;
  }

  const message =
    typeof body['message'] === 'string' ? body['message'].trim() : '';
  if (!message) {
    json(res, 400, { error: { message: 'message 必填且不能为空' } });
    return true;
  }
  const agentId =
    typeof body['agentId'] === 'string' ? body['agentId'] : undefined;

  const task = a2aTaskStore.create();
  const pending = delegator(message, agentId);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), resolveMaxWaitMs());
  });

  let outcome: { kind: 'done'; value: string } | 'timeout';
  try {
    outcome = await Promise.race([
      pending.then((value) => ({ kind: 'done' as const, value })),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (outcome !== 'timeout') {
    const { artifacts, message: reply } = toDeliverables(outcome.value);
    const done = a2aTaskStore.complete(task.id, 'completed', artifacts, reply);
    logger.info('A2A 委派完成（同步）', { taskId: task.id, agentId });
    json(res, 200, done);
    return true;
  }

  // 超阈值：**有界等待**结束 ⇒ 标记 working 并立刻返回（不做 HTTP 长挂）；完成后由同一 Promise 收尾
  try {
    a2aTaskStore.complete(task.id, 'working', []);
  } catch (error) {
    // @ignore-catch: 任务可能已在竞态窗口内完成（终态不可改写）⇒ 以已完成态返回即可
    await handleError(error, {
      module: 'http:a2a',
      action: 'mark-working',
      context: { taskId: task.id },
    });
  }
  void pending
    .then((value) => {
      const { artifacts, message: reply } = toDeliverables(value);
      a2aTaskStore.complete(task.id, 'completed', artifacts, reply);
    })
    .catch((error: unknown) =>
      handleError(error, {
        module: 'http:a2a',
        action: 'delegate-late-failure',
        context: { taskId: task.id },
      })
    );

  logger.info('A2A 委派超出有界等待，转 working', { taskId: task.id, agentId });
  json(res, 202, a2aTaskStore.get(task.id));
  return true;
}

/** `GET /v1/a2a/tasks/{id}` —— 任务回查（T4） */
async function handleGetTask(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') {
    json(res, 405, { error: { message: '仅支持 GET' } });
    return true;
  }
  const task = a2aTaskStore.get(taskId);
  if (!task) {
    // 含"进程重启后旧任务不可查"（`taskStore` 头注释）⇒ 客户端按 §3.4 新建任务重发
    json(res, 404, { error: { message: `任务不存在：${taskId}` } });
    return true;
  }
  json(res, 200, task);
  return true;
}
