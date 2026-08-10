import { getLogger } from '@modules/monitoring';
import { TaskStatus } from './types';
import type { TaskState } from './types';
import type { TaskRegistry } from './TaskRegistry';

const logger = getLogger('tasks:reconciliation');

export interface ReconciliationIssue {
  taskId: string;
  type:
    | 'status_inconsistency'
    | 'orphan_task'
    | 'stuck_task'
    | 'missing_parent';
  description: string;
  severity: 'error' | 'warning';
}

export interface ReconciliationResult {
  issues: ReconciliationIssue[];
  fixedCount: number;
  timestamp: number;
}

export class TaskReconciliationService {
  private registry: TaskRegistry;

  constructor(registry: TaskRegistry) {
    this.registry = registry;
  }

  async reconcile(): Promise<ReconciliationResult> {
    const issues: ReconciliationIssue[] = [];
    const states = this.registry.getStates();

    for (const state of states) {
      if (this.isStuck(state)) {
        issues.push({
          taskId: state.id,
          type: 'stuck_task',
          description: `任务 ${state.id} 状态为 ${state.status}，但似乎停滞`,
          severity: 'warning',
        });
      }
    }

    return { issues, fixedCount: 0, timestamp: Date.now() };
  }

  private isStuck(state: TaskState): boolean {
    if (
      state.status !== TaskStatus.RUNNING &&
      state.status !== TaskStatus.PENDING
    )
      return false;
    if (!state.startTime) return false;
    const runningTimeout = 30 * 60 * 1000;
    const pendingTimeout = 60 * 60 * 1000;
    const timeout =
      state.status === TaskStatus.RUNNING ? runningTimeout : pendingTimeout;
    return Date.now() - state.startTime > timeout;
  }
}
