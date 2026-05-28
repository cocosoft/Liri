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
 * 远程Agent类型定义
 */

export type SessionStatus = 'connected' | 'disconnected' | 'error';

export type ProtocolType = 'websocket' | 'http';

export interface RemoteSession {
  id: string;
  execute(
    agentId: string,
    task: RemoteAgentTask
  ): Promise<RemoteExecutionResult>;
  disconnect(): void;
  getStatus(): SessionStatus;
}

export interface RemoteAgentTask {
  id: string;
  agentId: string;
  description: string;
  input?: Record<string, unknown>;
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

export interface RemoteAgentExecutor {
  connect(): Promise<void>;
  disconnect(): void;
  execute(
    agentId: string,
    task: Omit<RemoteAgentTask, 'agentId'>
  ): Promise<RemoteExecutionResult>;
  getStatus(): SessionStatus;
  getSessionId(): string;
}
