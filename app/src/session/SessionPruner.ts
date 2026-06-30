import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import type { SessionStorage } from './SessionStorage';

const logger = new Logger({ level: LogLevel.INFO });

export interface PrunerOptions {
  maxSessions?: number;
  maxAgeDays?: number;
  activeBufferMinutes?: number;
  excludeActive?: boolean;
}

export interface PruneResult {
  deletedCount: number;
  deletedIds: string[];
  preservedCount: number;
  preservedIds: string[];
  reason: 'count' | 'age' | 'both' | 'none';
}

const DEFAULT_MAX_SESSIONS = 1000;
const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_ACTIVE_BUFFER_MINUTES = 60;

export class SessionPruner {
  private storage: SessionStorage;
  private maxSessions: number;
  private maxAgeDays: number;
  private activeBufferMinutes: number;
  private excludeActive: boolean;

  constructor(storage: SessionStorage, options: PrunerOptions = {}) {
    this.storage = storage;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
    this.activeBufferMinutes =
      options.activeBufferMinutes ?? DEFAULT_ACTIVE_BUFFER_MINUTES;
    this.excludeActive = options.excludeActive ?? true;
  }

  async prune(): Promise<PruneResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('SessionPruner.prune');

    try {
      const sessionIds = await this.storage.listSessions();
      if (sessionIds.length === 0) {
        otel.endSpan(span);
        return {
          deletedCount: 0,
          deletedIds: [],
          preservedCount: 0,
          preservedIds: [],
          reason: 'none',
        };
      }

      const now = Date.now();
      const cutoffTime = now - this.maxAgeDays * 24 * 60 * 60 * 1000;
      const activeCutoff = now - this.activeBufferMinutes * 60 * 1000;

      const sessionsWithTime: {
        id: string;
        updatedAt: number;
        isActive: boolean;
      }[] = [];

      for (const id of sessionIds) {
        const session = await this.storage.loadSession(id);
        if (!session) continue;

        const updatedAt =
          session.updatedAt instanceof Date
            ? session.updatedAt.getTime()
            : new Date(session.updatedAt).getTime();

        const isActive = this.excludeActive && updatedAt >= activeCutoff;
        sessionsWithTime.push({ id, updatedAt, isActive });
      }

      sessionsWithTime.sort((a, b) => a.updatedAt - b.updatedAt);

      let reason: PruneResult['reason'] = 'none';

      let toDelete = new Set<string>();

      const ageCandidates = sessionsWithTime.filter(
        (s) => !s.isActive && s.updatedAt < cutoffTime
      );
      if (ageCandidates.length > 0) {
        reason = 'age';
        for (const s of ageCandidates) {
          toDelete.add(s.id);
        }
      }

      const remaining = sessionsWithTime.filter((s) => !toDelete.has(s.id));
      if (remaining.length > this.maxSessions) {
        reason = reason === 'age' ? 'both' : 'count';
        const excess = remaining.slice(0, remaining.length - this.maxSessions);
        for (const s of excess) {
          toDelete.add(s.id);
        }
      }

      const deletedIds: string[] = [];
      for (const id of toDelete) {
        try {
          await this.storage.deleteSession(id);
          deletedIds.push(id);
        } catch (err) {
          logger.error(`Failed to delete session ${id} during pruning`, err);
        }
      }

      const preservedIds = sessionsWithTime
        .filter((s) => !toDelete.has(s.id))
        .map((s) => s.id);

      logger.info(
        `Session pruning completed: deleted ${deletedIds.length}, preserved ${preservedIds.length} (reason: ${reason})`
      );

      otel.endSpan(span);
      return {
        deletedCount: deletedIds.length,
        deletedIds,
        preservedCount: preservedIds.length,
        preservedIds,
        reason,
      };
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      throw e;
    }
  }

  async getPruneEstimate(): Promise<{
    total: number;
    ageCandidates: number;
    countCandidates: number;
    activeSessions: number;
  }> {
    const sessionIds = await this.storage.listSessions();
    if (sessionIds.length === 0) {
      return {
        total: 0,
        ageCandidates: 0,
        countCandidates: 0,
        activeSessions: 0,
      };
    }

    const now = Date.now();
    const cutoffTime = now - this.maxAgeDays * 24 * 60 * 60 * 1000;
    const activeCutoff = now - this.activeBufferMinutes * 60 * 1000;

    let total = 0;
    let ageCandidates = 0;
    let activeSessions = 0;

    const allWithTime: { id: string; updatedAt: number }[] = [];

    for (const id of sessionIds) {
      const session = await this.storage.loadSession(id);
      if (!session) continue;

      total++;
      const updatedAt =
        session.updatedAt instanceof Date
          ? session.updatedAt.getTime()
          : new Date(session.updatedAt).getTime();

      if (updatedAt < cutoffTime) {
        ageCandidates++;
      }

      if (this.excludeActive && updatedAt >= activeCutoff) {
        activeSessions++;
      }

      allWithTime.push({ id, updatedAt });
    }

    allWithTime.sort((a, b) => a.updatedAt - b.updatedAt);

    const nonActive = allWithTime.filter(
      (s) => !(this.excludeActive && s.updatedAt >= activeCutoff)
    );

    let countCandidates = 0;
    if (nonActive.length > this.maxSessions) {
      countCandidates = nonActive.length - this.maxSessions;
    }

    return { total, ageCandidates, countCandidates, activeSessions };
  }

  updateOptions(options: Partial<PrunerOptions>): void {
    if (options.maxSessions !== undefined)
      this.maxSessions = options.maxSessions;
    if (options.maxAgeDays !== undefined) this.maxAgeDays = options.maxAgeDays;
    if (options.activeBufferMinutes !== undefined)
      this.activeBufferMinutes = options.activeBufferMinutes;
    if (options.excludeActive !== undefined)
      this.excludeActive = options.excludeActive;
  }
}
