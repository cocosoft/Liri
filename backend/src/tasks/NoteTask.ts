import { BaseTask } from './BaseTask';
import type { TaskState } from './types';
import { TaskType, TaskStatus } from './types';

/**
 * 轻量任务记录（仅用于数据记录，不执行任何 agent）
 *
 * 适用于 /task, /plan 等命令的纯数据任务
 */
export class NoteTask extends BaseTask {
  readonly type = TaskType.WORKFLOW;

  constructor(id: string, description: string) {
    super(id, description, '', TaskType.WORKFLOW);
  }

  async spawn(): Promise<void> {
    /* no-op */
  }
  async kill(): Promise<void> {
    /* no-op */
  }

  setStatusDirect(status: TaskStatus, error?: string): void {
    this.setStatus(status, error);
  }

  setMetadata(metadata: Record<string, unknown>): void {
    this.updateState({ metadata });
  }

  patchState(updates: Partial<TaskState>): void {
    this.updateState(updates);
  }
}
