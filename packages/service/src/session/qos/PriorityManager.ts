import type {
  SessionPriority,
  SessionPriorityLevel,
  QoSLevel,
} from './SessionPriority';
import { DEFAULT_PRIORITY, PRIORITY_ORDER } from './SessionPriority';

export interface PrioritizableSession {
  id: string;
  priority?: SessionPriority;
}

export class PriorityManager {
  private sessionPriorities = new Map<string, SessionPriority>();

  setPriority(
    sessionId: string,
    level: SessionPriorityLevel,
    qos?: QoSLevel
  ): void {
    this.sessionPriorities.set(sessionId, {
      level,
      qos: qos ?? DEFAULT_PRIORITY.qos,
      weight: DEFAULT_PRIORITY.weight,
    });
  }

  setFullPriority(sessionId: string, priority: SessionPriority): void {
    this.sessionPriorities.set(sessionId, priority);
  }

  getPriority(sessionId: string): SessionPriority {
    return this.sessionPriorities.get(sessionId) ?? { ...DEFAULT_PRIORITY };
  }

  removePriority(sessionId: string): void {
    this.sessionPriorities.delete(sessionId);
  }

  sortByPriority(sessions: PrioritizableSession[]): PrioritizableSession[] {
    return [...sessions].sort((a, b) => {
      const pa = a.priority ?? DEFAULT_PRIORITY;
      const pb = b.priority ?? DEFAULT_PRIORITY;
      const orderDiff = PRIORITY_ORDER[pa.level] - PRIORITY_ORDER[pb.level];
      if (orderDiff !== 0) return orderDiff;
      return pb.weight - pa.weight;
    });
  }

  getSessionsByPriority(level: SessionPriorityLevel): string[] {
    const result: string[] = [];
    for (const [id, p] of this.sessionPriorities) {
      if (p.level === level) result.push(id);
    }
    return result;
  }

  getPriorityDistribution(): Record<SessionPriorityLevel, number> {
    const dist: Record<SessionPriorityLevel, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };
    for (const p of this.sessionPriorities.values()) {
      dist[p.level]++;
    }
    return dist;
  }

  clear(): void {
    this.sessionPriorities.clear();
  }
}
