export type AclMessageRole = 'request' | 'response' | 'notification';

export type AclMessagePriority = 'low' | 'normal' | 'high';

export type AclTransportType = 'stdio' | 'tcp' | 'ws' | 'ipc';

export type AclSessionStatus = 'active' | 'ended' | 'timeout';

export interface AclAgentInfo {
  id: string;
  name: string;
  version: string;
  capabilities: AclCapability[];
  transport: AclTransportType;
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

export interface AclCapability {
  name: string;
  version: string;
  description?: string;
  operations: string[];
}

export interface AclMessage {
  id: string;
  type: string;
  role: AclMessageRole;
  sender: string;
  target?: string;
  sessionId?: string;
  payload: unknown;
  priority: AclMessagePriority;
  correlationId?: string;
  timestamp: number;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

export interface AclHandshake {
  agent: AclAgentInfo;
  timestamp: number;
  signature?: string;
}

export interface AclError {
  code: string;
  message: string;
  details?: unknown;
}

export interface AclResponse {
  success: boolean;
  message?: AclMessage;
  error?: AclError;
}

export interface AclSessionInfo {
  id: string;
  agents: string[];
  status: AclSessionStatus;
  createdAt: number;
  endedAt?: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

export interface AclTransportConfig {
  type: AclTransportType;
  host?: string;
  port?: number;
  path?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface AclServerConfig {
  agent: AclAgentInfo;
  transport: AclTransportConfig;
  maxSessions?: number;
  maxMessageSize?: number;
  heartbeatInterval?: number;
}

export interface AclClientConfig {
  agent: AclAgentInfo;
  target: AclAgentInfo;
  transport: AclTransportConfig;
  heartbeatInterval?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export type AclMessageHandler = (
  message: AclMessage,
  context: { agent: AclAgentInfo; sessionId?: string }
) => Promise<AclMessage | void> | AclMessage | void;

export interface AclHandlerRegistration {
  pattern: string;
  handler: AclMessageHandler;
  description?: string;
}

export interface AclMetrics {
  totalMessagesSent: number;
  totalMessagesReceived: number;
  activeSessions: number;
  connectedClients: number;
  uptimeMs: number;
  errors: number;
}

export type AclEventCallback = (...args: unknown[]) => void;
