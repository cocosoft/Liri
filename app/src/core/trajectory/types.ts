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
