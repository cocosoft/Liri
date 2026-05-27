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
