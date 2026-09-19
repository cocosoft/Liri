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

/** 任务状态（§3） */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected';

/**
 * 终态集合（§3.4 任务不可变性）：进入终态后**不可重启**。
 * 细化请求必须走同一 `contextId` 新建任务，而不是复用终态任务。
 */
export const A2A_TERMINAL_STATES: readonly A2ATaskState[] = [
  'completed',
  'canceled',
  'failed',
  'rejected',
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
  extensions?: string[];
}

/** 绑定与多租户路由条目（§6.2 / §6.3） */
export interface A2AAgentInterface {
  url: string;
  protocolBinding: 'JSONRPC';
  protocolVersion: string;
  /** 多租户路由用（不透明字符串）；未设置则**必须省略**该字段（§6.3） */
  tenant?: string;
}

/** Agent Card：Agent 的数字名片（§5.1） */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  provider: { organization: string; url?: string };
  version: string;
  capabilities: A2AAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  supportedInterfaces?: A2AAgentInterface[];
  /** 安全声明（§5.3）：**禁止**内嵌静态密钥 */
  securitySchemes?: Record<string, unknown>;
  security?: Array<Record<string, string[]>>;
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
} as const;

/** 支持的 RPC 方法名（§4.4 抽象操作 ↔ JSON-RPC 绑定名） */
export const A2A_METHODS = {
  /** 发送消息并（同步）执行 */
  SendMessage: 'message/send',
  /** 按 id 取任务 */
  GetTask: 'tasks/get',
  /** 取消任务 */
  CancelTask: 'tasks/cancel',
} as const;

/**
 * 方法名别名（§11.3 v0.3→v1.0 更名属破坏性变更；§12.4 建议渐进迁移）。
 * 同时接受 v1.0 抽象操作名（PascalCase）与早期 JSON-RPC 绑定名，避免对端因命名差异无法互操作。
 */
export const A2A_METHOD_ALIASES: Record<string, string> = {
  // canonical（JSON-RPC 绑定名）
  [A2A_METHODS.SendMessage]: A2A_METHODS.SendMessage,
  [A2A_METHODS.GetTask]: A2A_METHODS.GetTask,
  [A2A_METHODS.CancelTask]: A2A_METHODS.CancelTask,
  // v1.0 抽象操作名（PascalCase）
  SendMessage: A2A_METHODS.SendMessage,
  GetTask: A2A_METHODS.GetTask,
  CancelTask: A2A_METHODS.CancelTask,
  // 早期绑定名
  'tasks/send': A2A_METHODS.SendMessage,
};
