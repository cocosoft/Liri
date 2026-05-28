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
export type NodeStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type NodeType = 'builtin' | 'plugin' | 'remote' | 'agent' | 'channel';

export interface NodeDefinition {
  id: string;
  name: string;
  type: NodeType;
  version: string;
  description?: string;
  capabilities?: string[];
  endpoint?: string;
  metadata?: Record<string, unknown>;
}

export interface InvokeRequest {
  nodeId: string;
  operation: string;
  args: Record<string, unknown>;
  timeout?: number;
  priority?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface InvokeResponse {
  success: boolean;
  requestId: string;
  result?: unknown;
  error?: string;
  durationMs: number;
  nodeId: string;
}

export interface ExecPolicyConfig {
  maxRetries: number;
  retryDelayMs: number;
  retryBackoff: 'linear' | 'exponential';
  timeout: number;
  maxConcurrency: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
}

export interface NodeSession {
  id: string;
  nodeId: string;
  status: NodeStatus;
  startedAt: number;
  completedAt?: number;
  operations: number;
  errors: number;
  metadata?: Record<string, unknown>;
}

export interface NodeMetrics {
  nodeId: string;
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  avgDurationMs: number;
  lastInvokedAt?: number;
  isCircuitBroken: boolean;
  errorRate: number;
}
