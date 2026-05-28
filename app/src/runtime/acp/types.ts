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
 * ACP 协议类型定义（归一化版）
 * 合并了原 agent/acp/ 和 core/acp/ 两套类型体系
 * 对标 OpenClaw acp/ 类型体系
 */

/** ACP 消息类型（合并 AcpMessageType + AclMessageRole） */
export type AcpMessageType =
  | 'request'
  | 'response'
  | 'notification'
  | 'event'
  | 'error'
  | 'ping'
  | 'pong';

export type AcpMessagePriority = 'low' | 'normal' | 'high';

export type AcpTransportType = 'stdio' | 'tcp' | 'ws' | 'ipc';

export type AcpSessionStatus = 'active' | 'ended' | 'timeout';

/** Agent 信息（对标 OpenClaw AgentInfo） */
export interface AcpAgentInfo {
  id: string;
  name: string;
  version: string;
  capabilities: AcpCapability[];
  transport: AcpTransportType;
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

export interface AcpCapability {
  name: string;
  version: string;
  description?: string;
  operations: string[];
}

/** ACP 消息（合并两套体系的字段） */
export interface AcpMessage {
  id: string;
  type: string;
  role: AcpMessageType;
  sender: string;
  target?: string;
  sessionId?: string;
  payload: unknown;
  priority: AcpMessagePriority;
  correlationId?: string;
  timestamp: number;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface AcpHandshake {
  agent: AcpAgentInfo;
  timestamp: number;
  signature?: string;
}

export interface AcpError {
  code: string;
  message: string;
  details?: unknown;
}

export interface AcpResponse {
  success: boolean;
  message?: AcpMessage;
  error?: AcpError;
}

export interface AcpSessionInfo {
  id: string;
  agents: string[];
  status: AcpSessionStatus;
  createdAt: number;
  endedAt?: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

export interface AcpTransportConfig {
  type: AcpTransportType;
  host?: string;
  port?: number;
  path?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface AcpServerConfig {
  agent: AcpAgentInfo;
  transport: AcpTransportConfig;
  maxSessions?: number;
  maxMessageSize?: number;
  heartbeatInterval?: number;
}

export interface AcpClientConfig {
  agent: AcpAgentInfo;
  target: AcpAgentInfo;
  transport: AcpTransportConfig;
  heartbeatInterval?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export type AcpMessageHandler = (
  message: AcpMessage,
  context: { agent: AcpAgentInfo; sessionId?: string }
) => Promise<AcpMessage | void> | AcpMessage | void;

export interface AcpHandlerRegistration {
  pattern: string;
  handler: AcpMessageHandler;
  description?: string;
}

export interface AcpMetrics {
  totalMessagesSent: number;
  totalMessagesReceived: number;
  activeSessions: number;
  connectedClients: number;
  uptimeMs: number;
  errors: number;
}

export type AcpEventCallback = (...args: unknown[]) => void;

// ── 向下兼容类型别名（Acl* → Acp*） ──
/** @deprecated 使用 AcpAgentInfo */
export type AclAgentInfo = AcpAgentInfo;
/** @deprecated 使用 AcpCapability */
export type AclCapability = AcpCapability;
/** @deprecated 使用 AcpMessage */
export type AclMessage = AcpMessage;
/** @deprecated 使用 AcpMessageType */
export type AclMessageRole = AcpMessageType;
/** @deprecated 使用 AcpMessagePriority */
export type AclMessagePriority = AcpMessagePriority;
/** @deprecated 使用 AcpTransportType */
export type AclTransportType = AcpTransportType;
/** @deprecated 使用 AcpSessionStatus */
export type AclSessionStatus = AcpSessionStatus;
/** @deprecated 使用 AcpHandshake */
export type AclHandshake = AcpHandshake;
/** @deprecated 使用 AcpError */
export type AclError = AcpError;
/** @deprecated 使用 AcpResponse */
export type AclResponse = AcpResponse;
/** @deprecated 使用 AcpSessionInfo */
export type AclSessionInfo = AcpSessionInfo;
/** @deprecated 使用 AcpTransportConfig */
export type AclTransportConfig = AcpTransportConfig;
/** @deprecated 使用 AcpServerConfig */
export type AclServerConfig = AcpServerConfig;
/** @deprecated 使用 AcpClientConfig */
export type AclClientConfig = AcpClientConfig;
/** @deprecated 使用 AcpMessageHandler */
export type AclMessageHandler = AcpMessageHandler;
/** @deprecated 使用 AcpHandlerRegistration */
export type AclHandlerRegistration = AcpHandlerRegistration;
/** @deprecated 使用 AcpMetrics */
export type AclMetrics = AcpMetrics;
/** @deprecated 使用 AcpEventCallback */
export type AclEventCallback = AcpEventCallback;
