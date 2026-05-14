import { EventEmitter } from 'events';
import {
  TraceStep,
  TraceSession,
  TraceQuery,
  TraceSummary,
  TraceRecordStatus,
  TrajectoryConfig,
  CommandTrace,
} from './types.js';

const DEFAULT_CONFIG: TrajectoryConfig = {
  maxSessions: 100,
  maxStepsPerSession: 1000,
  autoCleanupDays: 30,
  enabled: true,
};

export class TrajectoryRuntime extends EventEmitter {
  private sessions: Map<string, TraceSession> = new Map();
  private steps: Map<string, TraceStep[]> = new Map();
  private config: TrajectoryConfig;

  constructor(config: Partial<TrajectoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  startSession(
    name: string,
    description?: string,
    tags?: string[]
  ): TraceSession {
    this.enforceMaxSessions();

    const session: TraceSession = {
      id: this.generateId(),
      name,
      description,
      startedAt: Date.now(),
      stepCount: 0,
      status: 'running',
      tags,
    };

    this.sessions.set(session.id, session);
    this.steps.set(session.id, []);
    this.emit('session:started', session);

    return session;
  }

  completeSession(
    sessionId: string,
    status: TraceRecordStatus = 'success'
  ): boolean {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return false;
    }

    session.status = status;
    session.completedAt = Date.now();
    this.emit('session:completed', session);

    return true;
  }

  recordStep(
    sessionId: string,
    command: string,
    args: Record<string, unknown>,
    parentId?: string
  ): TraceStep | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    const step: TraceStep = {
      id: this.generateId(),
      sessionId,
      command,
      args,
      status: 'running',
      startedAt: Date.now(),
      parentId,
    };

    const sessionSteps = this.steps.get(sessionId)!;

    if (sessionSteps.length >= this.config.maxStepsPerSession) {
      sessionSteps.shift();
    }

    sessionSteps.push(step);
    session.stepCount = sessionSteps.length;
    this.emit('step:recorded', step);

    return step;
  }

  completeStep(
    stepId: string,
    result: unknown,
    status: TraceRecordStatus = 'success'
  ): boolean {
    for (const [, sessionSteps] of this.steps) {
      const step = sessionSteps.find((s) => s.id === stepId);

      if (step) {
        step.result = result;
        step.status = status;
        step.completedAt = Date.now();
        step.durationMs = step.completedAt - step.startedAt;
        this.emit('step:completed', step);

        return true;
      }
    }

    return false;
  }

  failStep(stepId: string, error: string): boolean {
    for (const [, sessionSteps] of this.steps) {
      const step = sessionSteps.find((s) => s.id === stepId);

      if (step) {
        step.error = error;
        step.status = 'failure';
        step.completedAt = Date.now();
        step.durationMs = step.completedAt - step.startedAt;
        this.emit('step:failed', step);

        return true;
      }
    }

    return false;
  }

  getSession(sessionId: string): TraceSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSteps(sessionId: string): TraceStep[] {
    return this.steps.get(sessionId) || [];
  }

  getCommandTrace(sessionId: string): CommandTrace | undefined {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return undefined;
    }

    return { session, steps: this.steps.get(sessionId) || [] };
  }

  query(query: TraceQuery): TraceStep[] {
    let results: TraceStep[] = [];

    for (const [, sessionSteps] of this.steps) {
      results = results.concat(sessionSteps);
    }

    if (query.sessionId) {
      results = results.filter((s) => s.sessionId === query.sessionId);
    }

    if (query.command) {
      results = results.filter((s) => s.command.includes(query.command!));
    }

    if (query.status) {
      results = results.filter((s) => s.status === query.status);
    }

    if (query.since) {
      results = results.filter((s) => s.startedAt >= query.since!);
    }

    if (query.until) {
      results = results.filter((s) => s.startedAt <= query.until!);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((s) => {
        const session = this.sessions.get(s.sessionId);

        if (!session?.tags) {
          return false;
        }

        return query.tags!.some((t) => session.tags!.includes(t));
      });
    }

    results.sort((a, b) => b.startedAt - a.startedAt);

    if (query.offset) {
      results = results.slice(query.offset);
    }

    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  generateSummary(since?: number): TraceSummary {
    const sessions = Array.from(this.sessions.values());
    const allSteps: TraceStep[] = [];

    for (const [, sessionSteps] of this.steps) {
      allSteps.push(...sessionSteps);
    }

    const filteredSessions = since
      ? sessions.filter((s) => s.startedAt >= since)
      : sessions;

    const filteredSteps = since
      ? allSteps.filter((s) => s.startedAt >= since)
      : allSteps;

    const completedSteps = filteredSteps.filter((s) => s.status !== 'running');
    const successSteps = filteredSteps.filter((s) => s.status === 'success');
    const completedWithDuration = filteredSteps.filter(
      (s) => s.durationMs != null
    );

    const commandCount = new Map<string, number>();

    for (const step of filteredSteps) {
      commandCount.set(step.command, (commandCount.get(step.command) || 0) + 1);
    }

    const topCommands = Array.from(commandCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([command, count]) => ({ command, count }));

    const statusDist: Record<string, number> = {};

    for (const s of filteredSteps) {
      statusDist[s.status] = (statusDist[s.status] || 0) + 1;
    }

    const avgDuration =
      completedWithDuration.length > 0
        ? completedWithDuration.reduce(
            (sum, s) => sum + (s.durationMs || 0),
            0
          ) / completedWithDuration.length
        : 0;

    const recentSessions = filteredSessions
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 10);

    return {
      totalSessions: filteredSessions.length,
      totalSteps: filteredSteps.length,
      successRate:
        completedSteps.length > 0
          ? successSteps.length / completedSteps.length
          : 0,
      avgDurationMs: Math.round(avgDuration),
      topCommands,
      statusDistribution: statusDist,
      recentSessions,
    };
  }

  deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);

    this.steps.delete(sessionId);

    if (existed) {
      this.emit('session:deleted', sessionId);
    }

    return existed;
  }

  clear(): void {
    this.sessions.clear();
    this.steps.clear();
    this.emit('cleared');
  }

  cleanup(): number {
    const cutoff =
      Date.now() - this.config.autoCleanupDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const [id, session] of this.sessions) {
      if (session.startedAt < cutoff) {
        this.deleteSession(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  getConfig(): TrajectoryConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<TrajectoryConfig>): void {
    this.config = { ...this.config, ...patch };
    this.emit('config:updated', this.config);
  }

  private generateId(): string {
    return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private enforceMaxSessions(): void {
    if (this.sessions.size < this.config.maxSessions) {
      return;
    }

    const sorted = Array.from(this.sessions.entries()).sort(
      ([, a], [, b]) => a.startedAt - b.startedAt
    );

    const toDelete = sorted.slice(
      0,
      sorted.length - this.config.maxSessions + 1
    );

    for (const [id] of toDelete) {
      this.sessions.delete(id);
      this.steps.delete(id);
    }
  }
}

export const trajectoryRuntime = new TrajectoryRuntime();
