/**
 * 远程Agent类型定义
 */

export type SessionStatus = 'connected' | 'disconnected' | 'error';

export type ProtocolType = 'websocket' | 'http';

export interface RemoteSession {
  id: string;
  execute(agentId: string, task: RemoteAgentTask): Promise<RemoteExecutionResult>;
  disconnect(): void;
  getStatus(): SessionStatus;
}

export interface RemoteAgentTask {
  id: string;
  agentId: string;
  description: string;
  input?: Record<string, any>;
  timeoutMs?: number;
}

export interface RemoteExecutionResult {
  taskId: string;
  sessionId: string;
  success: boolean;
  content?: string;
  error?: string;
  timestamp: number;
  durationMs?: number;
}

export interface RemoteAgentProtocol {
  type: ProtocolType;
  connect(url: string, options?: ProtocolOptions): Promise<void>;
  disconnect(): void;
  send(data: RemoteAgentTask): Promise<RemoteExecutionResult>;
  isConnected(): boolean;
}

export interface ProtocolOptions {
  timeout?: number;
  retryCount?: number;
  headers?: Record<string, string>;
}

export interface RemoteAgentConfig {
  protocol: ProtocolType;
  url: string;
  options?: ProtocolOptions;
}