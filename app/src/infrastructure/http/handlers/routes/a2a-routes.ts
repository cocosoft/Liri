/**
 * a2a-routes.ts — dispatchA2ARoutes
 *
 * **A2A 对外暴露**（P3-1 / F2 / G2，2026-09-29）：
 * - `GET  /.well-known/agent-card.json` —— Agent Card 发现（T1–T3）
 * - `POST /v1/a2a/tasks`          —— **委派**（T4）：创建任务并把消息交给委派后端
 * - `GET  /v1/a2a/tasks/{id}`     —— 任务状态/产物回查（T4）
 * - `GET  /v1/a2a/health`         —— **独立就绪探针**（R11-3 D2）：`{ status, delegatorReady }`
 * - `POST /v1/a2a/rpc`            —— **A2A v1.0 JSON-RPC 绑定**（T4 批次 B）：11 个方法单入口分派
 *   （见 `.trae/specs/a2a-jsonrpc-binding.md`）
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
 * - **未注入委派后端 ⇒ 503 + `Retry-After`**（如实"未就绪"，**不伪造**成功）。
 *   A12（2026-10-06）：原为 **501** —— 501 语义是"服务器**永不支持**"，而此处是"服务端**暂不可用**"
 *   （装配期注入 `A2ADelegator` 后即恢复）⇒ 按协议互操作惯例改 **503 + `Retry-After`**；
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
// 2026-10-01 D-204（子批 C，`agent` 域 A2A 对外面）：原 7 个符号静态导入 app 层 `@modules/agent`
// ⇒ `infrastructure -> app` 倒挂。现协议**类型**取自 **core `types/a2a.ts`**（D-204 下沉，
// app 层 `agent/a2a/types.ts` 原址转出），**值**（注册表 / Agent Card 构建 / etag / 任务台账）
// 改经 **服务层端口** `getCoreAPI().getA2APort()`。
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import {
  A2A_LIST_TASKS_DEFAULT_PAGE_SIZE,
  A2A_LIST_TASKS_MAX_PAGE_SIZE,
  A2A_LIST_TASKS_MIN_PAGE_SIZE,
  A2A_METHOD_ALIASES,
  A2A_METHODS,
  JsonRpcErrorCode,
} from '@modules/types/a2a';
import type {
  A2AArtifact,
  A2AMessage,
  A2AListTasksResponse,
  A2ATask,
  A2ATaskState,
} from '@modules/types/a2a';

const logger = getLogger('http:a2a');

/**
 * A2A 端口类型（**从 `getCoreAPI()` 派生**）。
 *
 * 刻意**不** `import type { A2APort } from '@modules/runtime/api/a2aPorts'` ——
 * 那是 service 层模块的**子目录路径**，静态引用会撞 R03-002「模块出口单一」的白名单判定
 * （T4 批次 B 实测该风险）；用派生类型等价且零新跨模块边。
 */
type A2APortSlice = Awaited<
  ReturnType<ReturnType<typeof getCoreAPI>['getA2APort']>
>;

/** A2A 规范的 Agent Card 发现路径 */
const WELL_KNOWN_AGENT_CARD = '/.well-known/agent-card.json';
/** 委派端点（本仓自定路径，非 A2A JSON-RPC 绑定；见 api-spec §3.8.2） */
const TASKS_PATH = '/v1/a2a/tasks';
/** 独立就绪探针（R11-3 D2；非 A2A 规范路径，本仓自定，见 api-spec §3.8.2） */
const HEALTH_PATH = '/v1/a2a/health';
/**
 * A2A v1.0 **JSON-RPC 绑定**单入口（T4 批次 B）。
 *
 * 规范形态即"单端点 + `method` 分派"（spec §9.4）；与方法名常量同源于
 * `@modules/types/a2a` 的 `A2A_METHODS`（不含路径前缀，故此处自行定义）。
 */
const RPC_PATH = '/v1/a2a/rpc';

/**
 * 环境变量：是否对外暴露 A2A（**默认关闭**，spec G4）。
 * 命名沿用 ACP 侧 `ACP_REMOTE_HOST` 同族风格（§1.4 前缀表未含 A2A ⇒ 已在 spec 登记）。 */
const ENV_A2A_ENABLED = 'A2A_ENABLED';
/**
 * 环境变量：A2A **访问密钥清单**（2026-09-29 裁定「专用密钥 + fail-closed」；2026-10-07 扩为**多钥**）。
 *
 * 格式：逗号分隔；每项 `key` 或 `key@<ISO-8601>`（`@` 后为该钥**过期时刻**，到点即失效）。
 * **无有效钥 ⇒ 一律 401**（对外面**不回退**到"本地信任基线"）；与 `A2A_ENABLED` 构成**双闸**。
 * 轮换（零中断）与设计依据见 `.trae/specs/a2a-multikey-rotation.md`。
 */
const ENV_A2A_API_KEYS = 'A2A_API_KEYS';
/** 环境变量：卡片中写出的对外基址（可选）；缺省按**请求 Host** 推导 ⇒ **不硬编码** */
const ENV_A2A_PUBLIC_URL = 'A2A_PUBLIC_URL';
/** 环境变量：委派的**有界等待**上限（毫秒；超时即返回 `working`，spec G3） */
const ENV_A2A_DELEGATE_MAX_WAIT_MS = 'A2A_DELEGATE_MAX_WAIT_MS';
const DEFAULT_DELEGATE_MAX_WAIT_MS = 15_000;
/** A12：委派后端未就绪时的 `Retry-After`（秒）—— 告诉外部调用方"稍后重试"的合理间隔 */
const RETRY_AFTER_SECONDS = 5;

/**
 * 委派后端（**端口**，GR01：不新造框架）。
 *
 * 由装配方注入（`setA2ADelegator`）。**未注入 ⇒ 委派端点返回 503 + `Retry-After`**（如实"未就绪"）。
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

/** `parseA2AKeys` 的结果（纯数据，无副作用） */
export interface ParsedA2AKeys {
  /** **当前有效**的钥（已剔除空项 / 已过期 / 格式非法者） */
  keys: string[];
  /** 被判为**格式非法**的原始项（无钥值 / `@` 后时间串无法解析）—— 供调用方**上报** */
  invalidEntries: string[];
}

/**
 * 解析 A2A 密钥清单（**纯函数**，可单测；spec `.trae/specs/a2a-multikey-rotation.md` D2/D3/D5）。
 *
 * - 逗号分隔；每项 `key` 或 `key@<ISO-8601>`；**空白项**忽略；
 * - 无 `@` ⇒ 该钥**永不过期**；
 * - `now >= expiresAt` ⇒ **失效**（不含）；
 * - **格式非法**（`@` 后无法解析为时间，或只有时间没有钥）⇒ **丢弃该项**并登记到
 *   `invalidEntries`（**fail-closed**：**不**把它当作"永不过期"—— 那是 fail-open）；
 * - 分段用 `lastIndexOf('@')`（D5：键为 base64url，不含 `@`；将来亦不会误切）。
 *
 * @param raw 环境变量原值
 * @param now 当前时刻（ms epoch；由调用方注入 ⇒ 可测边界）
 */
export function parseA2AKeys(
  raw: string | undefined,
  now: number
): ParsedA2AKeys {
  const keys: string[] = [];
  const invalidEntries: string[] = [];
  if (!raw) return { keys, invalidEntries };

  for (const item of raw.split(',')) {
    const trimmed = item.trim();
    if (!trimmed) continue;

    const at = trimmed.lastIndexOf('@');
    if (at < 0) {
      keys.push(trimmed);
      continue;
    }

    const key = trimmed.slice(0, at).trim();
    const iso = trimmed.slice(at + 1).trim();
    if (!key) {
      invalidEntries.push(trimmed); // 只有过期时间、没有钥 ⇒ 格式非法
      continue;
    }
    const expiresAt = Date.parse(iso);
    if (!Number.isFinite(expiresAt)) {
      invalidEntries.push(trimmed);
      continue;
    }
    if (now >= expiresAt) continue; // 已过期 ⇒ 失效
    keys.push(key);
  }
  return { keys, invalidEntries };
}

/**
 * 已上报过"非法密钥项"的原始配置值 —— 防止**未认证请求**把它放大成日志洪泛
 * （同一份配置只提示一次；运维改配置后原值变化 ⇒ 重新提示）。
 */
let _warnedInvalidKeysFor: string | null = null;

/**
 * 请求是否通过 A2A 鉴权（**fail-closed**，多钥版）。
 *
 * - **无有效钥**（`A2A_API_KEYS` 未配置 / 全空 / **全过期** / **全非法**）⇒ **一律拒绝**
 *   —— **刻意不**沿用既有 API 的"未配密钥即放行（本地信任基线）"回退：那是**本机** API 的取向，
 *   而 A2A 是**对外**面。
 * - 有有效钥 ⇒ 逐个复用 [`verifyRequestAuth`](../../LocalHTTPServiceHelpers.ts)（**常量时间**比较，
 *   R07-4② 产物）⇒ **不新建第二套比较**（CS01）。
 */
export function isA2AAuthorized(req: http.IncomingMessage): boolean {
  const raw = configManager.env(ENV_A2A_API_KEYS);
  const { keys, invalidEntries } = parseA2AKeys(raw, Date.now());
  if (invalidEntries.length > 0 && _warnedInvalidKeysFor !== raw) {
    _warnedInvalidKeysFor = raw ?? null;
    logger.warning(
      'A2A_API_KEYS 中存在**过期时间无法解析**的项 ⇒ 已按 fail-closed 丢弃（该项不会生效）',
      { invalidCount: invalidEntries.length }
    );
  }
  if (keys.length === 0) return false;
  return keys.some((key) => verifyRequestAuth(req, key));
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
    url === WELL_KNOWN_AGENT_CARD ||
    url === HEALTH_PATH ||
    url === RPC_PATH ||
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

  if (url === WELL_KNOWN_AGENT_CARD) {
    return handleAgentCard(req, res);
  }
  if (url === HEALTH_PATH) {
    return handleHealth(req, res);
  }
  if (url === RPC_PATH) {
    return handleRpc(req, res);
  }
  if (url === TASKS_PATH) {
    return handleCreateTask(req, res);
  }
  return handleGetTask(req, res, url.slice(TASKS_PATH.length + 1));
}

/** `GET /.well-known/agent-card.json` —— Agent Card（T1–T3） */
async function handleAgentCard(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') {
    json(res, 405, { error: { message: '仅支持 GET' } });
    return true;
  }

  // D-204：原"取注册表 → buildAgentCard → computeAgentCardEtag"三步 ⇒ 折叠为端口单方法
  const { card, etag, agentCount } = (
    await getCoreAPI().getA2APort()
  ).buildCard(resolveBaseUrl(req));

  const ifNoneMatch = req.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  res.setHeader('ETag', etag);
  json(res, 200, card);
  logger.info('A2A Agent Card 已发布', {
    agents: agentCount,
    url: card.url,
    protocolVersion: card.protocolVersion,
  });
  return true;
}

/**
 * `GET /v1/a2a/health` —— **独立就绪探针**（R11-3 D2）。
 *
 * 使外部调用方**无需先 POST** 即可判断能否委派：`delegatorReady` 与
 * `handleCreateTask` 的 `503` 判据**同源**（同一个 `delegator` 引用，CS01 不另造判据）。
 * **不**返回密钥 / 版本 / Agent 数（避免成为额外信息面；版本经发现端点取）。
 */
async function handleHealth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'GET') {
    json(res, 405, { error: { message: '仅支持 GET' } });
    return true;
  }
  json(res, 200, { status: 'ok', delegatorReady: delegator !== null });
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
  // 如实：后端未接线 ⇒ 503 + `Retry-After`（**不**创建任务、不伪造成功）
  // A12（2026-10-06）：原 501 ⇒ 改 503 —— 501 = "永不支持"，503 = "暂不可用"（可恢复），
  // 与"装配期注入后即恢复"的真实语义一致；`Retry-After` 便于外部调用方退避重试。
  if (!delegator) {
    res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
    json(res, 503, {
      error: {
        message: 'A2A 委派后端未就绪（需装配期注入 A2ADelegator）',
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

  // D-204：任务台账改经 A2A 端口（原静态 `a2aTaskStore`）。
  // T4 批次 B：委派核心抽为 `runDelegation`，与 JSON-RPC `SendMessage` **共用**（CS01）。
  const port = await getCoreAPI().getA2APort();
  const { completed, task } = await runDelegation(
    port,
    message,
    agentId,
    resolveMaxWaitMs()
  );
  json(res, completed ? 200 : 202, task);
  return true;
}

/**
 * **委派执行核心**（唯一实现；T4 批次 B 自 `handleCreateTask` 抽出）。
 *
 * 流程：创建任务 → 有界等待（G3）→ 阈值内完成则写 `TASK_STATE_COMPLETED`；超阈值则写
 * `TASK_STATE_WORKING` 并立刻返回，**由同一 Promise 收尾**（无轮询、不跨重启）。
 * REST（`POST /v1/a2a/tasks`）与 JSON-RPC（`SendMessage`）**共用**（CS01）。
 *
 * @param waitMs `<= 0` ⇒ 不等（对应 JSON-RPC `configuration.returnImmediately: true`）
 * @returns `completed=false` ⇒ 调用方按 `202 + working` 返回（REST 口径）
 */
async function runDelegation(
  port: A2APortSlice,
  message: string,
  agentId: string | undefined,
  waitMs: number
): Promise<{ completed: boolean; task: A2ATask }> {
  const task = port.createTask();
  // `delegator` 由 `handleCreateTask` / `handleRpc` 的分支前置保证非空（未装配 ⇒ 已 503）
  const pending = (delegator as A2ADelegator)(message, agentId);

  let outcome: { kind: 'done'; value: string } | 'timeout';
  if (waitMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), waitMs);
    });
    try {
      outcome = await Promise.race([
        pending.then((value) => ({ kind: 'done' as const, value })),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    outcome = 'timeout';
  }

  if (outcome !== 'timeout') {
    const { artifacts, message: reply } = toDeliverables(outcome.value);
    const done = port.completeTask(
      task.id,
      'TASK_STATE_COMPLETED',
      artifacts,
      reply
    );
    logger.info('A2A 委派完成（同步）', { taskId: task.id, agentId });
    return { completed: true, task: done };
  }

  // 超阈值：**有界等待**结束 ⇒ 标记 working 并立刻返回（不做 HTTP 长挂）；完成后由同一 Promise 收尾
  try {
    port.completeTask(task.id, 'TASK_STATE_WORKING', []);
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
      port.completeTask(task.id, 'TASK_STATE_COMPLETED', artifacts, reply);
    })
    .catch((error: unknown) =>
      handleError(error, {
        module: 'http:a2a',
        action: 'delegate-late-failure',
        context: { taskId: task.id },
      })
    );

  logger.info('A2A 委派超出有界等待，转 working', { taskId: task.id, agentId });
  return { completed: false, task: port.getTask(task.id) ?? task };
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
  const task = (await getCoreAPI().getA2APort()).getTask(taskId);
  if (!task) {
    // 含"进程重启后旧任务不可查"（`taskStore` 头注释）⇒ 客户端按 §3.4 新建任务重发
    json(res, 404, { error: { message: `任务不存在：${taskId}` } });
    return true;
  }
  json(res, 200, task);
  return true;
}

/* ==========================================================================
 * A2A v1.0 JSON-RPC 绑定（T4 批次 B）—— `POST /v1/a2a/rpc`
 *
 * 规范形态 = **单端点 + `method` 分派**（spec §9.4）；方法名与错误码取自 core `types/a2a.ts`
 * （单一事实源）。**误差口径（如实）**：协议级错误按 JSON-RPC 惯例以 **HTTP 200 + `error`
 * 对象**返回（spec §5.4 亦给出 HTTP 状态列，属 REST 绑定视角；本仓无对端可验，见 spec §9-1）。
 * ========================================================================== */

/** 本仓服务的 A2A 协议版本（`A2A-Version` 头，spec §3.6.1；**未发送按 0.3 处理** ⇒ 不支持） */
const SUPPORTED_A2A_VERSION = '1.0';

/** JSON-RPC 成功响应（HTTP 200 + `result`） */
function rpcResult(
  res: http.ServerResponse,
  id: unknown,
  result: unknown
): void {
  json(res, 200, { jsonrpc: '2.0', id: id ?? null, result });
}

/** JSON-RPC 失败响应（HTTP 200 + `error`；**不含 `data`** —— 本仓不产 ProtoJSON `Any`） */
function rpcError(
  res: http.ServerResponse,
  id: unknown,
  code: number,
  message: string
): void {
  json(res, 200, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

/** `POST /v1/a2a/rpc` —— 信封校验后交 {@link dispatchRpcMethod} 分派 */
async function handleRpc(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if ((req.method ?? 'GET') !== 'POST') {
    json(res, 405, { error: { message: '仅支持 POST' } });
    return true;
  }

  // spec §3.6.1：客户端 MUST 每请求发送 `A2A-Version`；**空值/缺失按 0.3 处理** ⇒ 本仓只服务 1.0
  const version = req.headers[A2A_HEADER_VERSION_LOWER];
  if (typeof version !== 'string' || version.trim() !== SUPPORTED_A2A_VERSION) {
    rpcError(
      res,
      null,
      JsonRpcErrorCode.VersionNotSupported,
      `仅支持 A2A 协议版本 ${SUPPORTED_A2A_VERSION}（未发送该头按 0.3 处理，spec §3.6.1）`
    );
    return true;
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch (error) {
    await handleError(error, { module: 'http:a2a', action: 'rpc-read-body' });
    rpcError(res, null, JsonRpcErrorCode.ParseError, 'Invalid JSON payload');
    return true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '');
  } catch {
    rpcError(res, null, JsonRpcErrorCode.ParseError, 'Invalid JSON payload');
    return true;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    rpcError(
      res,
      null,
      JsonRpcErrorCode.InvalidRequest,
      'JSON-RPC 请求必须是对象（批量请求未支持）'
    );
    return true;
  }

  const envelope = parsed as Record<string, unknown>;
  const id = envelope['id'] ?? null;
  if (envelope['jsonrpc'] !== '2.0' || typeof envelope['method'] !== 'string') {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.InvalidRequest,
      '需要 jsonrpc:"2.0" 与 method'
    );
    return true;
  }
  // v1.0 canonical 名 + v0.3 迁移别名（`A2A_METHOD_ALIASES` 单一事实源）
  const canonical = A2A_METHOD_ALIASES[envelope['method']];
  if (!canonical) {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.MethodNotFound,
      `未知方法：${envelope['method']}`
    );
    return true;
  }

  const rawParams = envelope['params'];
  const params = (
    typeof rawParams === 'object' && rawParams !== null
      ? (rawParams as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;

  return dispatchRpcMethod(
    res,
    id,
    canonical,
    params,
    await getCoreAPI().getA2APort()
  );
}

/**
 * 按 canonical 方法名分派（spec §3.1.1–3.1.11）。
 *
 * **能力门控**（spec §3.3.4：能力未声明时的操作 **MUST 报标准错误**，**不得**静默成功）：
 * 两个流操作 ⇒ `-32004`（`streaming` 尚未实现，T4 批次 C）；4 个推送配置 ⇒ `-32003`；
 * 扩展卡 ⇒ `-32004`（`extendedAgentCard` 不做）。
 */
async function dispatchRpcMethod(
  res: http.ServerResponse,
  id: unknown,
  method: string,
  params: Record<string, unknown>,
  port: A2APortSlice
): Promise<boolean> {
  switch (method) {
    case A2A_METHODS.SendMessage:
      return rpcSendMessage(res, id, params, port);
    case A2A_METHODS.GetTask:
      return rpcGetTask(res, id, params, port);
    case A2A_METHODS.ListTasks:
      return rpcListTasks(res, id, params, port);
    case A2A_METHODS.CancelTask:
      return rpcCancelTask(res, id, params, port);
    case A2A_METHODS.SendStreamingMessage:
    case A2A_METHODS.SubscribeToTask:
      rpcError(
        res,
        id,
        JsonRpcErrorCode.UnsupportedOperation,
        '未声明 capabilities.streaming ⇒ 不支持流式操作'
      );
      return true;
    case A2A_METHODS.CreateTaskPushNotificationConfig:
    case A2A_METHODS.GetTaskPushNotificationConfig:
    case A2A_METHODS.ListTaskPushNotificationConfigs:
    case A2A_METHODS.DeleteTaskPushNotificationConfig:
      rpcError(
        res,
        id,
        JsonRpcErrorCode.PushNotificationNotSupported,
        '未声明 capabilities.pushNotifications ⇒ 不支持推送通知配置'
      );
      return true;
    case A2A_METHODS.GetExtendedAgentCard:
      rpcError(
        res,
        id,
        JsonRpcErrorCode.UnsupportedOperation,
        '未声明 capabilities.extendedAgentCard ⇒ 不支持扩展 Agent Card'
      );
      return true;
    default:
      rpcError(res, id, JsonRpcErrorCode.MethodNotFound, `未知方法：${method}`);
      return true;
  }
}

/** `SendMessage`（§3.1.1）—— 复用 {@link runDelegation}；`returnImmediately` ⇒ 不等 */
async function rpcSendMessage(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice
): Promise<boolean> {
  if (!delegator) {
    // 与 REST 同口径：**如实**"未就绪"，不伪造成功（JSON-RPC 无 503 语义 ⇒ 内部错误码）
    rpcError(
      res,
      id,
      JsonRpcErrorCode.InternalError,
      'A2A 委派后端未就绪（需装配期注入 A2ADelegator）'
    );
    return true;
  }

  const message = params['message'];
  if (typeof message !== 'object' || message === null) {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.InvalidParams,
      'message 必填（A2AMessage）'
    );
    return true;
  }
  // 本项目当前只处理文本（`defaultInputModes = ['text/plain']`）⇒ 拼接 `parts[].text`
  const parts = (message as Record<string, unknown>)['parts'];
  const text = Array.isArray(parts)
    ? parts
        .map((p) =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as Record<string, unknown>)['text'] === 'string'
            ? ((p as Record<string, unknown>)['text'] as string)
            : ''
        )
        .join('')
        .trim()
    : '';
  if (!text) {
    rpcError(
      res,
      id,
      JsonRpcErrorCode.InvalidParams,
      'message.parts 至少需一个非空 text part'
    );
    return true;
  }

  const configuration = params['configuration'];
  const returnImmediately =
    typeof configuration === 'object' &&
    configuration !== null &&
    (configuration as Record<string, unknown>)['returnImmediately'] === true;

  const { task } = await runDelegation(
    port,
    text,
    undefined,
    returnImmediately ? 0 : resolveMaxWaitMs()
  );
  // `SendMessageResponse` 为 oneof（task | message）：本仓委派**恒产出任务** ⇒ 返回 `task` 分支
  rpcResult(res, id, { task });
  return true;
}

/** `GetTask`（§3.1.3；`historyLength` 语义见 §3.2.4） */
function rpcGetTask(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice
): boolean {
  const taskId = typeof params['id'] === 'string' ? params['id'] : '';
  if (!taskId) {
    rpcError(res, id, JsonRpcErrorCode.InvalidParams, 'id 必填');
    return true;
  }
  const task = port.getTask(taskId);
  if (!task) {
    rpcError(res, id, JsonRpcErrorCode.TaskNotFound, `任务不存在：${taskId}`);
    return true;
  }
  rpcResult(res, id, applyHistoryLength(task, params['historyLength']));
  return true;
}

/** `ListTasks`（§3.1.4）：过滤 → **status timestamp 降序** → cursor 分页 */
function rpcListTasks(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice
): boolean {
  const pageSize = resolvePageSize(params['pageSize']);
  const contextId =
    typeof params['contextId'] === 'string' ? params['contextId'] : undefined;
  const status =
    typeof params['status'] === 'string'
      ? (params['status'] as A2ATaskState)
      : undefined;
  const includeArtifacts = params['includeArtifacts'] === true;
  const offset = parsePageToken(params['pageToken']);

  let tasks = port.listTasks();
  if (contextId) tasks = tasks.filter((t) => t.contextId === contextId);
  if (status) tasks = tasks.filter((t) => t.status.state === status);
  // §3.1.4：MUST 按 status timestamp **降序**（同级保持插入序 ⇒ 稳定排序）
  tasks = [...tasks].sort((a, b) =>
    a.status.timestamp < b.status.timestamp
      ? 1
      : a.status.timestamp > b.status.timestamp
        ? -1
        : 0
  );

  const totalSize = tasks.length;
  const page = tasks.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  const response: A2AListTasksResponse = {
    // `includeArtifacts=false` ⇒ `artifacts` 必须**整体省略**（不得空数组，§3.1.4）
    tasks: includeArtifacts ? page : page.map(withoutArtifacts),
    // 无更多结果 ⇒ **空串**（§3.1.4）
    nextPageToken: nextOffset < totalSize ? String(nextOffset) : '',
    pageSize,
    totalSize,
  };
  rpcResult(res, id, response);
  return true;
}

/** `CancelTask`（§3.1.5）：端口返回结构化结果 ⇒ 直接映射 `-32001` / `-32002` */
function rpcCancelTask(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice
): boolean {
  const taskId = typeof params['id'] === 'string' ? params['id'] : '';
  if (!taskId) {
    rpcError(res, id, JsonRpcErrorCode.InvalidParams, 'id 必填');
    return true;
  }
  const outcome = port.cancelTask(taskId);
  if (!outcome.ok) {
    rpcError(
      res,
      id,
      outcome.reason === 'not_found'
        ? JsonRpcErrorCode.TaskNotFound
        : JsonRpcErrorCode.TaskNotCancelable,
      outcome.reason === 'not_found'
        ? `任务不存在：${taskId}`
        : `任务已处于终态，不可取消：${taskId}`
    );
    return true;
  }
  rpcResult(res, id, outcome.task);
  return true;
}

/* ---------------- JSON-RPC 纯函数辅助（可单测） ---------------- */

/** `A2A-Version` 头的**小写**键（HTTP 头名大小写不敏感，spec §9.2） */
const A2A_HEADER_VERSION_LOWER = 'a2a-version';

/** §3.1.4 分页大小：非法 ⇒ 默认 50；再夹到 [1, 100] */
function resolvePageSize(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return A2A_LIST_TASKS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(
    Math.max(Math.trunc(raw), A2A_LIST_TASKS_MIN_PAGE_SIZE),
    A2A_LIST_TASKS_MAX_PAGE_SIZE
  );
}

/**
 * 解析分页游标。
 *
 * 本仓游标 = **十进制偏移量字符串**（cursor 对客户端**不透明** ⇒ 形态由服务端定义，§3.1.4）；
 * 非法/缺失 ⇒ `0`（从首页开始，**不报错** —— 与"客户端只需回传上次 token"的用法一致）。
 */
function parsePageToken(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** 省略 `artifacts` 键（§3.1.4：**整体省略**，不得空数组） */
function withoutArtifacts(task: A2ATask): A2ATask {
  const { artifacts: _omitted, ...rest } = task;
  return rest;
}

/** §3.2.4：未设置 ⇒ 原样；`0` ⇒ 省略 `history`；`>0` ⇒ 最近 N 条 */
function applyHistoryLength(task: A2ATask, raw: unknown): A2ATask {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return task;
  const limit = Math.trunc(raw);
  if (limit <= 0) {
    const { history: _omitted, ...rest } = task;
    return rest;
  }
  return { ...task, history: (task.history ?? []).slice(-limit) };
}
