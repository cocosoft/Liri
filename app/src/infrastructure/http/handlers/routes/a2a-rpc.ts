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
 * a2a-rpc.ts — A2A v1.0 **JSON-RPC 绑定**（含 SSE 流式）+ 委派交付物构造
 *
 * **T4 批次 E 拆分**：原全部内联在 `a2a-routes.ts`（该文件因此超 500 行阈值）；
 * 本文件承载 JSON-RPC 单入口与流式，`a2a-routes.ts` 保留卡片 / 探针 / 自定义 REST。
 *
 * **依赖方向（单向，避免循环）**：`a2a-routes.ts` → 本文件。
 * 本文件**不 import** `a2a-routes`：委派后端状态与有界等待经 {@link A2ARpcDeps} **注入**
 * （`hasDelegator` / `maxWaitMs` / `runDelegation` / `delegate`），故委派核心在两条路径上
 * 仍是**同一实现**（CS01）。
 *
 * 形态（spec §9.4.2）：`POST /v1/a2a/rpc` 单端点 + `method` 分派；流式为
 * `text/event-stream`，每条 `data:` 是**一个 JSON-RPC 响应对象**。协议级错误按 JSON-RPC
 * 惯例以 **HTTP 200 + `error` 对象**返回（见 `.trae/specs/a2a-jsonrpc-binding.md` §9-1）。
 */

import type http from 'http';
import { json, readBody } from '../handler-utils';
import { handleError } from '@modules/error';
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

/**
 * A2A 端口类型（**从 `getCoreAPI()` 派生**）。
 *
 * 刻意**不** `import type { A2APort } from '@modules/runtime/api/a2aPorts'` ——
 * 那是 service 层模块的**子目录路径**，静态引用会撞 R03-002「模块出口单一」的白名单判定；
 * 用派生类型等价且零新跨模块边。
 */
export type A2APortSlice = Awaited<
  ReturnType<ReturnType<typeof getCoreAPI>['getA2APort']>
>;

/**
 * 由 `a2a-routes.ts` 注入的依赖（**唯一**的跨文件契约）。
 *
 * 四个方法都与**委派**相关：状态（`hasDelegator`）与三个执行面（有界等待上限、共用委派核心、
 * 流式直连）。由宿主注入而非 import，既避免循环依赖，也保证 REST 与 RPC **共用同一实现**。
 */
export interface A2ARpcDeps {
  /** 委派后端是否已装配（未装配 ⇒ 两个写操作**如实**报错，**不伪造**成功） */
  hasDelegator(): boolean;
  /** 有界等待上限（ms；REST 与 RPC 同源） */
  maxWaitMs(): number;
  /** 委派核心（**与 REST 共用**）：创建任务 → 有界等待 → 完成或转 `working` */
  runDelegation(
    port: A2APortSlice,
    message: string,
    agentId: string | undefined,
    waitMs: number
  ): Promise<{ completed: boolean; task: A2ATask }>;
  /** 直连委派（**流式**用：不做有界等待；调用方已确认 `hasDelegator()`） */
  delegate(message: string, agentId: string | undefined): Promise<string>;
}

/** 本仓服务的 A2A 协议版本（`A2A-Version` 头，spec §3.6.1；**未发送按 0.3 处理** ⇒ 不支持） */
const SUPPORTED_A2A_VERSION = '1.0';

/** `A2A-Version` 头的**小写**键（HTTP 头名大小写不敏感，spec §9.2） */
const A2A_HEADER_VERSION_LOWER = 'a2a-version';

/**
 * 把委派文本包成 A2A 的 artifact + message（§2.2 / §2.4）。
 *
 * **导出**供 `a2a-routes.ts` 的 REST 委派共用（CS01）。
 */
export function toDeliverables(text: string): {
  artifacts: A2AArtifact[];
  message: A2AMessage;
} {
  const parts = [{ text }];
  return {
    artifacts: [{ artifactId: 'reply', name: 'agent-reply', parts }],
    message: { messageId: 'reply', role: 'agent', parts },
  };
}

/** JSON-RPC 成功响应（HTTP 200 + `result`） */
function rpcResult(
  res: http.ServerResponse,
  id: unknown,
  result: unknown
): void {
  json(res, 200, { jsonrpc: '2.0', id: id ?? null, result });
}

/** JSON-RPC 失败响应（HTTP 200 + `error`；**不含 `data`** —— 本仓不产 ProtoJSON `Any`） */
export function rpcError(
  res: http.ServerResponse,
  id: unknown,
  code: number,
  message: string
): void {
  json(res, 200, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

/** `POST /v1/a2a/rpc` —— 信封校验后交 {@link dispatchRpcMethod} 分派 */
export async function dispatchA2ARpc(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: A2ARpcDeps
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
    await getCoreAPI().getA2APort(),
    deps
  );
}

/**
 * 按 canonical 方法名分派（spec §3.1.1–3.1.11）。
 *
 * **能力门控**（spec §3.3.4：能力未声明时的操作 **MUST 报标准错误**，**不得**静默成功）：
 * 4 个推送配置 ⇒ `-32003`；扩展卡 ⇒ `-32004`（`extendedAgentCard` 不做）。
 * 两个流操作 ⇒ **已实现**（T4 批次 C）⇒ 不再门控。
 */
async function dispatchRpcMethod(
  res: http.ServerResponse,
  id: unknown,
  method: string,
  params: Record<string, unknown>,
  port: A2APortSlice,
  deps: A2ARpcDeps
): Promise<boolean> {
  switch (method) {
    case A2A_METHODS.SendMessage:
      return rpcSendMessage(res, id, params, port, deps);
    case A2A_METHODS.GetTask:
      return rpcGetTask(res, id, params, port);
    case A2A_METHODS.ListTasks:
      return rpcListTasks(res, id, params, port);
    case A2A_METHODS.CancelTask:
      return rpcCancelTask(res, id, params, port);
    // T4 批次 E 第二拆：流式在 `a2a-rpc-stream.ts`（**懒加载** ⇒ 无静态环；同仓既有断环手法）
    case A2A_METHODS.SendStreamingMessage: {
      const { rpcSendStreamingMessage } = await import('./a2a-rpc-stream');
      return rpcSendStreamingMessage(res, id, params, port, deps);
    }
    case A2A_METHODS.SubscribeToTask: {
      const { rpcSubscribeToTask } = await import('./a2a-rpc-stream');
      return rpcSubscribeToTask(res, id, params, port);
    }
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

/** `SendMessage`（§3.1.1）—— 复用注入的 `runDelegation`；`returnImmediately` ⇒ 不等 */
async function rpcSendMessage(
  res: http.ServerResponse,
  id: unknown,
  params: Record<string, unknown>,
  port: A2APortSlice,
  deps: A2ARpcDeps
): Promise<boolean> {
  if (!deps.hasDelegator()) {
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
  // 本项目当前只处理文本（`defaultInputModes = ['text/plain']`）
  const text = extractTextParts(params);
  if (text === null) {
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

  const { task } = await deps.runDelegation(
    port,
    text,
    undefined,
    returnImmediately ? 0 : deps.maxWaitMs()
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

/**
 * 取 `params.message.parts[].text` 拼接（**REST/RPC 共用**，CS01）。
 *
 * 本项目当前只处理文本（`defaultInputModes = ['text/plain']`）⇒ 无有效文本返回 `null`
 * （调用方映射 `-32602`）。
 */
export function extractTextParts(
  params: Record<string, unknown>
): string | null {
  const message = params['message'];
  if (typeof message !== 'object' || message === null) return null;
  const parts = (message as Record<string, unknown>)['parts'];
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p) =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as Record<string, unknown>)['text'] === 'string'
        ? ((p as Record<string, unknown>)['text'] as string)
        : ''
    )
    .join('')
    .trim();
  return text ? text : null;
}
