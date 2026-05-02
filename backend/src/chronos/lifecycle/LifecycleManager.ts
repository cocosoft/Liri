export type LifecyclePhase = 'created' | 'scheduled' | 'executing' | 'completed' | 'failed' | 'expired' | 'cancelled';

export interface LifecycleEvent {
  taskId: string;
  from: LifecyclePhase;
  to: LifecyclePhase;
  timestamp: number;
  reason?: string;
}

export interface LifecycleStatus {
  taskId: string;
  currentPhase: LifecyclePhase;
  events: LifecycleEvent[];
  createdAt: number;
  lastTransitionAt: number;
  executionCount: number;
  totalRuntime: number;
}

export interface ILifecycleManager {
  createTask(taskId: string): LifecycleStatus;
  transitionTo(taskId: string, phase: LifecyclePhase, reason?: string): boolean;
  getStatus(taskId: string): LifecycleStatus | undefined;
  getTasksInPhase(phase: LifecyclePhase): string[];
  cleanupExpiredTasks(maxAge: number): Promise<string[]>;
  cleanupCompletedTasks(): Promise<string[]>;
  getAllStatuses(): LifecycleStatus[];
}

const VALID_TRANSITIONS: Record<LifecyclePhase, LifecyclePhase[]> = {
  created: ['scheduled', 'cancelled', 'expired'],
  scheduled: ['executing', 'cancelled', 'expired'],
  executing: ['completed', 'failed', 'cancelled'],
  completed: ['scheduled', 'expired'],
  failed: ['scheduled', 'expired', 'cancelled'],
  expired: [],
  cancelled: [],
};

export class LifecycleManager implements ILifecycleManager {
  private statuses: Map<string, LifecycleStatus> = new Map();

  createTask(taskId: string): LifecycleStatus {
    const now = Date.now();
    const status: LifecycleStatus = {
      taskId,
      currentPhase: 'created',
      events: [{ taskId, from: 'created', to: 'created', timestamp: now, reason: 'task created' }],
      createdAt: now,
      lastTransitionAt: now,
      executionCount: 0,
      totalRuntime: 0,
    };
    this.statuses.set(taskId, status);
    return status;
  }

  transitionTo(taskId: string, phase: LifecyclePhase, reason?: string): boolean {
    const status = this.statuses.get(taskId);
    if (!status) return false;

    const allowed = VALID_TRANSITIONS[status.currentPhase];
    if (!allowed.includes(phase)) return false;

    const now = Date.now();
    const from = status.currentPhase;

    if (phase === 'executing') status.executionCount++;
    if (from === 'executing' && (phase === 'completed' || phase === 'failed')) {
      status.totalRuntime += now - status.lastTransitionAt;
    }

    const event: LifecycleEvent = { taskId, from, to: phase, timestamp: now, reason };
    status.events.push(event);
    status.currentPhase = phase;
    status.lastTransitionAt = now;

    return true;
  }

  getStatus(taskId: string): LifecycleStatus | undefined {
    return this.statuses.get(taskId);
  }

  getTasksInPhase(phase: LifecyclePhase): string[] {
    return Array.from(this.statuses.entries())
      .filter(([, s]) => s.currentPhase === phase)
      .map(([id]) => id);
  }

  async cleanupExpiredTasks(maxAge: number): Promise<string[]> {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, status] of this.statuses) {
      if (now - status.lastTransitionAt > maxAge) {
        const allowed = VALID_TRANSITIONS[status.currentPhase];
        if (allowed.includes('expired')) {
          status.currentPhase = 'expired';
          status.events.push({
            taskId: id,
            from: status.currentPhase,
            to: 'expired',
            timestamp: now,
            reason: `任务超过最大生命周期 ${maxAge}ms`,
          });
          status.lastTransitionAt = now;
          expired.push(id);
        }
      }
    }
    return expired;
  }

  async cleanupCompletedTasks(): Promise<string[]> {
    const now = Date.now();
    const completed: string[] = [];
    for (const [id, status] of this.statuses) {
      if (status.currentPhase === 'completed') {
        const allowed = VALID_TRANSITIONS[status.currentPhase];
        if (allowed.includes('expired')) {
          status.currentPhase = 'expired';
          status.events.push({
            taskId: id,
            from: 'completed',
            to: 'expired',
            timestamp: now,
            reason: '已完成任务清理',
          });
          status.lastTransitionAt = now;
          completed.push(id);
        }
      }
    }
    return completed;
  }

  getAllStatuses(): LifecycleStatus[] {
    return Array.from(this.statuses.values());
  }
}
