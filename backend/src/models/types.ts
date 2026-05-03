export interface AgentStrategy {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly model: string;
  readonly systemPrompt: string;
}

export interface AgentTask {
  id: string;
  type: string;
  description: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  success: boolean;
  output: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  sessionId: string;
  configuration: Record<string, unknown>;
  history: AgentTask[];
}

export type AgentState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
