import { Logger, LogLevel } from '@modules/monitoring';
import type { TaskDependency } from './types';
import { TaskStatus } from './types';
import type { TaskRegistry } from './TaskRegistry';

const logger = new Logger({
  module: 'tasks:dependencyService',
  level: LogLevel.INFO,
});

export class TaskDependencyService {
  private registry: TaskRegistry;
  private deps: Map<string, TaskDependency> = new Map();

  constructor(registry: TaskRegistry) {
    this.registry = registry;
  }

  register(taskId: string, dep: TaskDependency): void {
    this.deps.set(taskId, dep);
  }

  getDependency(taskId: string): TaskDependency | undefined {
    return this.deps.get(taskId);
  }

  getAllDependencies(): TaskDependency[] {
    return Array.from(this.deps.values());
  }

  remove(taskId: string): boolean {
    return this.deps.delete(taskId);
  }

  getBlockedBy(taskId: string): string[] {
    return this.deps.get(taskId)?.blockedBy ?? [];
  }

  getBlocks(taskId: string): string[] {
    return this.deps.get(taskId)?.blocks ?? [];
  }

  areDependenciesMet(taskId: string): boolean {
    const dep = this.deps.get(taskId);
    if (!dep?.blockedBy || dep.blockedBy.length === 0) return true;
    return dep.blockedBy.every((blockerId) => {
      const task = this.registry.getTask(blockerId);
      return task && task.status === TaskStatus.COMPLETED;
    });
  }

  getUnmetDependencies(taskId: string): string[] {
    const dep = this.deps.get(taskId);
    if (!dep?.blockedBy) return [];
    return dep.blockedBy.filter((blockerId) => {
      const task = this.registry.getTask(blockerId);
      return !task || task.status !== TaskStatus.COMPLETED;
    });
  }

  getBlockedTasks(): string[] {
    const blocked: string[] = [];
    for (const [taskId] of this.deps) {
      if (!this.areDependenciesMet(taskId)) {
        blocked.push(taskId);
      }
    }
    return blocked;
  }

  getReadyTasks(): string[] {
    const ready: string[] = [];
    for (const [taskId] of this.deps) {
      if (this.areDependenciesMet(taskId)) {
        ready.push(taskId);
      }
    }
    return ready;
  }

  getTopologicalOrder(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const visiting = new Set<string>();

    const visit = (taskId: string): boolean => {
      if (visiting.has(taskId)) return false;
      if (visited.has(taskId)) return true;
      visiting.add(taskId);
      const blockers = this.getBlockedBy(taskId);
      for (const blocker of blockers) {
        if (!visit(blocker)) return false;
      }
      visiting.delete(taskId);
      visited.add(taskId);
      result.push(taskId);
      return true;
    };

    for (const taskId of this.deps.keys()) {
      if (!visited.has(taskId)) {
        if (!visit(taskId)) return [];
      }
    }
    return result;
  }

  hasCycle(): boolean {
    return this.getTopologicalOrder().length === 0 && this.deps.size > 0;
  }
}
