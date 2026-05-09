import {
  ExecutionEngine,
  type ExecutableTask,
  type ExecutionResult,
  type ExecutionMetrics,
} from './engine';
import {
  LifecycleManager,
  type LifecyclePhase,
  type LifecycleStatus,
} from './lifecycle';
import { EnhancedTaskScheduler } from './EnhancedTaskScheduler';
import type { EnhancedCronTask } from './EnhancedCronTask';

export class EnhancedCronScheduler {
  public readonly executionEngine: ExecutionEngine;
  public readonly lifecycleManager: LifecycleManager;
  public readonly taskScheduler: EnhancedTaskScheduler;

  constructor(
    onTaskExecute: (task: EnhancedCronTask) => Promise<{
      success: boolean;
      stdout?: string;
      stderr?: string;
      error?: string;
    }>
  ) {
    this.executionEngine = new ExecutionEngine();
    this.lifecycleManager = new LifecycleManager();
    this.taskScheduler = new EnhancedTaskScheduler({ onTaskExecute });
  }

  async executeTask(task: ExecutableTask): Promise<ExecutionResult> {
    this.lifecycleManager.createTask(task.id);
    this.lifecycleManager.transitionTo(task.id, 'scheduled', '开始调度');
    this.lifecycleManager.transitionTo(task.id, 'executing', '开始执行');
    const result = await this.executionEngine.execute(task);
    if (result.success) {
      this.lifecycleManager.transitionTo(task.id, 'completed', '执行成功');
    } else {
      this.lifecycleManager.transitionTo(
        task.id,
        'failed',
        result.error ?? '执行失败'
      );
    }
    return result;
  }

  validateTask(task: ExecutableTask): { valid: boolean; reason?: string } {
    return this.executionEngine.validateTask(task);
  }

  cancelExecution(taskId: string): boolean {
    this.lifecycleManager.transitionTo(taskId, 'cancelled', '用户取消');
    return this.executionEngine.cancelExecution(taskId);
  }

  getExecutionResult(taskId: string): ExecutionResult | undefined {
    return this.executionEngine.getExecution(taskId);
  }

  getExecutionMetrics(): ExecutionMetrics {
    return this.executionEngine.getMetrics();
  }

  getTaskLifecycle(taskId: string): LifecycleStatus | undefined {
    return this.lifecycleManager.getStatus(taskId);
  }

  async cleanupExpiredTasks(maxAge: number): Promise<string[]> {
    return this.lifecycleManager.cleanupExpiredTasks(maxAge);
  }

  async cleanupCompletedTasks(): Promise<string[]> {
    return this.lifecycleManager.cleanupCompletedTasks();
  }

  clearHistory(): void {
    this.executionEngine.clearHistory();
  }

  startScheduler(): void {
    this.taskScheduler.start();
  }

  stopScheduler(): void {
    this.taskScheduler.stop();
  }

  addScheduledTask(task: EnhancedCronTask): void {
    this.taskScheduler.addTask(task);
  }

  removeScheduledTask(taskId: string): void {
    this.taskScheduler.removeTask(taskId);
  }

  getScheduledTasks(): EnhancedCronTask[] {
    return this.taskScheduler.getTasks();
  }
}
