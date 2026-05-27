export type TraceRecordStatus = 'success' | 'failure' | 'running' | 'cancelled';

export type TraceExportFormat = 'json' | 'csv' | 'markdown' | 'html';

export interface TraceStep {
  id: string;
  sessionId: string;
  command: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: TraceRecordStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceSession {
  id: string;
  name: string;
  description?: string;
  startedAt: number;
  completedAt?: number;
  stepCount: number;
  status: TraceRecordStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CommandTrace {
  session: TraceSession;
  steps: TraceStep[];
}

export interface TraceQuery {
  sessionId?: string;
  command?: string;
  status?: TraceRecordStatus;
  since?: number;
  until?: number;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface TraceSummary {
  totalSessions: number;
  totalSteps: number;
  successRate: number;
  avgDurationMs: number;
  topCommands: Array<{ command: string; count: number }>;
  statusDistribution: Record<string, number>;
  recentSessions: TraceSession[];
}

export interface TrajectoryConfig {
  maxSessions: number;
  maxStepsPerSession: number;
  storageDir?: string;
  autoCleanupDays: number;
  enabled: boolean;
}
