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
 * A2A 协议数据模型（v1.0 子集）
 *
 * 依据《A2A 协议技术手册》§2（核心概念）、§5.1（Agent Card）、§3（任务生命周期）。
 * 规范唯一事实来源为官方 `specification/a2a.proto`；此处只落地本项目当前所需子集。
 * 约定（§6.2 / §12.1）：JSON 字段名 **camelCase**；时间为 **UTC ISO 8601** 字符串。
 *
 * H5-③ 收口（台账 D-204，子批 C `infrastructure -> app`）：原定义于
 * `agent/a2a/types.ts`（app 层），而 `infrastructure/http/handlers/routes/a2a-routes.ts`
 * 需要 `A2AArtifact` / `A2AMessage` 等**协议类型** ⇒ 静态 `import … from '@modules/agent'`
 * ⇒ `infrastructure -> app` 倒挂。定义下沉至 core 层 types 模块
 * （本文件**零出向依赖**，仅 const/纯类型），由 `agent/a2a/types.ts` **转出**（app → core 合法）。
 *
 * 同 D-67 / D-203 手法：**整表下沉**（协议词汇表属对外契约，非 app 领域载荷）。
 */

/**
 * Part（§2.3）：**恰好**包含 `text` / `raw` / `url` / `data` 四选一，不得混用。
 */
export interface A2APart {
  /** 纯文本内容 */
  text?: string;
  /** 内联二进制（JSON 绑定下以 base64 承载） */
  raw?: string;
  /** 外部内容引用 */
  url?: string;
  /** 机器可读结构化数据 */
  data?: unknown;
  /** MIME 类型 */
  mediaType?: string;
  /** 可选文件名 */
  filename?: string;
  metadata?: Record<string, unknown>;
}

export type A2AMessageRole = 'user' | 'agent';

/** Message：单轮通信（§2.2） */
export interface A2AMessage {
  messageId: string;
  role: A2AMessageRole;
  parts: A2APart[];
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

/** Artifact：任务交付物（§2.4） */
export interface A2AArtifact {
  artifactId: string;
  name?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

/**
 * 任务状态（§3；**v1.0.0** 枚举，`SCREAMING_SNAKE_CASE` 以符合 ProtoJSON）。
 *
 * 论文 A5（2026-10-06，`.trae/specs/a2a-v1-naming-alignment.md`）：原为 v0.3 的 kebab-case
 * （`'submitted'` / `'input-required'` …），v1.0 属**破坏性改名**；本批同时补齐
 * `TASK_STATE_UNSPECIFIED` 与 `TASK_STATE_AUTH_REQUIRED`。
 */
export type A2ATaskState =
  | 'TASK_STATE_UNSPECIFIED'
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED';

/**
 * 终态集合（§3.4 任务不可变性）：进入终态后**不可重启**。
 * 细化请求必须走同一 `contextId` 新建任务，而不是复用终态任务。
 * 注：`TASK_STATE_INPUT_REQUIRED` / `TASK_STATE_AUTH_REQUIRED` 属**中断态**（非终态）。
 */
export const A2A_TERMINAL_STATES: readonly A2ATaskState[] = [
  'TASK_STATE_COMPLETED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_FAILED',
  'TASK_STATE_REJECTED',
];

export function isTerminalState(state: A2ATaskState): boolean {
  return A2A_TERMINAL_STATES.includes(state);
}

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  /** UTC ISO 8601 */
  timestamp: string;
}

export interface A2ATask {
  id: string;
  /** 服务端生成，用于分组同一上下文的多轮任务（§2.5） */
  contextId: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

/** AgentSkill（§5.1） */
export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  /**
   * 是否暴露任务的**状态变更历史**（A2A v0.2.1 §5.5.2 / v0.3.0 §5.5.2）。
   *
   * 本仓只暴露任务**当前态**（`GET /v1/a2a/tasks/{id}`）⇒ 如实为 `false`（R11-3 D1）。
   * ⚠️ **T4 待核**：v1.0 的 `a2a.proto` 字段集中**未见**该字段（见 `.trae/specs/a2a-jsonrpc-binding.md` §9-2
   * 的规范自相不一致登记）⇒ 是否随 v1.0 移除，**待按 `v1.0.0` tag 校验后再定**（本批保留，不多改）。
   */
  stateTransitionHistory: boolean;
  /** 支持的协议扩展（v1.0 = `AgentExtension` 对象数组；本仓当前为空/不设置） */
  extensions?: A2AAgentExtension[];
  /** 是否支持鉴权后的**扩展 Agent Card**（v1.0 新增；本仓**不支持** ⇒ 不设置/`false`） */
  extendedAgentCard?: boolean;
}

/** 协议扩展声明（v1.0 §4.4.4）：位于 `capabilities.extensions` */
export interface A2AAgentExtension {
  /** 扩展 URI（含版本） */
  uri: string;
  description?: string;
  /** `true` ⇒ 客户端**必须**理解并遵守；服务端不支持时 MUST 报错（`-32008`） */
  required?: boolean;
  params?: Record<string, unknown>;
}

/**
 * 绑定与多租户路由条目（v1.0 §AgentInterface）。
 *
 * **v1.0 变更**（官方 "What's New in v1.0" §AgentCard）：`url` / `protocolVersion` 等**顶层字段
 * 已移除**，改由本对象承载（"Primary endpoint now in `supportedInterfaces[0].url`"）。
 * `protocolBinding` 在 v1.0 是**开放字符串**（核心官方值 `JSONRPC` / `GRPC` / `HTTP+JSON`）；
 * 本仓**只产出** `JSONRPC`（T4 已实现 JSON-RPC 绑定 + SSE）⇒ 类型收窄为字面量。
 */
export interface A2AAgentInterface {
  /** 该绑定的端点 URL（HTTP 系须为绝对 URL） */
  url: string;
  /** 协议绑定（核心值之一；本仓恒为 `JSONRPC`） */
  protocolBinding: 'JSONRPC';
  /** 该绑定所用的协议版本（v1.0 起**按接口声明**） */
  protocolVersion: string;
  /** 多租户路由用（不透明字符串）；未设置则**必须省略**该字段 */
  tenant?: string;
}

/**
 * Agent Card：Agent 的数字名片（**v1.0 形状**）。
 *
 * v1.0 相对 v0.3 的**破坏性变更**（官方 "What's New in v1.0" §AgentCard，2026-10-07 核对）：
 * - ⛔ 移除顶层 `protocolVersion` —— 改由 `supportedInterfaces[].protocolVersion`
 * - ⛔ 移除顶层 `url` —— 改由 `supportedInterfaces[0].url`
 * - ⛔ 移除 `preferredTransport` / `additionalInterfaces` —— 并入 `supportedInterfaces`
 * - ⛔ 移除 `supportsAuthenticatedExtendedCard` —— 改由 `capabilities.extendedAgentCard`
 * - ✅ 新增 `supportedInterfaces`（**REQUIRED**，按偏好排序）
 *
 * `securityRequirements` 依 v1.0 proto（`security_requirements`；官方 spec §8.5 样例同此名）。
 */
export interface A2AAgentCard {
  name: string;
  description: string;
  /** 支持的接口（**REQUIRED**，首个为偏好项） */
  supportedInterfaces: A2AAgentInterface[];
  provider: { organization: string; url?: string };
  version: string;
  documentationUrl?: string;
  capabilities: A2AAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  /** 安全声明（§5.3）：**禁止**内嵌静态密钥 */
  securitySchemes?: Record<string, unknown>;
  securityRequirements?: Array<Record<string, string[]>>;
}

/* ==================== JSON-RPC 2.0（§2.5 / §6.2） ==================== */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

/**
 * JSON-RPC 标准错误码 + A2A 语义错误码（§6.2「错误映射」）。
 * 说明：`-32001/-32002` 属 A2A 自定义段（JSON-RPC 规范保留 -32000~-32099 给服务端自定义）。
 */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  TaskNotFound: -32001,
  TaskNotCancelable: -32002,
  /** A2A 专属段（spec §5.4 映射表；`-32001..-32099` 为服务端自定义保留） */
  PushNotificationNotSupported: -32003,
  UnsupportedOperation: -32004,
  ContentTypeNotSupported: -32005,
  InvalidAgentResponse: -32006,
  ExtendedAgentCardNotConfigured: -32007,
  ExtensionSupportRequired: -32008,
  VersionNotSupported: -32009,
} as const;

/**
 * 支持的 RPC 方法名（§4.2 抽象操作 ↔ §9.3 JSON-RPC 绑定）。
 *
 * **v1.0.0**：JSON-RPC 的 `method` 取值**即抽象操作名（PascalCase）**；v0.3 的绑定名
 * （`message/send` / `tasks/get` / `tasks/cancel`）属**破坏性改名**（论文 A5，2026-10-06）。
 */
export const A2A_METHODS = {
  /** 发送消息并（同步）执行 */
  SendMessage: 'SendMessage',
  /** 发送消息并以 SSE 订阅该任务的后续事件 */
  SendStreamingMessage: 'SendStreamingMessage',
  /** 按 id 取任务 */
  GetTask: 'GetTask',
  /** 列出任务（cursor 分页） */
  ListTasks: 'ListTasks',
  /** 取消任务 */
  CancelTask: 'CancelTask',
  /** 订阅既有任务的后续事件（SSE） */
  SubscribeToTask: 'SubscribeToTask',
  /** 以下 4 个推送通知配置操作 + 扩展卡：本仓**未实现** ⇒ 按能力门控**如实**返回标准错误
   *（`-32003` / `-32004`，见 `.trae/specs/a2a-jsonrpc-binding.md` §3） */
  CreateTaskPushNotificationConfig: 'CreateTaskPushNotificationConfig',
  GetTaskPushNotificationConfig: 'GetTaskPushNotificationConfig',
  ListTaskPushNotificationConfigs: 'ListTaskPushNotificationConfigs',
  DeleteTaskPushNotificationConfig: 'DeleteTaskPushNotificationConfig',
  GetExtendedAgentCard: 'GetExtendedAgentCard',
} as const;

/**
 * 方法名别名（§11.3 v0.3→v1.0 更名属破坏性变更；§12.4 建议渐进迁移）。
 * canonical = v1.0 抽象操作名（PascalCase）；别名 = v0.3 绑定名（含更早的 `tasks/send`）。
 */
export const A2A_METHOD_ALIASES: Record<string, string> = {
  // canonical（v1.0 抽象操作名）
  [A2A_METHODS.SendMessage]: A2A_METHODS.SendMessage,
  [A2A_METHODS.SendStreamingMessage]: A2A_METHODS.SendStreamingMessage,
  [A2A_METHODS.GetTask]: A2A_METHODS.GetTask,
  [A2A_METHODS.ListTasks]: A2A_METHODS.ListTasks,
  [A2A_METHODS.CancelTask]: A2A_METHODS.CancelTask,
  [A2A_METHODS.SubscribeToTask]: A2A_METHODS.SubscribeToTask,
  [A2A_METHODS.CreateTaskPushNotificationConfig]:
    A2A_METHODS.CreateTaskPushNotificationConfig,
  [A2A_METHODS.GetTaskPushNotificationConfig]:
    A2A_METHODS.GetTaskPushNotificationConfig,
  [A2A_METHODS.ListTaskPushNotificationConfigs]:
    A2A_METHODS.ListTaskPushNotificationConfigs,
  [A2A_METHODS.DeleteTaskPushNotificationConfig]:
    A2A_METHODS.DeleteTaskPushNotificationConfig,
  [A2A_METHODS.GetExtendedAgentCard]: A2A_METHODS.GetExtendedAgentCard,
  // v0.3 绑定名（迁移别名）
  'message/send': A2A_METHODS.SendMessage,
  'message/stream': A2A_METHODS.SendStreamingMessage,
  'tasks/get': A2A_METHODS.GetTask,
  'tasks/list': A2A_METHODS.ListTasks,
  'tasks/cancel': A2A_METHODS.CancelTask,
  'tasks/resubscribe': A2A_METHODS.SubscribeToTask,
  'tasks/pushNotificationConfig/create':
    A2A_METHODS.CreateTaskPushNotificationConfig,
  'tasks/pushNotificationConfig/get': A2A_METHODS.GetTaskPushNotificationConfig,
  'tasks/pushNotificationConfig/list':
    A2A_METHODS.ListTaskPushNotificationConfigs,
  'tasks/pushNotificationConfig/delete':
    A2A_METHODS.DeleteTaskPushNotificationConfig,
  'agent/getAuthenticatedExtendedCard': A2A_METHODS.GetExtendedAgentCard,
  // 更早的绑定名
  'tasks/send': A2A_METHODS.SendMessage,
};

/* ==================== 操作参数 / 响应（v1.0 §3.1–§3.2；本项目**落地子集**） ==================== */

/** `SendMessageRequest`（§3.2.1） */
export interface A2ASendMessageRequest {
  message: A2AMessage;
  configuration?: A2ASendMessageConfiguration;
  metadata?: Record<string, unknown>;
}

/** `SendMessageConfiguration`（§3.2.2）—— 本项目只读 `historyLength` / `returnImmediately` */
export interface A2ASendMessageConfiguration {
  acceptedOutputModes?: string[];
  /** 未设置 ⇒ 服务端默认量；`0` ⇒ 不返回历史（`history` SHOULD 省略）；`>0` ⇒ 最多最近 N 条 */
  historyLength?: number;
  /** 默认 `false` ⇒ 阻塞至终态/中断态（§3.2.2 Execution Mode） */
  returnImmediately?: boolean;
}

/** `SendMessageResponse`（**oneof**：`task` \| `message`，恰好一个） */
export interface A2ASendMessageResponse {
  task?: A2ATask;
  message?: A2AMessage;
}

/** `GetTaskRequest`（§3.1.3） */
export interface A2AGetTaskRequest {
  id: string;
  historyLength?: number;
}

/** `ListTasksRequest`（§3.1.4；cursor 分页） */
export interface A2AListTasksRequest {
  contextId?: string;
  status?: A2ATaskState;
  /** 未指定 ⇒ 最多 {@link A2A_LIST_TASKS_DEFAULT_PAGE_SIZE}；范围 [1, 100] */
  pageSize?: number;
  /** 来自上次响应 `nextPageToken` */
  pageToken?: string;
  /** `false` ⇒ `artifacts` 字段应**整体省略**（不得空数组） */
  includeArtifacts?: boolean;
}

/** `ListTasksResponse`（§3.1.4；**4 字段均 REQUIRED**，`nextPageToken` 无更多结果时为空串） */
export interface A2AListTasksResponse {
  tasks: A2ATask[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
}

/** `ListTasks` 分页常量（§3.1.4） */
export const A2A_LIST_TASKS_DEFAULT_PAGE_SIZE = 50;
export const A2A_LIST_TASKS_MIN_PAGE_SIZE = 1;
export const A2A_LIST_TASKS_MAX_PAGE_SIZE = 100;

/** `CancelTaskRequest`（§3.1.5） */
export interface A2ACancelTaskRequest {
  id: string;
}

/** `SubscribeToTaskRequest`（§3.1.6） */
export interface A2ASubscribeToTaskRequest {
  id: string;
}

/** `GetExtendedAgentCardRequest`（§3.1.11） */
export interface A2AGetExtendedAgentCardRequest {
  tenant?: string;
}

/* ==================== 流式响应（v1.0 §3.2.3；**移除 `kind`** ⇒ 按 JSON 成员名判别） ==================== */

/** `TaskStatusUpdateEvent`（§4.2.1） */
export interface A2ATaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  metadata?: Record<string, unknown>;
}

/** `TaskArtifactUpdateEvent`（§4.2.2；v1.0 两事件对象**均无 `final` 字段**） */
export interface A2ATaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  /** 同 ID 前序工件追加 */
  append?: boolean;
  /** 该工件最后一个分片 */
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * `StreamResponse`（**oneof**，恰好一个成员）。
 *
 * v1.0 移除了 v0.3 的内联 `kind` 判别字段（规范原文："The `kind` field is no longer part
 * of the protocol and should not be emitted"）⇒ 判别改由**成员名自身**承担：
 * `task` / `message` / `statusUpdate` / `artifactUpdate`。
 */
export interface A2AStreamResponse {
  task?: A2ATask;
  message?: A2AMessage;
  statusUpdate?: A2ATaskStatusUpdateEvent;
  artifactUpdate?: A2ATaskArtifactUpdateEvent;
}

/** 服务参数头名（v1.0 §3.2.6 / §9.2；HTTP 绑定 MUST 用请求头，大小写不敏感） */
export const A2A_HEADER_VERSION = 'A2A-Version';
export const A2A_HEADER_EXTENSIONS = 'A2A-Extensions';

/**
 * A2A v1.0 **JSON-RPC 绑定端点路径**（本仓自定；非规范固定值）。
 *
 * **单一事实源**：HTTP 路由（`a2a-routes.ts`）与 Agent Card 的
 * `supportedInterfaces[0].url`（`agentCard.ts`）**共用**本常量 ⇒ 不会漂移。
 */
export const A2A_RPC_PATH = '/v1/a2a/rpc';
