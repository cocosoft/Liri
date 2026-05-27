/**
 * Agent群组类型定义
 */

export type SwarmTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SwarmTask {
  id: string;
  description: string;
  input?: Record<string, unknown>;
  priority?: number;
  createdAt: number;
}

export interface SwarmResult {
  taskId: string;
  agentId: string;
  success: boolean;
  content?: string;
  error?: string;
  timestamp: number;
}

export interface ISwarmAgent {
  id: string;
  run(task: SwarmTask): Promise<SwarmResult>;
  cancel(): void;
  getStatus(): AgentStatus;
}

export type AgentStatus = 'idle' | 'busy' | 'error';

export interface SwarmExecutionOptions {
  parallel?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface SwarmConfig {
  maxAgents?: number;
  defaultParallel?: boolean;
  defaultTimeoutMs?: number;
}
