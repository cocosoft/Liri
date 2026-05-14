/**
 * ACP (Agent Communication Protocol)
 * 对标OpenClaw acp/
 * Agent间通信协议
 */

export type AcpMessageType =
  | 'request'
  | 'response'
  | 'event'
  | 'error'
  | 'ping'
  | 'pong';

export type AcpPriority = 'low' | 'normal' | 'high' | 'critical';

export interface AcpMessage {
  id: string;
  type: AcpMessageType;
  source: string;
  target: string;
  method?: string;
  payload?: unknown;
  correlationId?: string;
  priority: AcpPriority;
  timestamp: number;
  ttl?: number;
}

export interface AcpSession {
  id: string;
  clientId: string;
  serverId: string;
  state: 'connecting' | 'connected' | 'disconnected';
  createdAt: number;
  lastActivity: number;
  metadata?: Record<string, unknown>;
}

export interface AcpHandler {
  (message: AcpMessage): Promise<AcpMessage> | AcpMessage;
}

export interface AcpServerConfig {
  serverId: string;
  maxSessions?: number;
  messageTimeout?: number;
  pingInterval?: number;
}

export { AcpServer } from './AcpServer.js';
export { AcpClient } from './AcpClient.js';
